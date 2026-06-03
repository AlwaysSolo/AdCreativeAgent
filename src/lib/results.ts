import { createHash, randomInt } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";

import {
  channels,
  selectedSizesForChannel,
  type ChannelKey,
  type ChannelSize
} from "../config/channels";
import { generateFalAsset } from "../generators/fal-client";
import { postProcessAsset } from "../generators/post-processor";
import { reviewedPromptForAsset } from "../generators/prompt-assignments";
import { buildPrompt } from "../generators/prompt-builder";
import { buildFalImageParams } from "../generators/image-params";
import type { ModelInfo } from "../schemas";
import { getGenerationEvents } from "./generation";
import { readRun, type RunState } from "./runs";

export type ResultAsset = {
  assetId: string;
  channel: ChannelKey;
  sizeName: string;
  sizeLabel: string;
  modelId: string;
  model?: ModelInfo;
  seed: number;
  version: number;
  prompt: string;
  negativePrompt: string;
  referenceImageUrls: string[];
  imageUrl: string;
  finalPath: string;
  downloadHref: string;
  downloadFileName: string;
};

export type ResultGroup = {
  channel: ChannelKey;
  channelLabel: string;
  badge: string;
  downloadHref: string;
  downloadFileName: string;
  assets: ResultAsset[];
};

export type ResultFailure = {
  runId?: string;
  assetId: string;
  status: "failed";
  progress: number;
  error: string;
  timestamp?: string;
};

type ResultOptions = {
  outputRoot?: string;
};

type CostLogLine = {
  assetId?: string;
  modelId?: string;
  seed?: number;
  params?: Record<string, unknown>;
};

type ZipArchiveStream = NodeJS.ReadWriteStream & {
  file(source: string, data: { name: string }): ZipArchiveStream;
  finalize(): Promise<void>;
};

type ZipArchiveConstructor = new (options?: { zlib?: { level: number } }) => ZipArchiveStream;

const DEFAULT_OUTPUT_ROOT = path.join(process.cwd(), "outputs");

export async function loadRunResults(runId: string, options: ResultOptions = {}) {
  const run = await readRun(runId);

  if (!run) {
    throw new Error(`Run not found: ${runId}`);
  }

  const runDir = runOutputDir(run, options);
  const logs = await readCostLog(runDir);
  const failures = await readGenerationFailures(runDir, run.runId);
  const groups: ResultGroup[] = [];

  for (const channel of run.selectedChannels ?? []) {
    const assets = await assetsForChannel({ run, channel, runDir, logs });

    if (assets.length === 0) {
      continue;
    }

    groups.push({
      channel,
      channelLabel: labelForChannel(channel),
      badge: channels[channel].uiBadge,
      downloadHref: `/api/download/${encodeURIComponent(run.runId)}?channel=${channel}`,
      downloadFileName: `${run.runId}-${channel}.zip`,
      assets
    });
  }

  await exportContactSheetHtml({
    run,
    runDir,
    groups,
    failures
  });

  return {
    run,
    runDir,
    groups,
    failures,
    allDownloadHref: `/api/download/${encodeURIComponent(run.runId)}`,
    allDownloadFileName: `${run.runId}-all.zip`
  };
}

export async function createDownloadZip({
  runId,
  channel,
  outputRoot
}: {
  runId: string;
  channel?: ChannelKey;
  outputRoot?: string;
}) {
  const results = await loadRunResults(runId, { outputRoot });
  const assets = channel
    ? results.groups.find((group) => group.channel === channel)?.assets ?? []
    : results.groups.flatMap((group) => group.assets);

  return archiveAssets(assets, channel === undefined);
}

export async function readResultAsset({
  runId,
  assetId,
  outputRoot
}: {
  runId: string;
  assetId: string;
  outputRoot?: string;
}) {
  const results = await loadRunResults(runId, { outputRoot });
  const asset = results.groups.flatMap((group) => group.assets).find((item) => item.assetId === assetId);

  if (!asset) {
    throw new Error(`Asset not found: ${assetId}`);
  }

  return {
    asset,
    bytes: await readFile(asset.finalPath)
  };
}

