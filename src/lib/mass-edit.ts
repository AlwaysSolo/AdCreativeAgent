import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

import {
  generateFalAsset as defaultGenerateFalAsset,
  type FalAssetRequest,
  type FalAssetResult
} from "../generators/fal-client";
import { isGptImage2ModelId } from "../models/image-options";
import {
  massEditRunRequestSchema,
  type MassEditAssetResult,
  type MassEditBatch,
  type MassEditInputImage,
  type MassEditRunRequest
} from "../schemas";
import { readProject, type ProjectState } from "./projects";

export type MassEditEvent = {
  assetId: string;
  batchId: string;
  imageId: string;
  status: "queued" | "running" | "done" | "failed";
  progress: number;
  thumbnailUrl?: string;
  error?: string;
};

export type StartMassEditOptions = {
  outputRoot?: string;
  cacheDir?: string;
  readProject?: (projectId: string) => Promise<ProjectState | null>;
  generateFalAsset?: (request: FalAssetRequest) => Promise<FalAssetResult>;
};

export type StartMassEditResult = {
  runId: string;
  assetCount: number;
};

export type MassEditRunRecord = {
  runId: string;
  projectId: string;
  projectName: string;
  projectSlug: string;
  dryRun: boolean;
  outputRoot?: string;
  runDir: string;
  createdAt: string;
  updatedAt: string;
  assetCount: number;
  request: MassEditRunRequest;
  results: MassEditAssetResult[];
};

type MassEditState = {
  runId: string;
  events: MassEditEvent[];
  subscribers: Set<MassEditSubscriber>;
  completed: boolean;
  completion: Promise<void>;
  resolveCompletion: () => void;
  rejectCompletion: (error: unknown) => void;
  assetCount: number;
};

type MassEditSubscriber = {
  onEvent: (event: MassEditEvent) => void;
  onComplete: () => void;
};

type MassEditJob = {
  assetId: string;
  batch: MassEditBatch;
  image: MassEditInputImage;
  batchSlug: string;
  fileBase: string;
  seed: number;
  generationSize: { width: number; height: number };
  targetSize: { width: number; height: number };
};

const DEFAULT_OUTPUT_ROOT = path.join(process.cwd(), "outputs");
const DEFAULT_CACHE_DIR = path.join(process.cwd(), "cache", "mass-edit-runs");
const ULID_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const massEditStates = sharedMassEditStates();

export async function startMassEditRun(
  request: MassEditRunRequest,
  options: StartMassEditOptions = {}
): Promise<StartMassEditResult> {
  const parsedRequest = massEditRunRequestSchema.parse(request);
  const project = await (options.readProject ?? readProject)(parsedRequest.projectId);

  if (!project) {
    throw new Error(`Project not found: ${parsedRequest.projectId}`);
  }

  const runId = generateUlid(new Date());
  const jobs = massEditJobsForRequest(parsedRequest, runId);
  const state = createMassEditState(runId, jobs.length);
  massEditStates.set(runId, state);

  state.completion = orchestrateMassEdit({
    request: parsedRequest,
    project,
    runId,
    jobs,
    state,
    options
  })
    .then(() => completeState(state))
    .catch((error) => {
      failState(state, error);
      throw error;
    });

  return {
    runId,
    assetCount: jobs.length
  };
}

export async function waitForMassEditRun(runId: string) {
  const state = massEditStates.get(runId);

  if (!state) {
    throw new Error(`Mass edit run not found: ${runId}`);
  }

  await state.completion;
}

export function getMassEditEvents(runId: string) {
  return [...(massEditStates.get(runId)?.events ?? [])];
}

export function resetMassEditState() {
  massEditStates.clear();
}

export function createMassEditEventStream(runId: string) {
  const encoder = new TextEncoder();
  let subscriber: MassEditSubscriber | null = null;

  return new ReadableStream<Uint8Array>({
    start(controller) {
      const state = ensureMassEditState(runId);
      subscriber = {
        onEvent(event) {
          controller.enqueue(encoder.encode(formatSseEvent(event)));
        },
        onComplete() {
          controller.close();
        }
      };

      for (const event of state.events) {
        subscriber.onEvent(event);
      }

      if (state.completed) {
        subscriber.onComplete();
        return;
      }

      state.subscribers.add(subscriber);
    },
    cancel() {
      const state = massEditStates.get(runId);

      if (!state || !subscriber) {
        return;
      }

      state.subscribers.delete(subscriber);
    }
  });
}

