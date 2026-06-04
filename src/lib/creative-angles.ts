import { randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  creativeAngleRecordSchema,
  type CreativeAngleRecord,
  type CreativeConcept
} from "../schemas";
import {
  readRun,
  writeRunState,
  type RunState
} from "./runs";

type CreativeAngleStoreOptions = {
  cacheDir?: string;
  now?: () => Date;
};

type CreateRunFromAngleInput = {
  projectId: string;
  destinationSlug: string;
  angleId: string;
};

type CreateRunFromAngleOptions = {
  anglesCacheDir?: string;
  runsCacheDir?: string;
  now?: () => Date;
};

const DEFAULT_ANGLES_DIR = path.join(process.cwd(), "cache", "creative-angles");
const ULID_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export async function saveCreativeAnglesForRun(
  run: RunState,
  concepts: readonly CreativeConcept[],
  options: CreativeAngleStoreOptions = {}
) {
  if (!run.projectId) {
    throw new Error("Creative angles require a project.");
  }

  if (!run.destinationSlug) {
    throw new Error("Creative angles require a destination.");
  }

  const saved: CreativeAngleRecord[] = [];

  for (const [index, concept] of concepts.entries()) {
    const existing = await findExistingAngle(run, concept, options);
    const timestamp = timestampForIndex(options.now?.() ?? new Date(), index);
    const record = creativeAngleRecordSchema.parse({
      angleId: existing?.angleId ?? generateUlid(timestamp),
      projectId: run.projectId,
      projectName: run.projectName,
      projectSlug: run.projectSlug,
      destinationName: run.destinationName,
      destinationSlug: run.destinationSlug,
      sourceRunId: run.runId,
      sourceConceptId: concept.id,
      title: concept.title,
      slug: existing?.slug ?? safeSegment(concept.title),
      description: concept.description,
      heroVisual: concept.heroVisual,
      adStructure: concept.adStructure,
      approvedElementsUsed: concept.approvedElementsUsed,
      avoid: concept.avoid,
      referenceImageUrls: run.creativeWorkspace?.referenceImageUrls ?? [],
      status: existing?.status ?? "draft",
      createdAt: existing?.createdAt ?? timestamp.toISOString(),
      updatedAt: timestamp.toISOString(),
      defaultSelectedChannels: run.selectedChannels ?? [],
      defaultSelectedChannelSizes: run.selectedChannelSizes,
      defaultModelSelections: run.modelSelections,
      defaultDryRun: run.dryRun,
      defaultEstimatedCostUsd: run.estimatedCostUsd,
      defaultRequiresCostConfirm: run.requiresCostConfirm,
      briefSnapshot: run.brief,
      generatedRunIds: existing?.generatedRunIds ?? []
    });

    await writeCreativeAngle(record, options);
    saved.push(record);
  }

  return saved;
}

export async function listCreativeAngles({
  projectId,
  destinationSlug,
  includeArchived = false,
  cacheDir
}: {
  projectId: string;
  destinationSlug?: string;
  includeArchived?: boolean;
  cacheDir?: string;
}) {
  const root = projectAngleDir(projectId, cacheDir);
  const destinationSlugs = destinationSlug ? [destinationSlug] : await listDirectories(root);
  const records: CreativeAngleRecord[] = [];

  for (const slug of destinationSlugs) {
    const dir = path.join(root, safeSegment(slug));
    const fileNames = await listJsonFiles(dir);
    const loaded = await Promise.all(
      fileNames.map(async (fileName) => {
        try {
          return creativeAngleRecordSchema.parse(
            JSON.parse(await readFile(path.join(dir, fileName), "utf8"))
          );
        } catch {
          return null;
        }
      })
    );

    records.push(
      ...loaded.filter((record): record is CreativeAngleRecord =>
        Boolean(record && (includeArchived || record.status !== "archived"))
      )
    );
  }

  return records.sort((left, right) => {
    const byDate = right.updatedAt.localeCompare(left.updatedAt);

    return byDate || right.title.localeCompare(left.title);
  });
}

export async function readCreativeAngle(
  input: CreateRunFromAngleInput,
  options: CreativeAngleStoreOptions = {}
) {
  try {
    return creativeAngleRecordSchema.parse(
      JSON.parse(await readFile(getCreativeAnglePath(input, options), "utf8"))
    );
  } catch {
    return null;
  }
}

