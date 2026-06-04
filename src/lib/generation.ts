import { createHash } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

import {
  selectedSizesForChannel,
  type ChannelKey,
  type ChannelSize
} from "../config/channels";
import {
  generateFalAsset as defaultGenerateFalAsset,
  type FalAssetRequest,
  type FalAssetResult
} from "../generators/fal-client";
import { reviewedPromptForAsset } from "../generators/prompt-assignments";
import {
  postProcessAsset as defaultPostProcessAsset,
  type PostProcessAssetInput,
  type PostProcessAssetResult
} from "../generators/post-processor";
import {
  buildPrompt as defaultBuildPrompt,
  type BuildPromptInput,
  type BuiltPrompt
} from "../generators/prompt-builder";
import { readRun as defaultReadRun, type RunState } from "./runs";
import type { ModelInfo } from "../schemas";
import { buildFalImageParams } from "../generators/image-params";

export type GenerationEvent = {
  assetId: string;
  status: "queued" | "running" | "done" | "failed";
  progress: number;
  thumbnailUrl?: string;
  error?: string;
};

export type StartGenerationOptions = {
  outputRoot?: string;
  readRun?: (runId: string) => Promise<RunState | null>;
  buildPrompt?: (input: BuildPromptInput) => Promise<BuiltPrompt>;
  generateFalAsset?: (request: FalAssetRequest) => Promise<FalAssetResult>;
  postProcessAsset?: (input: PostProcessAssetInput) => Promise<PostProcessAssetResult>;
};

export type StartGenerationResult = {
  runId: string;
  assetCount: number;
};

type GenerationState = {
  runId: string;
  events: GenerationEvent[];
  subscribers: Set<GenerationSubscriber>;
  completed: boolean;
  completion: Promise<void>;
  resolveCompletion: () => void;
  rejectCompletion: (error: unknown) => void;
  assetCount: number;
};

type GenerationSubscriber = {
  onEvent: (event: GenerationEvent) => void;
  onComplete: () => void;
};

const generationStates = sharedGenerationStates();
const DEFAULT_OUTPUT_ROOT = path.join(process.cwd(), "outputs");

export async function startGenerationRun(
  runId: string,
  options: StartGenerationOptions = {}
): Promise<StartGenerationResult> {
  const existing = generationStates.get(runId);

  if (existing && existing.assetCount > 0 && !existing.completed) {
    return { runId, assetCount: existing.assetCount };
  }

  const readRun = options.readRun ?? defaultReadRun;
  const run = await readRun(runId);

  if (!run) {
    throw new Error(`Run not found: ${runId}`);
  }

  validateGenerationRun(run);

  const jobs = generationJobs(run);
  const state =
    existing && existing.assetCount === 0 && !existing.completed
      ? prepareExistingState(existing, jobs.length)
      : createGenerationState(runId, jobs.length);
  generationStates.set(runId, state);

  state.completion = orchestrateGeneration(run, jobs, state, options)
    .then(() => {
      completeState(state);
    })
    .catch((error) => {
      failRunState(state, error);
      throw error;
    });

  return { runId, assetCount: jobs.length };
}

export async function waitForGenerationRun(runId: string) {
  const state = generationStates.get(runId);

  if (!state) {
    throw new Error(`Generation run not found: ${runId}`);
  }

  await state.completion;
}

export function getGenerationEvents(runId: string) {
  return [...(generationStates.get(runId)?.events ?? [])];
}

export function resetGenerationState() {
  generationStates.clear();
}

export function createGenerationEventStream(runId: string) {
  const encoder = new TextEncoder();
  let subscriber: GenerationSubscriber | null = null;

  return new ReadableStream<Uint8Array>({
    start(controller) {
      const state = ensureGenerationState(runId);
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
      const state = generationStates.get(runId);

      if (!state || !subscriber) {
        return;
      }

      state.subscribers.delete(subscriber);
    }
  });
}

