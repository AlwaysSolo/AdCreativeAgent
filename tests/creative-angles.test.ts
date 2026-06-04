import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  createRunFromCreativeAngle,
  listCreativeAngles,
  saveCreativeAnglesForRun
} from "../src/lib/creative-angles";
import {
  createRun,
  readRun,
  updateRunBrief,
  updateRunChannels,
  updateRunModelSelections
} from "../src/lib/runs";
import type { CreativeBrief, CreativeConcept, ModelInfo } from "../src/schemas";

const brief: CreativeBrief = {
  resortName: "Westgate Lakes Resort & Spa",
  headline: "Orlando 4th of July Vacation Package",
  offer: "from $99",
  subheadline: "Four days and three nights near the parks",
  ctaText: "Book Now",
  brandColors: ["#0e2545", "#c4a55d"],
  location: "Orlando, FL",
  campaignName: "July 4th",
  promotionSummary: "Promote an Orlando Independence Day getaway.",
  targetAudience: "families",
  tone: "bold and cinematic",
  mustIncludeVisualElements: ["fireworks in the sky"],
  mustAvoidElements: ["parking lots"]
};

const imageModel: ModelInfo = {
  id: "openai/gpt-image-2",
  name: "GPT Image 2",
  kind: "image",
  capabilities: {
    supportsOnImageText: true
  }
};

const concepts: CreativeConcept[] = [
  {
    id: "concept-1",
    title: "Fireworks Over Pool",
    description: "A patriotic poolside celebration angle with fireworks reflected in water.",
    heroVisual: "Blue-hour resort pool with red, white, and blue light in the sky.",
    adStructure: "Simple offer block and destination-led headline.",
    approvedElementsUsed: ["Destination: Orlando", "Offer / price: from $99"],
    avoid: ["No logo", "No brand name"]
  },
  {
    id: "concept-2",
    title: "Patriotic Arrival Moment",
    description: "A family-arrival angle with celebratory light and premium resort energy.",
    heroVisual: "Warm resort entrance with subtle fireworks glow overhead.",
    adStructure: "Compact headline with price and stay length.",
    approvedElementsUsed: ["Destination: Orlando", "Stay length: 3 Nights"],
    avoid: ["No extra taglines"]
  }
];

describe("creative angle library", () => {
  it("saves all generated concepts as project destination angle records", async () => {
    const runsCacheDir = await mkdtemp(path.join(tmpdir(), "runs-"));
    const anglesCacheDir = await mkdtemp(path.join(tmpdir(), "angles-"));

    try {
      const run = await createReadyRun(runsCacheDir);
      const saved = await saveCreativeAnglesForRun(run, concepts, {
        cacheDir: anglesCacheDir,
        now: () => new Date("2026-05-28T12:00:00.000Z")
      });
      const listed = await listCreativeAngles({
        projectId: "01HX0000000000000000000001",
        destinationSlug: "orlando",
        cacheDir: anglesCacheDir
      });

      expect(saved).toHaveLength(2);
      expect(listed.map((angle) => angle.title)).toEqual([
        "Patriotic Arrival Moment",
        "Fireworks Over Pool"
      ]);
      expect(listed[0]).toMatchObject({
        projectId: "01HX0000000000000000000001",
        projectSlug: "july-4th",
        destinationSlug: "orlando",
        sourceRunId: run.runId,
        sourceConceptId: "concept-2",
        status: "draft",
        defaultSelectedChannels: ["meta"],
        defaultSelectedChannelSizes: { meta: ["Feed square"] },
        defaultModelSelections: {
          meta: {
            imageModelId: imageModel.id,
            imageOptions: { quality: "high" }
          }
        }
      });
    } finally {
      await rm(runsCacheDir, { force: true, recursive: true });
      await rm(anglesCacheDir, { force: true, recursive: true });
    }
  });

  it("creates a new run from a saved angle with original defaults and allows adding channels", async () => {
    const runsCacheDir = await mkdtemp(path.join(tmpdir(), "runs-"));
    const anglesCacheDir = await mkdtemp(path.join(tmpdir(), "angles-"));

    try {
      const sourceRun = await createReadyRun(runsCacheDir);
      const [savedAngle] = await saveCreativeAnglesForRun(sourceRun, [concepts[0]], {
        cacheDir: anglesCacheDir,
        now: () => new Date("2026-05-28T12:00:00.000Z")
      });
      const newRun = await createRunFromCreativeAngle(
        {
          projectId: "01HX0000000000000000000001",
          destinationSlug: "orlando",
          angleId: savedAngle.angleId
        },
        {
          anglesCacheDir,
          runsCacheDir,
          now: () => new Date("2026-05-29T12:00:00.000Z")
        }
      );

      expect(newRun.runId).not.toBe(sourceRun.runId);
      expect(newRun).toMatchObject({
        projectId: "01HX0000000000000000000001",
        destinationSlug: "orlando",
        creativeAngleId: savedAngle.angleId,
        creativeAngleTitle: "Fireworks Over Pool",
        creativeAngleSlug: "fireworks-over-pool",
        selectedChannels: ["meta"],
        selectedChannelSizes: { meta: ["Feed square"] },
        dryRun: false
      });
      expect(newRun.modelSelections?.meta?.imageOptions).toEqual({ quality: "high" });
      expect(newRun.creativeWorkspace).toMatchObject({
        status: "concepts_ready",
        concepts: [expect.objectContaining({ title: "Fireworks Over Pool" })]
      });

      const withAddedChannel = await updateRunChannels(
        newRun.runId,
        ["meta", "seo"],
        {
          meta: ["Feed square"],
          seo: ["Horizontal hero"]
        },
        { cacheDir: runsCacheDir }
      );
      const persisted = await readRun(newRun.runId, { cacheDir: runsCacheDir });

      expect(withAddedChannel.selectedChannels).toEqual(["meta", "seo"]);
      expect(persisted?.selectedChannelSizes).toEqual({
        meta: ["Feed square"],
        seo: ["Horizontal hero"]
      });
    } finally {
      await rm(runsCacheDir, { force: true, recursive: true });
      await rm(anglesCacheDir, { force: true, recursive: true });
    }
  });
});

async function createReadyRun(cacheDir: string) {
  const run = await createRun(
    {
      resortName: brief.resortName,
      headline: brief.headline,
      subheadline: brief.subheadline ?? null,
      offer: brief.offer,
      validDates: brief.validDates ?? null,
      ctaText: brief.ctaText ?? null,
      heroImageUrl: brief.heroImageUrl ?? null,
      brandColors: brief.brandColors,
      location: brief.location ?? null
    },
    {
      cacheDir,
      sourceUrl: "https://example.com/orlando-july-4th",
      project: {
        projectId: "01HX0000000000000000000001",
        name: "July 4th",
        slug: "july-4th"
      }
    }
  );

  await updateRunBrief(run.runId, brief, { cacheDir });
  await updateRunChannels(run.runId, ["meta"], { meta: ["Feed square"] }, { cacheDir });
  await updateRunModelSelections(
    run.runId,
    {
      dryRun: false,
      estimatedCostUsd: 0.08,
      requiresCostConfirm: false,
      selections: {
        meta: {
          imageModelId: imageModel.id,
          imageModel,
          imageOptions: { quality: "high" }
        }
      }
    },
    { cacheDir }
  );

  const readyRun = await readRun(run.runId, { cacheDir });

  if (!readyRun) {
    throw new Error("Expected run to persist.");
  }

  return readyRun;
}