export function massEditGenerationSizeForTarget(size: { width: number; height: number }) {
  return {
    width: multipleOf16AtOrAbove(size.width),
    height: multipleOf16AtOrAbove(size.height)
  };
}

export function buildMassEditFalParams({
  prompt,
  image,
  modelId,
  quality,
  generationSize
}: {
  prompt: string;
  image: MassEditInputImage;
  modelId: string;
  quality?: MassEditBatch["quality"];
  generationSize: { width: number; height: number };
}) {
  const params: Record<string, unknown> = {
    prompt,
    image_urls: [image.sourceUrl],
    image_size: generationSize
  };

  if (quality && isGptImage2ModelId(modelId)) {
    params.quality = quality;
  }

  return params;
}

export async function readMassEditRunRecord(
  runId: string,
  options: Pick<StartMassEditOptions, "cacheDir"> = {}
) {
  try {
    return JSON.parse(await readFile(massEditRunRecordPath(runId, options), "utf8")) as MassEditRunRecord;
  } catch {
    return null;
  }
}

export async function readMassEditAsset({
  runId,
  assetId,
  cacheDir
}: {
  runId: string;
  assetId: string;
  cacheDir?: string;
}) {
  const record = await readMassEditRunRecord(runId, { cacheDir });
  const asset = record?.results.find((result) => result.assetId === assetId);

  if (!record || !asset) {
    throw new Error(`Mass edit asset not found: ${assetId}`);
  }

  return {
    asset,
    bytes: await readFile(asset.outputPath)
  };
}

export async function resolveMassEditOutputFolder({
  runId,
  outputRoot,
  cacheDir
}: {
  runId: string;
  outputRoot?: string;
  cacheDir?: string;
}) {
  const record = await readMassEditRunRecord(runId, { cacheDir });

  if (!record) {
    throw new Error(`Mass edit run not found: ${runId}`);
  }

  const root = path.resolve(outputRoot ?? DEFAULT_OUTPUT_ROOT);
  const resolvedRunDir = path.resolve(record.runDir);
  const relative = path.relative(root, resolvedRunDir);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Refusing to open a path outside outputs.");
  }

  return resolvedRunDir;
}

async function orchestrateMassEdit({
  request,
  project,
  runId,
  jobs,
  state,
  options
}: {
  request: MassEditRunRequest;
  project: ProjectState;
  runId: string;
  jobs: MassEditJob[];
  state: MassEditState;
  options: StartMassEditOptions;
}) {
  const generateFalAsset = options.generateFalAsset ?? defaultGenerateFalAsset;
  const runDir = massEditRunDir({ projectSlug: project.slug, runId, outputRoot: options.outputRoot });
  const record: MassEditRunRecord = {
    runId,
    projectId: project.projectId,
    projectName: project.name,
    projectSlug: project.slug,
    dryRun: request.dryRun,
    outputRoot: options.outputRoot,
    runDir,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    assetCount: jobs.length,
    request,
    results: []
  };

  await mkdir(runDir, { recursive: true });
  await writeFile(path.join(runDir, "request.json"), JSON.stringify(request, null, 2), "utf8");
  await writeMassEditRunRecord(record, options);

  for (const job of jobs) {
    emit(state, queuedEvent(job));
  }

  const settled = await Promise.allSettled(
    jobs.map(async (job) => {
      try {
        emit(state, {
          ...queuedEvent(job),
          status: "running",
          progress: 15
        });

        const rawPath = path.join(runDir, "raw", job.batchSlug, `${job.fileBase}.png`);
        const falResult = await generateFalAsset({
          runId,
          projectSlug: project.slug,
          campaignSlug: "mass-edits",
          assetId: job.assetId,
          modelId: job.batch.modelId,
          params: buildMassEditFalParams({
            prompt: job.batch.prompt,
            image: job.image,
            modelId: job.batch.modelId,
            quality: job.batch.quality,
            generationSize: job.generationSize
          }),
          seed: job.seed,
          size: {
            w: job.generationSize.width,
            h: job.generationSize.height
          },
          dryRun: request.dryRun,
          supportsNegativePrompt: job.batch.model.capabilities?.supportsNegativePrompt,
          mode: "subscribe",
          outputRoot: options.outputRoot,
          outputPath: rawPath
        });

        emit(state, {
          ...queuedEvent(job),
          status: "running",
          progress: 70
        });

        const result = await postProcessMassEditJob({
          runId,
          job,
          rawPath: falResult.outputPath,
          runDir
        });
        record.results.push(result);
        record.updatedAt = new Date().toISOString();
        await writeMassEditRunRecord(record, options);
        await writeFile(
          path.join(runDir, "mass-edit-results.json"),
          JSON.stringify(record.results, null, 2),
          "utf8"
        );

        emit(state, {
          ...queuedEvent(job),
          status: "done",
          progress: 100,
          thumbnailUrl: result.thumbnailUrl
        });
      } catch (error) {
        emit(state, {
          ...queuedEvent(job),
          status: "failed",
          progress: 100,
          error: error instanceof Error ? error.message : "Mass edit failed."
        });
      }
    })
  );

  record.updatedAt = new Date().toISOString();
  await writeMassEditRunRecord(record, options);
  await writeFile(path.join(runDir, "mass-edit-results.json"), JSON.stringify(record.results, null, 2), "utf8");

  return settled;
}