async function orchestrateGeneration(
  run: RunState,
  jobs: GenerationJob[],
  state: GenerationState,
  options: StartGenerationOptions
) {
  const buildPrompt = options.buildPrompt ?? defaultBuildPrompt;
  const generateFalAsset = options.generateFalAsset ?? defaultGenerateFalAsset;
  const postProcessAsset = options.postProcessAsset ?? defaultPostProcessAsset;
  const campaignSlug = campaignSlugFor(run);
  const projectSlug = projectSlugFor(run);
  const destinationSlug = destinationSlugFor(run);
  const brief = run.brief;

  if (!brief) {
    throw new Error("Run is missing a resolved brief.");
  }

  for (const job of jobs) {
    emit(state, {
      assetId: job.assetId,
      status: "queued",
      progress: 0
    });
  }

  await Promise.allSettled(
    jobs.map(async (job) => {
      try {
        emit(state, {
          assetId: job.assetId,
          status: "running",
          progress: 10
        });

        const prompt = await buildPrompt({
          brief,
          channel: job.channel,
          size: job.size,
          model: job.model,
          seed: job.seed
        });
        const reviewedPrompt = reviewedPromptForAsset(run.reviewedPrompts, {
          assetId: job.assetId,
          channel: job.channel,
          sizeName: job.size.name
        });
        const promptForRun = reviewedPrompt
          ? {
              ...prompt,
              prompt: reviewedPrompt.prompt,
              negativePrompt: reviewedPrompt.negativePrompt
            }
          : prompt;

        emit(state, {
          assetId: job.assetId,
          status: "running",
          progress: 35
        });

        const falResult = await generateFalAsset({
          runId: run.runId,
          projectSlug,
          destinationSlug,
          campaignSlug,
          assetId: job.assetId,
          channel: job.channel,
          modelId: job.model.id,
          params: buildFalImageParams({
            prompt: promptForRun,
            size: job.size,
            model: job.model,
            quality: run.modelSelections?.[job.channel]?.imageOptions?.quality,
            referenceImageUrls: reviewedPrompt?.referenceImageUrls
          }),
          seed: promptForRun.seed,
          size: {
            w: job.size.w,
            h: job.size.h
          },
          dryRun: run.dryRun ?? false,
          supportsNegativePrompt: job.model.capabilities?.supportsNegativePrompt,
          mode: "subscribe",
          outputRoot: options.outputRoot
        });

        emit(state, {
          assetId: job.assetId,
          status: "running",
          progress: 70
        });

        const processed = await postProcessAsset({
          runId: run.runId,
          projectSlug,
          destinationSlug,
          campaignSlug,
          assetId: job.assetId,
          channel: job.channel,
          size: job.size,
          rawPath: falResult.outputPath,
          outputRoot: options.outputRoot
        });

        emit(state, {
          assetId: job.assetId,
          status: "done",
          progress: 100,
          thumbnailUrl: processed.thumbnailUrl
        });
      } catch (error) {
        const failureEvent = {
          assetId: job.assetId,
          status: "failed",
          progress: 100,
          error: error instanceof Error ? error.message : "Generation failed."
        } satisfies GenerationEvent;

        emit(state, failureEvent);
        await appendGenerationEvent({
          run,
          projectSlug,
          destinationSlug,
          campaignSlug,
          event: failureEvent,
          outputRoot: options.outputRoot
        });
        throw error;
      }
    })
  );
}

type GenerationJob = {
  assetId: string;
  channel: ChannelKey;
  size: ChannelSize;
  model: ModelInfo;
  seed: number;
};

function generationJobs(run: RunState): GenerationJob[] {
  const selectedChannels = run.selectedChannels ?? [];
  const jobs: GenerationJob[] = [];

  for (const channel of selectedChannels) {
    const model = run.modelSelections?.[channel]?.imageModel;

    if (!model) {
      continue;
    }

    for (const size of selectedSizesForChannel(channel, run.selectedChannelSizes)) {
      jobs.push({
        assetId: assetIdFor(channel, size),
        channel,
        size,
        model,
        seed: seedFor(run.runId, channel, size)
      });
    }
  }

  return jobs;
}

