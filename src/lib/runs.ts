import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  channelKeySchema,
  creativeBriefSchema,
  creativeWorkspaceSchema,
  promptAssignmentSchema,
  reviewedPromptSchema,
  type ChannelKey,
  type CreativeBrief,
  type CreativeAngleRecord,
  type CreativeWorkspace,
  type ImageModelOptions,
  type ModelInfo,
  type PromptAssignment,
  type ReviewedPrompt
} from "../schemas";
import {
  channels,
  normalizeSelectedChannelSizes,
  type SelectedChannelSizes
} from "../config/channels";
import type { ScrapedCreativeBrief } from "../scraper/landing-page";
import { inferDestination } from "./destinations";
import type { ProjectReference } from "./projects";

export type RunState = {
  runId: string;
  projectId?: string;
  projectName?: string;
  projectSlug?: string;
  landingPageUrl?: string;
  destinationName?: string;
  destinationSlug?: string;
  creativeAngleId?: string;
  creativeAngleTitle?: string;
  creativeAngleSlug?: string;
  createdAt: string;
  updatedAt: string;
  scrapedBrief: ScrapedCreativeBrief;
  brief?: CreativeBrief;
  selectedChannels?: ChannelKey[];
  selectedChannelSizes?: SelectedChannelSizes;
  modelSelections?: Partial<Record<ChannelKey, ModelSelectionState>>;
  promptAssignments?: PromptAssignment[];
  reviewedPrompts?: ReviewedPrompt[];
  creativeWorkspace?: CreativeWorkspace;
  dryRun?: boolean;
  estimatedCostUsd?: number;
  requiresCostConfirm?: boolean;
};

type RunStoreOptions = {
  cacheDir?: string;
  now?: () => Date;
  project?: ProjectReference;
  sourceUrl?: string;
};

export type ModelSelectionState = {
  imageModelId?: string;
  videoModelId?: string;
  imageModel?: ModelInfo;
  videoModel?: ModelInfo;
  imageOptions?: ImageModelOptions;
  generateVideo?: boolean;
  forceNoTextMode?: boolean;
};

export type ModelSelectionsUpdate = {
  dryRun: boolean;
  estimatedCostUsd?: number;
  requiresCostConfirm?: boolean;
  selections: Partial<Record<ChannelKey, ModelSelectionState>>;
};

export type ReviewPromptsUpdate = {
  promptAssignments: PromptAssignment[];
  reviewedPrompts: ReviewedPrompt[];
};

export type CreativeWorkspaceUpdate = CreativeWorkspace;

const DEFAULT_RUNS_DIR = path.join(process.cwd(), "cache", "runs");
const ULID_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export async function createRun(
  scrapedBrief: ScrapedCreativeBrief,
  options: RunStoreOptions = {}
) {
  const now = options.now?.() ?? new Date();
  const destination = inferDestination(scrapedBrief, options.sourceUrl);
  const run: RunState = {
    runId: generateUlid(now),
    projectId: options.project?.projectId,
    projectName: options.project?.name,
    projectSlug: options.project?.slug,
    landingPageUrl: options.sourceUrl,
    destinationName: destination?.destinationName,
    destinationSlug: destination?.destinationSlug,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    scrapedBrief
  };

  await writeRun(run, options);

  return run;
}

export async function readRun(runId: string, options: RunStoreOptions = {}) {
  try {
    return JSON.parse(await readFile(getRunPath(runId, options), "utf8")) as RunState;
  } catch {
    return null;
  }
}

export async function updateRunBrief(
  runId: string,
  brief: CreativeBrief,
  options: RunStoreOptions = {}
) {
  const run = await readRun(runId, options);

  if (!run) {
    throw new Error(`Run not found: ${runId}`);
  }

  const parsedBrief = creativeBriefSchema.parse(brief);
  const updated: RunState = {
    ...run,
    updatedAt: (options.now?.() ?? new Date()).toISOString(),
    brief: parsedBrief
  };

  await writeRun(updated, options);

  return updated;
}

export async function updateRunChannels(
  runId: string,
  selectedChannels: ChannelKey[],
  selectedChannelSizesOrOptions: SelectedChannelSizes | RunStoreOptions = {},
  options: RunStoreOptions = {}
) {
  const hasExplicitSizes = isSelectedChannelSizes(selectedChannelSizesOrOptions);
  const selectedChannelSizes = hasExplicitSizes ? selectedChannelSizesOrOptions : undefined;
  const storeOptions = hasExplicitSizes ? options : selectedChannelSizesOrOptions;
  const run = await readRun(runId, storeOptions);

  if (!run) {
    throw new Error(`Run not found: ${runId}`);
  }

  const parsedChannels = selectedChannels.map((channel) => channelKeySchema.parse(channel));
  validateSelectedChannelSizes(parsedChannels, selectedChannelSizes);
  const modelSelections = Object.fromEntries(
    Object.entries(run.modelSelections ?? {}).filter(([channel]) =>
      parsedChannels.includes(channel as ChannelKey)
    )
  ) as Partial<Record<ChannelKey, ModelSelectionState>>;
  const updated: RunState = {
    ...run,
    updatedAt: (storeOptions.now?.() ?? new Date()).toISOString(),
    selectedChannels: parsedChannels,
    selectedChannelSizes: normalizeSelectedChannelSizes(parsedChannels, selectedChannelSizes),
    modelSelections
  };

  await writeRun(updated, storeOptions);

  return updated;
}