export async function rerollAsset({
  runId,
  assetId,
  modelId,
  prompt: promptOverride,
  negativePrompt: negativePromptOverride,
  referenceImageUrls: referenceImageUrlOverrides,
  outputRoot
}: {
  runId: string;
  assetId: string;
  modelId?: string;
  prompt?: string;
  negativePrompt?: string;
  referenceImageUrls?: string[];
  outputRoot?: string;
}) {
  const run = await readRun(runId);

  if (!run?.brief) {
    throw new Error(`Run not ready: ${runId}`);
  }

  const target = findTargetAsset(run, assetId);

  if (!target) {
    throw new Error(`Asset not found: ${assetId}`);
  }

  const selectedModel = target.model;
  const model = modelId && modelId !== selectedModel.id ? { ...selectedModel, id: modelId, name: modelId } : selectedModel;
  const seed = randomInt(1, 2_147_483_647);
  const campaignSlug = campaignSlugFor(run);
  const projectSlug = projectSlugFor(run);
  const destinationSlug = destinationSlugFor(run);
  const runDir = runOutputDir(run, { outputRoot });
  const version = await nextAssetVersion(path.join(runDir, "final", target.channel), assetId);
  const outputFileNameBase = versionedAssetFileBase(assetId, version);
  const prompt = await buildPrompt({
    brief: run.brief,
    channel: target.channel,
    size: target.size,
    model,
    seed
  });
  const reviewedPrompt = reviewedPromptForAsset(run.reviewedPrompts, {
    assetId,
    channel: target.channel,
    sizeName: target.size.name
  });
  const promptForRun = {
    ...prompt,
    prompt: promptOverride?.trim() || reviewedPrompt?.prompt || prompt.prompt,
    negativePrompt:
      negativePromptOverride !== undefined
        ? negativePromptOverride.trim()
        : reviewedPrompt?.negativePrompt ?? prompt.negativePrompt
  };
  const referenceImageUrls =
    referenceImageUrlOverrides ?? reviewedPrompt?.referenceImageUrls ?? [];
  const falResult = await generateFalAsset({
    runId,
    projectSlug,
    destinationSlug,
    campaignSlug,
    assetId,
    channel: target.channel,
    modelId: model.id,
    params: buildFalImageParams({
      prompt: promptForRun,
      size: target.size,
      model,
      quality: run.modelSelections?.[target.channel]?.imageOptions?.quality,
      referenceImageUrls
    }),
    seed,
    size: {
      w: target.size.w,
      h: target.size.h
    },
    dryRun: run.dryRun ?? false,
    supportsNegativePrompt: model.capabilities?.supportsNegativePrompt,
    outputPath: path.join(runDir, "raw", `${outputFileNameBase}.png`),
    outputRoot
  });
  await postProcessAsset({
    runId,
    projectSlug,
    destinationSlug,
    campaignSlug,
    assetId,
    channel: target.channel,
    size: target.size,
    rawPath: falResult.outputPath,
    outputFileNameBase,
    outputRoot
  });

  const results = await loadRunResults(runId, { outputRoot });
  const asset = results.groups.flatMap((group) => group.assets).find((item) => item.assetId === assetId);

  if (!asset) {
    throw new Error(`Asset not found after reroll: ${assetId}`);
  }

  return asset;
}

async function assetsForChannel({
  run,
  channel,
  runDir,
  logs
}: {
  run: RunState;
  channel: ChannelKey;
  runDir: string;
  logs: Map<string, CostLogLine>;
}) {
  const finalDir = path.join(runDir, "final", channel);
  const exists = await pathExists(finalDir);

  if (!exists) {
    return [];
  }

  const files = await readdir(finalDir);
  const assets: ResultAsset[] = [];
  const model = run.modelSelections?.[channel]?.imageModel;

  for (const size of selectedSizesForChannel(channel, run.selectedChannelSizes)) {
    const assetId = assetIdFor(channel, size);
    const versionedFile = latestAssetVersion(files, assetId);

    if (!versionedFile) {
      continue;
    }

    const log = logs.get(assetId);
    const finalPath = path.join(finalDir, versionedFile.fileName);
    const modelId = log?.modelId ?? model?.id ?? "unknown-model";
    const seed = typeof log?.seed === "number" ? log.seed : seedFor(run.runId, channel, size);
    const prompt = typeof log?.params?.prompt === "string" ? log.params.prompt : "";
    const negativePrompt =
      typeof log?.params?.negative_prompt === "string" ? log.params.negative_prompt : "";
    const referenceImageUrls = referenceImageUrlsFromParams(log?.params);
    const downloadHref = `/api/download/${encodeURIComponent(run.runId)}?assetId=${encodeURIComponent(assetId)}`;
    const downloadFileName = versionedFile.fileName;

    assets.push({
      assetId,
      channel,
      sizeName: size.name,
      sizeLabel: `${size.w}x${size.h} (${size.aspectLabel})`,
      modelId,
      model: modelId === model?.id ? model : model ? { ...model, id: modelId, name: modelId } : undefined,
      seed,
      version: versionedFile.version,
      prompt,
      negativePrompt,
      referenceImageUrls,
      imageUrl: `${downloadHref}&inline=1&version=${versionedFile.version}`,
      finalPath,
      downloadHref,
      downloadFileName
    });
  }

  return assets;
}