async function postProcessMassEditJob({
  runId,
  job,
  rawPath,
  runDir
}: {
  runId: string;
  job: MassEditJob;
  rawPath: string;
  runDir: string;
}) {
  const finalPath = path.join(runDir, "final", job.batchSlug, `${job.fileBase}.png`);
  const draftPath = path.join(runDir, "drafts", job.batchSlug, `${job.fileBase}.png`);
  const finalBuffer = await sharp(rawPath)
    .resize(job.targetSize.width, job.targetSize.height, {
      fit: "cover",
      position: "center"
    })
    .png()
    .toBuffer();

  await mkdir(path.dirname(finalPath), { recursive: true });
  await mkdir(path.dirname(draftPath), { recursive: true });
  await sharp(finalBuffer).toFile(finalPath);
  await sharp(finalBuffer)
    .composite([
      {
        input: Buffer.from(watermarkSvg(job.targetSize.width, job.targetSize.height)),
        gravity: "center"
      }
    ])
    .png()
    .toFile(draftPath);

  return {
    runId,
    assetId: job.assetId,
    batchId: job.batch.id,
    imageId: job.image.id,
    sourceName: job.image.name,
    modelId: job.batch.modelId,
    prompt: job.batch.prompt,
    quality: job.batch.quality,
    width: job.targetSize.width,
    height: job.targetSize.height,
    outputPath: finalPath,
    thumbnailUrl: `/api/mass-edit/download/${encodeURIComponent(runId)}?assetId=${encodeURIComponent(job.assetId)}&inline=1`,
    seed: job.seed
  } satisfies MassEditAssetResult;
}

function massEditJobsForRequest(request: MassEditRunRequest, runId: string) {
  return request.batches.flatMap((batch, batchIndex) => {
    const batchSlug = safeSegment(batch.name || batch.id || `batch-${batchIndex + 1}`);

    return batch.images.map((image, imageIndex) => {
      const targetSize = {
        width: image.width,
        height: image.height
      };
      const generationSize = massEditGenerationSizeForTarget(targetSize);
      const fileBase = `${safeFileBase(image.name || image.id || `image-${imageIndex + 1}`)}_${image.width}x${image.height}`;
      const assetId = `${batchSlug}_${fileBase}`;

      return {
        assetId,
        batch,
        image,
        batchSlug,
        fileBase,
        seed: seedFor(`${runId}:${batch.id}:${image.id}:${image.width}x${image.height}`),
        generationSize,
        targetSize
      };
    });
  });
}

function queuedEvent(job: MassEditJob): Pick<MassEditEvent, "assetId" | "batchId" | "imageId"> & {
  status: "queued";
  progress: 0;
} {
  return {
    assetId: job.assetId,
    batchId: job.batch.id,
    imageId: job.image.id,
    status: "queued",
    progress: 0
  };
}