export async function createRunFromCreativeAngle(
  input: CreateRunFromAngleInput,
  options: CreateRunFromAngleOptions = {}
) {
  const angle = await readCreativeAngle(input, { cacheDir: options.anglesCacheDir });

  if (!angle) {
    throw new Error(`Creative angle not found: ${input.angleId}`);
  }

  const sourceRun = await readRun(angle.sourceRunId, { cacheDir: options.runsCacheDir });
  const now = options.now?.() ?? new Date();
  const concept = conceptFromAngle(angle);
  const run: RunState = {
    runId: generateUlid(now),
    projectId: angle.projectId,
    projectName: angle.projectName,
    projectSlug: angle.projectSlug,
    landingPageUrl: sourceRun?.landingPageUrl,
    destinationName: angle.destinationName,
    destinationSlug: angle.destinationSlug,
    creativeAngleId: angle.angleId,
    creativeAngleTitle: angle.title,
    creativeAngleSlug: angle.slug,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    scrapedBrief: sourceRun?.scrapedBrief ?? scrapedSnapshotFromBrief(angle),
    brief: angle.briefSnapshot ?? sourceRun?.brief,
    selectedChannels: angle.defaultSelectedChannels,
    selectedChannelSizes: angle.defaultSelectedChannelSizes,
    modelSelections: angle.defaultModelSelections,
    dryRun: angle.defaultDryRun,
    estimatedCostUsd: angle.defaultEstimatedCostUsd,
    requiresCostConfirm: angle.defaultRequiresCostConfirm,
    creativeWorkspace: {
      status: "concepts_ready",
      elementsApproved: true,
      referenceImageUrls: angle.referenceImageUrls ?? [],
      messages: [
        {
          role: "assistant",
          content: `Loaded saved creative angle "${angle.title}". Review channels and models, then approve this angle to create prompts.`,
          createdAt: now.toISOString()
        }
      ],
      concepts: [concept]
    }
  };

  await writeRunState(run, { cacheDir: options.runsCacheDir });
  await writeCreativeAngle(
    {
      ...angle,
      updatedAt: now.toISOString(),
      generatedRunIds: Array.from(new Set([...angle.generatedRunIds, run.runId]))
    },
    { cacheDir: options.anglesCacheDir }
  );

  return run;
}

export async function markCreativeAngleApproved(
  input: CreateRunFromAngleInput,
  options: CreativeAngleStoreOptions = {}
) {
  const angle = await readCreativeAngle(input, options);

  if (!angle) {
    return null;
  }

  const updated = creativeAngleRecordSchema.parse({
    ...angle,
    status: angle.status === "generated" ? "generated" : "approved",
    updatedAt: (options.now?.() ?? new Date()).toISOString()
  });

  await writeCreativeAngle(updated, options);

  return updated;
}

function conceptFromAngle(angle: CreativeAngleRecord): CreativeConcept {
  return {
    id: angle.sourceConceptId,
    title: angle.title,
    description: angle.description,
    heroVisual: angle.heroVisual,
    adStructure: angle.adStructure,
    approvedElementsUsed: angle.approvedElementsUsed,
    avoid: angle.avoid
  };
}

function scrapedSnapshotFromBrief(angle: CreativeAngleRecord): RunState["scrapedBrief"] {
  const brief = angle.briefSnapshot;

  return {
    resortName: brief?.resortName ?? null,
    headline: brief?.headline ?? null,
    subheadline: brief?.subheadline ?? null,
    offer: brief?.offer ?? null,
    validDates: brief?.validDates ?? null,
    ctaText: brief?.ctaText ?? null,
    heroImageUrl: brief?.heroImageUrl ?? null,
    brandColors: brief?.brandColors ?? [],
    location: brief?.location ?? null
  };
}

async function findExistingAngle(
  run: RunState,
  concept: CreativeConcept,
  options: CreativeAngleStoreOptions
) {
  if (!run.projectId || !run.destinationSlug) {
    return null;
  }

  const existing = await listCreativeAngles({
    projectId: run.projectId,
    destinationSlug: run.destinationSlug,
    includeArchived: true,
    cacheDir: options.cacheDir
  });

  return (
    existing.find(
      (angle) => angle.sourceRunId === run.runId && angle.sourceConceptId === concept.id
    ) ?? null
  );
}

async function writeCreativeAngle(
  record: CreativeAngleRecord,
  options: CreativeAngleStoreOptions
) {
  await mkdir(getCreativeAngleDir(record, options), { recursive: true });
  await writeFile(
    getCreativeAnglePath(record, options),
    JSON.stringify(creativeAngleRecordSchema.parse(record), null, 2),
    "utf8"
  );
}

function getCreativeAnglePath(
  input: Pick<CreativeAngleRecord, "projectId" | "destinationSlug" | "angleId">,
  options: CreativeAngleStoreOptions = {}
) {
  return path.join(getCreativeAngleDir(input, options), `${safeSegment(input.angleId)}.json`);
}

function getCreativeAngleDir(
  input: Pick<CreativeAngleRecord, "projectId" | "destinationSlug">,
  options: CreativeAngleStoreOptions = {}
) {
  return path.join(
    projectAngleDir(input.projectId, options.cacheDir),
    safeSegment(input.destinationSlug)
  );
}

function projectAngleDir(projectId: string, cacheDir?: string) {
  return path.join(cacheDir ?? DEFAULT_ANGLES_DIR, safeSegment(projectId));
}

async function listDirectories(dir: string) {
  try {
    const entries = await readdir(dir, { withFileTypes: true });

    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return [];
  }
}

async function listJsonFiles(dir: string) {
  try {
    const entries = await readdir(dir, { withFileTypes: true });

    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

function timestampForIndex(now: Date, index: number) {
  return new Date(now.valueOf() + index);
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

function safeSegment(value: string) {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);

  return slug || "angle";
}