async function readCostLog(runDir: string) {
  const linesByAsset = new Map<string, CostLogLine>();

  try {
    const content = await readFile(path.join(runDir, "cost-log.jsonl"), "utf8");

    for (const line of content.split(/\r?\n/)) {
      if (!line.trim()) {
        continue;
      }

      const parsed = JSON.parse(line) as CostLogLine;

      if (parsed.assetId) {
        linesByAsset.set(parsed.assetId, parsed);
      }
    }
  } catch {
    return linesByAsset;
  }

  return linesByAsset;
}

function referenceImageUrlsFromParams(params: Record<string, unknown> | undefined) {
  const imageUrls = params?.image_urls;

  if (!Array.isArray(imageUrls)) {
    return [];
  }

  return imageUrls.filter((url): url is string => typeof url === "string" && url.length > 0);
}

async function nextAssetVersion(finalDir: string, assetId: string) {
  let files: string[];

  try {
    files = await readdir(finalDir);
  } catch {
    return 1;
  }

  const latest = latestAssetVersion(files, assetId);

  return latest ? latest.version + 1 : 1;
}

function latestAssetVersion(files: readonly string[], assetId: string) {
  return files
    .map((fileName) => assetVersionForFile(fileName, assetId))
    .filter((versionedFile): versionedFile is { fileName: string; version: number } =>
      Boolean(versionedFile)
    )
    .sort((left, right) => right.version - left.version)[0];
}

function assetVersionForFile(fileName: string, assetId: string) {
  if (fileName === `${assetId}.png`) {
    return {
      fileName,
      version: 1
    };
  }

  const match = fileName.match(new RegExp(`^${escapeRegExp(assetId)}_v(\\d+)\\.png$`));

  if (!match) {
    return null;
  }

  const version = Number.parseInt(match[1] ?? "", 10);

  if (!Number.isInteger(version) || version < 2) {
    return null;
  }

  return {
    fileName,
    version
  };
}

function versionedAssetFileBase(assetId: string, version: number) {
  return version <= 1 ? assetId : `${assetId}_v${version}`;
}

async function readGenerationFailures(runDir: string, runId: string) {
  const failures = new Map<string, ResultFailure>();

  for (const event of getGenerationEvents(runId)) {
    if (event.status !== "failed") {
      continue;
    }

    const failure: ResultFailure = {
      assetId: event.assetId,
      status: "failed",
      progress: event.progress,
      error: event.error ?? "Generation failed."
    };
    failures.set(failureKey(failure), failure);
  }

  try {
    const content = await readFile(path.join(runDir, "generation-events.jsonl"), "utf8");

    for (const line of content.split(/\r?\n/)) {
      if (!line.trim()) {
        continue;
      }

      const parsed = JSON.parse(line) as Partial<ResultFailure>;

      if (
        parsed.status !== "failed" ||
        typeof parsed.assetId !== "string" ||
        typeof parsed.error !== "string"
      ) {
        continue;
      }

      const failure: ResultFailure = {
        runId: typeof parsed.runId === "string" ? parsed.runId : undefined,
        assetId: parsed.assetId,
        status: "failed",
        progress: typeof parsed.progress === "number" ? parsed.progress : 100,
        error: parsed.error,
        timestamp: typeof parsed.timestamp === "string" ? parsed.timestamp : undefined
      };
      failures.set(failureKey(failure), failure);
    }
  } catch {
    return [...failures.values()];
  }

  return [...failures.values()];
}

function failureKey(failure: Pick<ResultFailure, "assetId" | "error">) {
  return `${failure.assetId}:${failure.error}`;
}