export async function updateRunModelSelections(
  runId: string,
  update: ModelSelectionsUpdate,
  options: RunStoreOptions = {}
) {
  const run = await readRun(runId, options);

  if (!run) {
    throw new Error(`Run not found: ${runId}`);
  }

  const selectedChannels = run.selectedChannels ?? [];
  const selections = Object.fromEntries(
    Object.entries(update.selections).filter(([channel]) =>
      selectedChannels.includes(channel as ChannelKey)
    )
  ) as Partial<Record<ChannelKey, ModelSelectionState>>;
  const updated: RunState = {
    ...run,
    updatedAt: (options.now?.() ?? new Date()).toISOString(),
    dryRun: update.dryRun,
    estimatedCostUsd: update.estimatedCostUsd,
    requiresCostConfirm: update.requiresCostConfirm,
    modelSelections: selections
  };

  await writeRun(updated, options);

  return updated;
}

export async function updateRunReviewPrompts(
  runId: string,
  update: ReviewPromptsUpdate,
  options: RunStoreOptions = {}
) {
  const run = await readRun(runId, options);

  if (!run) {
    throw new Error(`Run not found: ${runId}`);
  }

  const promptAssignments = update.promptAssignments.map((assignment) =>
    promptAssignmentSchema.parse(assignment)
  );
  const reviewedPrompts = update.reviewedPrompts.map((prompt) =>
    reviewedPromptSchema.parse(prompt)
  );
  const updated: RunState = {
    ...run,
    updatedAt: (options.now?.() ?? new Date()).toISOString(),
    promptAssignments,
    reviewedPrompts
  };

  await writeRun(updated, options);

  return updated;
}

export async function updateRunCreativeWorkspace(
  runId: string,
  update: CreativeWorkspaceUpdate,
  options: RunStoreOptions = {}
) {
  const run = await readRun(runId, options);

  if (!run) {
    throw new Error(`Run not found: ${runId}`);
  }

  const creativeWorkspace = creativeWorkspaceSchema.parse(update);
  const updated: RunState = {
    ...run,
    updatedAt: (options.now?.() ?? new Date()).toISOString(),
    creativeWorkspace,
    reviewedPrompts: creativeWorkspace.generatedPrompts ?? run.reviewedPrompts
  };

  await writeRun(updated, options);

  return updated;
}

export async function updateRunCreativeAngle(
  runId: string,
  angle: Pick<CreativeAngleRecord, "angleId" | "title" | "slug">,
  options: RunStoreOptions = {}
) {
  const run = await readRun(runId, options);

  if (!run) {
    throw new Error(`Run not found: ${runId}`);
  }

  const updated: RunState = {
    ...run,
    updatedAt: (options.now?.() ?? new Date()).toISOString(),
    creativeAngleId: angle.angleId,
    creativeAngleTitle: angle.title,
    creativeAngleSlug: angle.slug
  };

  await writeRun(updated, options);

  return updated;
}

function validateSelectedChannelSizes(
  selectedChannels: ChannelKey[],
  selectedChannelSizes: SelectedChannelSizes | undefined
) {
  if (!selectedChannelSizes) {
    return;
  }

  for (const channel of selectedChannels) {
    const selectedNames = selectedChannelSizes[channel];

    if (!selectedNames || selectedNames.length === 0) {
      throw new Error(`Select at least one size for ${channel}.`);
    }

    const validNames = new Set(channels[channel].sizes.map((size) => size.name));
    const invalid = selectedNames.filter((sizeName) => !validNames.has(sizeName));

    if (invalid.length > 0) {
      throw new Error(`Invalid size for ${channel}: ${invalid.join(", ")}`);
    }
  }
}

function isSelectedChannelSizes(
  value: SelectedChannelSizes | RunStoreOptions
): value is SelectedChannelSizes {
  return Object.values(value).some((entry) => Array.isArray(entry));
}

export function getRunPath(runId: string, options: RunStoreOptions = {}) {
  if (!/^[0-9A-HJKMNP-TV-Z]{26}$/.test(runId)) {
    throw new Error("Invalid runId");
  }

  return path.join(options.cacheDir ?? DEFAULT_RUNS_DIR, `${runId}.json`);
}

async function writeRun(run: RunState, options: RunStoreOptions) {
  const cacheDir = options.cacheDir ?? DEFAULT_RUNS_DIR;

  await mkdir(cacheDir, { recursive: true });
  await writeFile(getRunPath(run.runId, options), JSON.stringify(run, null, 2));
}

export async function writeRunState(run: RunState, options: RunStoreOptions = {}) {
  await writeRun(run, options);
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