function createMassEditState(runId: string, assetCount: number): MassEditState {
  let resolveCompletion: () => void = () => undefined;
  let rejectCompletion: (error: unknown) => void = () => undefined;
  const completion = new Promise<void>((resolve, reject) => {
    resolveCompletion = resolve;
    rejectCompletion = reject;
  });

  return {
    runId,
    events: [],
    subscribers: new Set(),
    completed: false,
    completion,
    resolveCompletion,
    rejectCompletion,
    assetCount
  };
}

function ensureMassEditState(runId: string) {
  let state = massEditStates.get(runId);

  if (!state) {
    state = createMassEditState(runId, 0);
    massEditStates.set(runId, state);
  }

  return state;
}

function emit(state: MassEditState, event: MassEditEvent) {
  state.events.push(event);

  for (const subscriber of state.subscribers) {
    subscriber.onEvent(event);
  }
}

function completeState(state: MassEditState) {
  state.completed = true;
  state.resolveCompletion();

  for (const subscriber of state.subscribers) {
    subscriber.onComplete();
  }

  state.subscribers.clear();
}

function failState(state: MassEditState, error: unknown) {
  state.completed = true;
  state.rejectCompletion(error);

  for (const subscriber of state.subscribers) {
    subscriber.onComplete();
  }

  state.subscribers.clear();
}

function writeMassEditRunRecord(record: MassEditRunRecord, options: Pick<StartMassEditOptions, "cacheDir">) {
  return writeJsonFile(massEditRunRecordPath(record.runId, options), record);
}

async function writeJsonFile(filePath: string, value: unknown) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}

function massEditRunRecordPath(runId: string, options: Pick<StartMassEditOptions, "cacheDir">) {
  if (!/^[0-9A-HJKMNP-TV-Z]{26}$/.test(runId)) {
    throw new Error("Invalid mass edit runId");
  }

  return path.join(options.cacheDir ?? DEFAULT_CACHE_DIR, `${runId}.json`);
}

function massEditRunDir({
  projectSlug,
  runId,
  outputRoot
}: {
  projectSlug: string;
  runId: string;
  outputRoot?: string;
}) {
  return path.join(outputRoot ?? DEFAULT_OUTPUT_ROOT, safeSegment(projectSlug), "mass-edits", runId);
}

function formatSseEvent(event: MassEditEvent) {
  return `data: ${JSON.stringify(event)}\n\n`;
}

function generateUlid(now: Date) {
  return `${encodeTime(now.valueOf(), 10)}${encodeRandom(16)}`;
}

function encodeTime(timeMs: number, length: number) {
  let value = Math.floor(timeMs);
  let output = "";

  for (let index = length - 1; index >= 0; index -= 1) {
    output = `${ULID_ALPHABET[value % 32]}${output}`;
    value = Math.floor(value / 32);
  }

  return output;
}

function encodeRandom(length: number) {
  const bytes = randomBytes(length);
  let output = "";

  for (let index = 0; output.length < length; index += 1) {
    output += ULID_ALPHABET[bytes[index % bytes.length] % 32];
  }

  return output;
}

function seedFor(value: string) {
  const hash = createHash("sha256").update(value).digest();

  return hash.readUInt32BE(0) % 2_147_483_647;
}

function multipleOf16AtOrAbove(value: number) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Image size must be a positive integer: ${value}`);
  }

  return Math.ceil(value / 16) * 16;
}

function safeFileBase(value: string) {
  return safeSegment(value.replace(/\.[a-z0-9]+$/i, "")) || "image";
}

function safeSegment(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function watermarkSvg(width: number, height: number) {
  const fontSize = Math.max(28, Math.min(width, height) / 8);

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`,
    `<text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle"`,
    ` font-family="Arial, sans-serif" font-size="${fontSize}" font-weight="700"`,
    ` fill="rgba(255,255,255,0.72)" stroke="rgba(17,24,39,0.35)" stroke-width="2"`,
    ` transform="rotate(-28 ${width / 2} ${height / 2})">DRAFT</text>`,
    "</svg>"
  ].join("");
}

function sharedMassEditStates() {
  const globalStore = globalThis as typeof globalThis & {
    __resortCreativeMassEditStates?: Map<string, MassEditState>;
  };

  globalStore.__resortCreativeMassEditStates ??= new Map<string, MassEditState>();

  return globalStore.__resortCreativeMassEditStates;
}