function validateGenerationRun(run: RunState): asserts run is RunState & {
  brief: NonNullable<RunState["brief"]>;
  selectedChannels: NonNullable<RunState["selectedChannels"]>;
} {
  if (!run.brief) {
    throw new Error("Run is missing a resolved brief.");
  }

  if (!run.selectedChannels || run.selectedChannels.length === 0) {
    throw new Error("Run has no selected channels.");
  }

  for (const channel of run.selectedChannels) {
    if (!run.modelSelections?.[channel]?.imageModel) {
      throw new Error(`Run is missing an image model for ${channel}.`);
    }
  }
}

function createGenerationState(runId: string, assetCount: number): GenerationState {
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

function prepareExistingState(state: GenerationState, assetCount: number) {
  state.events = [];
  state.completed = false;
  state.assetCount = assetCount;
  state.completion = new Promise<void>((resolve, reject) => {
    state.resolveCompletion = resolve;
    state.rejectCompletion = reject;
  });

  return state;
}

function ensureGenerationState(runId: string) {
  let state = generationStates.get(runId);

  if (!state) {
    state = createGenerationState(runId, 0);
    generationStates.set(runId, state);
  }

  return state;
}

function emit(state: GenerationState, event: GenerationEvent) {
  state.events.push(event);

  for (const subscriber of state.subscribers) {
    subscriber.onEvent(event);
  }
}

async function appendGenerationEvent({
  run,
  campaignSlug,
  projectSlug,
  destinationSlug,
  event,
  outputRoot
}: {
  run: RunState;
  campaignSlug: string;
  projectSlug?: string;
  destinationSlug?: string;
  event: GenerationEvent;
  outputRoot?: string;
}) {
  const runDir = path.join(
    outputRoot ?? DEFAULT_OUTPUT_ROOT,
    ...(projectSlug ? [projectSlug] : []),
    ...(destinationSlug ? [destinationSlug] : []),
    campaignSlug,
    run.runId
  );

  await mkdir(runDir, { recursive: true });
  await appendFile(
    path.join(runDir, "generation-events.jsonl"),
    `${JSON.stringify({
      timestamp: new Date().toISOString(),
      runId: run.runId,
      ...event
    })}\n`,
    "utf8"
  );
}

function completeState(state: GenerationState) {
  state.completed = true;
  state.resolveCompletion();

  for (const subscriber of state.subscribers) {
    subscriber.onComplete();
  }

  state.subscribers.clear();
}

function failRunState(state: GenerationState, error: unknown) {
  state.completed = true;
  state.rejectCompletion(error);

  for (const subscriber of state.subscribers) {
    subscriber.onComplete();
  }

  state.subscribers.clear();
}

function formatSseEvent(event: GenerationEvent) {
  return `data: ${JSON.stringify(event)}\n\n`;
}

function assetIdFor(channel: ChannelKey, size: ChannelSize) {
  return `${channel}_${safeSegment(size.name)}_${size.w}x${size.h}`;
}

function campaignSlugFor(run: RunState) {
  const value = run.creativeAngleSlug ?? run.brief?.campaignName ?? run.brief?.resortName ?? run.runId;

  return safeSegment(value);
}

function projectSlugFor(run: RunState) {
  return run.projectSlug ? safeSegment(run.projectSlug) : undefined;
}

function destinationSlugFor(run: RunState) {
  return run.destinationSlug ? safeSegment(run.destinationSlug) : undefined;
}

function seedFor(runId: string, channel: ChannelKey, size: ChannelSize) {
  const seedKey =
    channel === "email_internal"
      ? `${runId}:${channel}:master`
      : `${runId}:${channel}:${size.name}:${size.w}x${size.h}`;
  const hash = createHash("sha256").update(seedKey).digest();

  return hash.readUInt32BE(0) % 2_147_483_647;
}

function safeSegment(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function sharedGenerationStates() {
  const globalStore = globalThis as typeof globalThis & {
    __resortCreativeGenerationStates?: Map<string, GenerationState>;
  };

  globalStore.__resortCreativeGenerationStates ??= new Map<string, GenerationState>();

  return globalStore.__resortCreativeGenerationStates;
}
