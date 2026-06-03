import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  createRun,
  readRun,
  updateRunChannels,
  updateRunBrief,
  updateRunCreativeWorkspace,
  updateRunModelSelections,
  updateRunReviewPrompts,
  type RunState
} from "../src/lib/runs";

const scrapedBrief = {
  resortName: "Westgate Lakes Resort & Spa",
  headline: "Save on Orlando villas",
  subheadline: "Spacious villas near the parks",
  offer: "Save 30%",
  validDates: "May 1 - June 30, 2026",
  ctaText: "Book Now",
  heroImageUrl: "https://example.com/hero.jpg",
  brandColors: ["#004f71"],
  location: "Orlando, FL"
};

describe("run persistence", () => {
  it("creates a ULID-keyed run and reads it back from disk", async () => {
    const cacheDir = await mkdtemp(path.join(tmpdir(), "runs-"));

    try {
      const run = await createRun(scrapedBrief, { cacheDir });
      const persisted = await readRun(run.runId, { cacheDir });

      expect(run.runId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
      expect(persisted?.scrapedBrief).toEqual(scrapedBrief);
    } finally {
      await rm(cacheDir, { force: true, recursive: true });
    }
  });

  it("attaches project metadata when creating a project run", async () => {
    const cacheDir = await mkdtemp(path.join(tmpdir(), "runs-"));

    try {
      const run = await createRun(scrapedBrief, {
        cacheDir,
        project: {
          projectId: "01HX0000000000000000000001",
          name: "Westgate Summer Campaigns",
          slug: "westgate-summer-campaigns"
        }
      });
      const persisted = await readRun(run.runId, { cacheDir });

      expect(persisted).toMatchObject({
        projectId: "01HX0000000000000000000001",
        projectName: "Westgate Summer Campaigns",
        projectSlug: "westgate-summer-campaigns"
      });
    } finally {
      await rm(cacheDir, { force: true, recursive: true });
    }
  });

  it("attaches destination metadata from the scrape when creating a run", async () => {
    const cacheDir = await mkdtemp(path.join(tmpdir(), "runs-"));

    try {
      const run = await createRun(
        {
          ...scrapedBrief,
          location: "Orlando, FL"
        },
        {
          cacheDir,
          sourceUrl:
            "https://www.westgatereservations.com/specials/orlando-4th-of-july-vacation-package/"
        }
      );
      const persisted = await readRun(run.runId, { cacheDir });

      expect(persisted).toMatchObject({
        landingPageUrl:
          "https://www.westgatereservations.com/specials/orlando-4th-of-july-vacation-package/",
        destinationName: "Orlando",
        destinationSlug: "orlando"
      });
    } finally {
      await rm(cacheDir, { force: true, recursive: true });
    }
  });

  it("updates the resolved editable brief without losing scrape data", async () => {
    const cacheDir = await mkdtemp(path.join(tmpdir(), "runs-"));

    try {
      const run = await createRun(scrapedBrief, { cacheDir });
      const updated = await updateRunBrief(
        run.runId,
        {
          ...scrapedBrief,
          resortName: "Edited Resort",
          campaignName: "Summer Push",
          promotionSummary: "Family summer campaign",
          targetAudience: "families",
          tone: "family-fun",
          mustIncludeVisualElements: ["pool"],
          mustAvoidElements: ["competitors"]
        },
        { cacheDir }
      );

      expect((updated as RunState).brief?.resortName).toBe("Edited Resort");
      expect(updated.scrapedBrief.resortName).toBe(scrapedBrief.resortName);
    } finally {
      await rm(cacheDir, { force: true, recursive: true });
    }
  });

  it("persists selected channels and model selections", async () => {
    const cacheDir = await mkdtemp(path.join(tmpdir(), "runs-"));

    try {
      const run = await createRun(scrapedBrief, { cacheDir });
      await updateRunChannels(run.runId, ["meta", "website"], { cacheDir });
      const updated = await updateRunModelSelections(
        run.runId,
        {
          dryRun: true,
          estimatedCostUsd: 6,
          requiresCostConfirm: true,
          selections: {
            meta: { imageModelId: "fal-ai/flux-pro/v1.1-ultra" },
            website: {
              imageModelId: "fal-ai/ideogram/v3",
              forceNoTextMode: true
            }
          }
        },
        { cacheDir }
      );

      expect(updated.selectedChannels).toEqual(["meta", "website"]);
      expect(updated.selectedChannelSizes).toEqual({
        meta: [
          "Feed portrait",
          "Stories/Reels",
          "Feed square",
          "Feed landscape"
        ],
        website: ["Hero wide", "Banner short", "Feature large", "Feature small", "Strip banner"]
      });
      expect(updated.modelSelections?.website).toMatchObject({
        imageModelId: "fal-ai/ideogram/v3",
        forceNoTextMode: true
      });
      expect(updated.dryRun).toBe(true);
      expect(updated.estimatedCostUsd).toBe(6);
      expect(updated.requiresCostConfirm).toBe(true);
    } finally {
      await rm(cacheDir, { force: true, recursive: true });
    }
  });

  it("persists selected sizes per selected channel", async () => {
    const cacheDir = await mkdtemp(path.join(tmpdir(), "runs-"));

    try {
      const run = await createRun(scrapedBrief, { cacheDir });
      const updated = await updateRunChannels(
        run.runId,
        ["meta"],
        { meta: ["Feed square"] },
        { cacheDir }
      );

      expect(updated.selectedChannels).toEqual(["meta"]);
      expect(updated.selectedChannelSizes).toEqual({ meta: ["Feed square"] });
    } finally {
      await rm(cacheDir, { force: true, recursive: true });
    }
  });

  it("persists prompt assignments and final reviewed prompts", async () => {
    const cacheDir = await mkdtemp(path.join(tmpdir(), "runs-"));

    try {
      const run = await createRun(scrapedBrief, { cacheDir });
      const updated = await updateRunReviewPrompts(
        run.runId,
        {
          promptAssignments: [
            {
              id: "prompt-meta",
              name: "Meta Orlando",
              prompt: "Energetic Orlando family resort arrival.",
              negativePrompt: "no dark lobby",
              targets: [{ channel: "meta", sizeNames: ["Feed square"] }]
            }
          ],
          reviewedPrompts: [
            {
              assetId: "meta_feed-square_1200x1200",
              channel: "meta",
              sizeName: "Feed square",
              prompt: "Final reviewed positive prompt",
              negativePrompt: "Final reviewed negatives"
            }
          ]
        },
        { cacheDir }
      );

      expect(updated.promptAssignments?.[0]).toMatchObject({
        id: "prompt-meta",
        prompt: "Energetic Orlando family resort arrival."
      });
      expect(updated.reviewedPrompts?.[0]).toMatchObject({
        assetId: "meta_feed-square_1200x1200",
        prompt: "Final reviewed positive prompt"
      });
    } finally {
      await rm(cacheDir, { force: true, recursive: true });
    }
  });

  it("persists the creative-agent chat, approved concept, and generated prompts", async () => {
    const cacheDir = await mkdtemp(path.join(tmpdir(), "runs-"));

    try {
      const run = await createRun(scrapedBrief, { cacheDir });
      const updated = await updateRunCreativeWorkspace(
        run.runId,
        {
          status: "prompts_ready",
          elementsApproved: true,
          referenceImageUrls: ["https://fal.media/files/property-reference.png"],
          adElements: [
            {
              id: "destination",
              label: "Destination",
              value: "Orlando",
              source: "scrape",
              selected: true
            },
            {
              id: "headline",
              label: "Headline",
              value: "Save on Orlando villas",
              source: "scrape",
              selected: false
            }
          ],
          messages: [
            {
              role: "assistant",
              content: "What reference details should I know?",
              createdAt: "2026-05-28T12:00:00.000Z"
            },
            {
              role: "user",
              content: "Use the resort entrance at twilight.",
              createdAt: "2026-05-28T12:01:00.000Z"
            }
          ],
          concepts: [
            {
              id: "concept-1",
              title: "Firework Flag Sky",
              description: "A translucent patriotic flag made from fireworks above the resort."
            }
          ],
          approvedConceptId: "concept-1",
          generatedPrompts: [
            {
              assetId: "meta_feed-square_1200x1200",
              channel: "meta",
              sizeName: "Feed square",
              prompt: "Approved AI prompt",
              negativePrompt: "no brand marks"
            }
          ]
        },
        { cacheDir }
      );

      expect(updated.creativeWorkspace).toMatchObject({
        status: "prompts_ready",
        approvedConceptId: "concept-1",
        elementsApproved: true,
        referenceImageUrls: ["https://fal.media/files/property-reference.png"]
      });
      expect(updated.creativeWorkspace?.adElements?.find((element) => element.id === "headline"))
        .toMatchObject({ selected: false });
      expect(updated.creativeWorkspace?.messages).toHaveLength(2);
      expect(updated.creativeWorkspace?.generatedPrompts?.[0]).toMatchObject({
        assetId: "meta_feed-square_1200x1200",
        prompt: "Approved AI prompt"
      });
    } finally {
      await rm(cacheDir, { force: true, recursive: true });
    }
  });
});