async function exportContactSheetHtml({
  run,
  runDir,
  groups,
  failures
}: {
  run: RunState;
  runDir: string;
  groups: ResultGroup[];
  failures: ResultFailure[];
}) {
  await mkdir(runDir, { recursive: true });

  const html = [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    `<title>${escapeHtml(run.brief?.campaignName ?? run.runId)} Contact Sheet</title>`,
    '<style>body{font-family:Arial,sans-serif;margin:32px;color:#111827}section{margin-top:28px}img{max-width:260px;height:auto;border:1px solid #ddd}article{display:inline-block;vertical-align:top;width:280px;margin:0 16px 20px 0}.meta{font-size:12px;color:#4b5563;word-break:break-all}</style>',
    "</head>",
    "<body>",
    `<h1>${escapeHtml(run.brief?.campaignName ?? "Contact Sheet")}</h1>`,
    ...groups.flatMap((group) => [
      `<section><h2>${escapeHtml(group.channelLabel)}</h2><p>${escapeHtml(group.badge)}</p>`,
      ...group.assets.map(
        (asset) => {
          const imageSrc = path.relative(runDir, asset.finalPath).replace(/\\/g, "/");

          return `<article><img src="${escapeHtml(imageSrc)}" alt="${escapeHtml(asset.assetId)}"><h3>${escapeHtml(asset.sizeName)}</h3><p class="meta">${escapeHtml(asset.assetId)}</p><p class="meta">${escapeHtml(asset.modelId)}</p><p class="meta">Seed ${asset.seed}</p></article>`;
        }
      ),
      "</section>"
    ]),
    ...(failures.length > 0
      ? [
          "<section><h2>Generation Failures</h2>",
          ...failures.map(
            (failure) =>
              `<article><h3>${escapeHtml(failure.assetId)}</h3><p class="meta">${escapeHtml(failure.error)}</p></article>`
          ),
          "</section>"
        ]
      : []),
    "</body>",
    "</html>"
  ].join("");

  await writeFile(path.join(runDir, "contact-sheet.html"), html, "utf8");
}

async function archiveAssets(assets: ResultAsset[], folderByChannel: boolean) {
  const { ZipArchive } = importArchiver();
  const archive = new ZipArchive({ zlib: { level: 9 } });
  const stream = new PassThrough();
  const chunks: Buffer[] = [];
  const completion = new Promise<Buffer>((resolve, reject) => {
    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
    archive.on("error", reject);
  });

  archive.pipe(stream);

  for (const asset of assets) {
    archive.file(asset.finalPath, {
      name: folderByChannel ? `${asset.channel}/${path.basename(asset.finalPath)}` : path.basename(asset.finalPath)
    });
  }

  await archive.finalize();

  return completion;
}

function importArchiver() {
  const requireFromWorkspace = eval("require") as (specifier: string) => unknown;

  return requireFromWorkspace("archiver") as {
    ZipArchive: ZipArchiveConstructor;
  };
}

function findTargetAsset(run: RunState, assetId: string) {
  for (const channel of run.selectedChannels ?? []) {
    const model = run.modelSelections?.[channel]?.imageModel;

    if (!model) {
      continue;
    }

    for (const size of selectedSizesForChannel(channel, run.selectedChannelSizes)) {
      if (assetIdFor(channel, size) === assetId) {
        return {
          channel,
          size,
          model
        };
      }
    }
  }

  return null;
}

export function campaignSlugFor(run: RunState) {
  const value = run.brief?.campaignName ?? run.brief?.resortName ?? run.runId;

  return safeSegment(value);
}

function runOutputDir(run: RunState, options: ResultOptions) {
  const projectSlug = projectSlugFor(run);
  const destinationSlug = destinationSlugFor(run);

  return path.join(
    options.outputRoot ?? DEFAULT_OUTPUT_ROOT,
    ...(projectSlug ? [projectSlug] : []),
    ...(destinationSlug ? [destinationSlug] : []),
    campaignSlugFor(run),
    run.runId
  );
}

function projectSlugFor(run: RunState) {
  return run.projectSlug ? safeSegment(run.projectSlug) : undefined;
}

function destinationSlugFor(run: RunState) {
  return run.destinationSlug ? safeSegment(run.destinationSlug) : undefined;
}

function assetIdFor(channel: ChannelKey, size: ChannelSize) {
  return `${channel}_${safeSegment(size.name)}_${size.w}x${size.h}`;
}

function seedFor(runId: string, channel: ChannelKey, size: ChannelSize) {
  const seedKey =
    channel === "email_internal"
      ? `${runId}:${channel}:master`
      : `${runId}:${channel}:${size.name}:${size.w}x${size.h}`;
  const hash = createHash("sha256").update(seedKey).digest();

  return hash.readUInt32BE(0) % 2_147_483_647;
}

function labelForChannel(channel: ChannelKey) {
  return channel
    .split("_")
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
}

function safeSegment(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function pathExists(filePath: string) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
