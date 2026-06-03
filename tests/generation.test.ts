import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { vi } from "vitest";

import { POST as generatePost } from "../app/api/generate/route";
import { GET as generateStreamGet } from "../app/api/generate/stream/route";
import { channels } from "../src/config/channels";
import type { FalAssetResult } from "../src/generators/fal-client";
import {
  getGenerationEvents,
  resetGenerationState,
  startGenerationRun,
  waitForGenerationRun
} from "../src/lib/generation";
import {
  createRun,
  getRunPath,
  updateRunBrief,
  updateRunChannels,
  updateRunModelSelections,
  type RunState
} from "../src/lib/runs";
import type { BuiltPrompt } from "../src/generators/prompt-builder";
import type { CreativeBrief, ModelInfo } from "../src/schemas";

const brief: CreativeBrief = {
  resortName: "Westgate Lakes Resort & Spa",
  headline: "Spring Villa Escape",
  offer: "Save 30%",
  subheadline: "Spacious Orlando resort villas near the parks",
  ctaText: "Book Now",
  brandColors: ["#005A8B"],
  location: "Orlando, Florida",
  campaignName: "Spring Villas",
  promotionSummary: "Promote spring stays with room to relax.",
  targetAudience: "couples and family travelers",
  tone: "relaxed premium",
  mustIncludeVisualElements: ["poolside cabanas"],
  mustAvoidElements: ["competitor logos"]
};

const imageModel: ModelInfo = {
  id: "fal-ai/flux-pro/v1.1-ultra",
  name: "Flux Pro Ultra",
  kind: "image",
  tags: ["text-to-image", "photorealistic"],
  capabilities: {
    textToImage: true,
    supportsOnImageText: false,
    supportedAspects: ["1:1", "16:9", "21:9"]
  }
};

describe("generation routes", () => {
  let outputRoot: string;

  beforeEach(async () => {
    resetGenerationState();
    outputRoot = await mkdtemp(path.join(os.tmpdir(), "generation-route-"));
  });

  afterEach(async () => {
    resetGenerationState();
    await rm(outputRoot, { force: true, recursive: true });
  });

  it("POST returns the runId immediately and the SSE route replays per-asset progress", async () => {
    const run = await createReadyRun();

    try {
      const response = await generatePost(
        new Request("http://localhost:3000/api/generate", {
          method: "POST",
          body: JSON.stringify({ runId: run.runId, outputRoot })
        })
      );
      const payload = (await response.json()) as { runId: string; assetCount: number };

      expect(response.status).toBe(202);
      expect(payload).toEqual({ runId: run.runId, assetCount: 2 });

      await waitForGenerationRun(run.runId);

      const streamResponse = await generateStreamGet(
        new Request(`http://localhost:3000/api/generate/stream?runId=${run.runId}`)
      );
      const events = parseSseEvents(await readStream(streamResponse.body));
      const doneEvents = events.filter((event) => event.status === "done");

      expect(streamResponse.headers.get("content-type")).toContain("text/event-stream");
      expect(events.map((event) => event.status)).toEqual(
        expect.arrayContaining(["queued", "running", "done"])
      );
      expect(doneEvents).toHaveLength(2);
      expect(doneEvents.every((event) => event.progress === 100)).toBe(true);
      expect(doneEvents.every((event) => Boolean(event.thumbnailUrl))).toBe(true);

      const costLog = await readFile(
        path.join(outputRoot, "orlando", "spring-villas", run.runId, "cost-log.jsonl"),
        "utf8"
      );
      expect(costLog.trim().split("\n")).toHaveLength(2);
    } finally {
      await rm(getRunPath(run.runId), { force: true });
    }
  });
});

describe("generation orchestrator", () => {
  beforeEach(() => {
    resetGenerationState();
  });

  afterEach(() => {
    resetGenerationState();
  });

  it("uses Promise.allSettled behavior so one failed asset does not stop the rest", async () => {
    const run = readyRunState();
    const postProcessAsset = vi.fn(async ({ rawPath }: { rawPath: string }) => ({
      finalPath: rawPath,
      draftPath: rawPath,
      thumbnailUrl: `/thumbs/${path.basename(rawPath)}`
    }));
    const generateFalAsset = vi.fn(async ({ assetId }: { assetId: string }) => {
      if (assetId.includes("600x585")) {
        throw new Error("fal rejected this size");
      }

      return {
        runId: run.runId,
        assetId,
        modelId: imageModel.id,
        seed: 123,
        status: "dry_run",
        outputPath: `/raw/${assetId}.png`,
        costUsd: 0
      } satisfies FalAssetResult;
    });

    const started = await startGenerationRun(run.runId, {
      readRun: async () => run,
      buildPrompt: async () => builtPrompt(),
      generateFalAsset,
      postProcessAsset
    });

    await waitForGenerationRun(run.runId);

    const events = getGenerationEvents(run.runId);
    expect(started.assetCount).toBe(2);
    expect(events.filter((event) => event.status === "done")).toHaveLength(1);
    expect(events.filter((event) => event.status === "failed")).toEqual([
      expect.objectContaining({
        assetId: expect.stringContaining("600x585"),
        progress: 100,
        error: "fal rejected this size"
      })
    ]);
    expect(postProcessAsset).toHaveBeenCalledTimes(1);
  });

  it("writes dry-run generation outputs under the owning project folder", async () => {
    const outputRoot = await mkdtemp(path.join(os.tmpdir(), "generation-project-output-"));
    const run = {
      ...readyRunState(),
      projectId: "01HX0000000000000000000001",
      projectName: "Westgate Summer Campaigns",
      projectSlug: "westgate-summer-campaigns",
      destinationName: "Orlando",
      destinationSlug: "orlando",
      selectedChannels: ["meta" as const],
      selectedChannelSizes: {
        meta: ["Feed square"]
      },
      modelSelections: {
        meta: {
          imageModelId: imageModel.id,
          imageModel
        }
      }
    };

    try {
      await startGenerationRun(run.runId, {
        outputRoot,
        readRun: async () => run
      });

      await waitForGenerationRun(run.runId);

      const runDir = path.join(
        outputRoot,
        "westgate-summer-campaigns",
        "orlando",
        "spring-villas",
        run.runId
      );
      const costLog = await readFile(path.join(runDir, "cost-log.jsonl"), "utf8");
      const finalAsset = await readFile(
        path.join(runDir, "final", "meta", "meta_feed-square_1200x1200.png")
      );

      expect(costLog).toContain("meta_feed-square_1200x1200");
      expect(finalAsset.length).toBeGreaterThan(0);
    } finally {
      await rm(outputRoot, { force: true, recursive: true });
    }
  });

  it("persists failed generation events so results can explain failed runs after refresh", async () => {
    const outputRoot = await mkdtemp(path.join(os.tmpdir(), "generation-failure-log-"));
    const run = {
      ...readyRunState(),
      selectedChannels: ["meta" as const],
      selectedChannelSizes: {
        meta: ["Feed square"]
      },
      dryRun: false,
      modelSelections: {
        meta: {
          imageModelId: imageModel.id,
          imageModel
        }
      }
    };
    const generateFalAsset = vi.fn(async () => {
      throw new Error("fal.ai authentication failed. Check FAL_KEY in .env.local.");
    });
    const postProcessAsset = vi.fn();

    try {
      await startGenerationRun(run.runId, {
        outputRoot,
        readRun: async () => run,
        buildPrompt: async () => builtPrompt(),
        generateFalAsset,
        postProcessAsset
      });

      await waitForGenerationRun(run.runId);

      const failureLog = await readFile(
        path.join(outputRoot, "spring-villas", run.runId, "generation-events.jsonl"),
        "utf8"
      );
      const [failureEvent] = failureLog.trim().split("\n").map((line) => JSON.parse(line));

      expect(failureEvent).toMatchObject({
        runId: run.runId,
        assetId: "meta_feed-square_1200x1200",
        status: "failed",
        progress: 100,
        error: "fal.ai authentication failed. Check FAL_KEY in .env.local."
      });
      expect(postProcessAsset).not.toHaveBeenCalled();
    } finally {
      await rm(outputRoot, { force: true, recursive: true });
    }
  });

  it("generates only specifically selected channel sizes", async () => {
    const run = {
      ...readyRunState(),
      selectedChannelSizes: {
        email_internal: ["Email square"]
      }
    };
    const postProcessAsset = vi.fn(async ({ rawPath }: { rawPath: string }) => ({
      finalPath: rawPath,
      draftPath: rawPath,
      thumbnailUrl: `/thumbs/${path.basename(rawPath)}`
    }));
    const generateFalAsset = vi.fn(async ({ assetId }: { assetId: string }) => {
      return {
        runId: run.runId,
        assetId,
        modelId: imageModel.id,
        seed: 123,
        status: "dry_run",
        outputPath: `/raw/${assetId}.png`,
        costUsd: 0
      } satisfies FalAssetResult;
    });

    const started = await startGenerationRun(run.runId, {
      readRun: async () => run,
      buildPrompt: async () => builtPrompt(),
      generateFalAsset,
      postProcessAsset
    });

    await waitForGenerationRun(run.runId);

    expect(started.assetCount).toBe(1);
    expect(generateFalAsset).toHaveBeenCalledTimes(1);
    expect(generateFalAsset).toHaveBeenCalledWith(
      expect.objectContaining({
        assetId: "email_internal_email-square_420x420",
        size: { w: 420, h: 420 }
      })
    );
  });

  it("uses final reviewed prompts for matching generated assets", async () => {
    const run = {
      ...readyRunState(),
      selectedChannelSizes: {
        email_internal: ["Email square"]
      },
      reviewedPrompts: [
        {
          assetId: "email_internal_email-square_420x420",
          channel: "email_internal" as const,
          sizeName: "Email square",
          prompt: "Custom email prompt for Orlando package.",
          negativePrompt: "no generic conference room",
          referenceImageUrls: ["https://fal.media/files/email-reference.png"]
        }
      ]
    };
    const postProcessAsset = vi.fn(async ({ rawPath }: { rawPath: string }) => ({
      finalPath: rawPath,
      draftPath: rawPath,
      thumbnailUrl: `/thumbs/${path.basename(rawPath)}`
    }));
    const generateFalAsset = vi.fn(async ({ assetId }: { assetId: string }) => {
      return {
        runId: run.runId,
        assetId,
        modelId: imageModel.id,
        seed: 123,
        status: "dry_run",
        outputPath: `/raw/${assetId}.png`,
        costUsd: 0
      } satisfies FalAssetResult;
    });

    await startGenerationRun(run.runId, {
      readRun: async () => run,
      buildPrompt: async () => builtPrompt(),
      generateFalAsset,
      postProcessAsset
    });

    await waitForGenerationRun(run.runId);

    expect(generateFalAsset).toHaveBeenCalledWith(
      expect.objectContaining({
        assetId: "email_internal_email-square_420x420",
        params: expect.objectContaining({
          prompt: "Custom email prompt for Orlando package.",
          negative_prompt: "no generic conference room",
          image_urls: ["https://fal.media/files/email-reference.png"]
        })
      })
    );
  });

  it("treats runs without an explicit Dry Run flag as live generation", async () => {
    const { dryRun: _dryRun, ...run } = readyRunState();
    const postProcessAsset = vi.fn(async ({ rawPath }: { rawPath: string }) => ({
      finalPath: rawPath,
      draftPath: rawPath,
      thumbnailUrl: `/thumbs/${path.basename(rawPath)}`
    }));
    const generateFalAsset = vi.fn(async ({ assetId }: { assetId: string }) => {
      return {
        runId: run.runId,
        assetId,
        modelId: imageModel.id,
        seed: 123,
        status: "completed",
        outputPath: `/raw/${assetId}.png`,
        costUsd: 0
      } satisfies FalAssetResult;
    });

    await startGenerationRun(run.runId, {
      readRun: async () => run,
      buildPrompt: async () => builtPrompt(),
      generateFalAsset,
      postProcessAsset
    });

    await waitForGenerationRun(run.runId);

    expect(generateFalAsset).toHaveBeenCalledWith(
      expect.objectContaining({
        dryRun: false
      })
    );
  });

  it("passes GPT Image 2 quality into fal generation params", async () => {
    const gptImage2Model: ModelInfo = {
      id: "openai/gpt-image-2",
      name: "GPT Image 2",
      kind: "image",
      capabilities: {
        supportsOnImageText: true
      }
    };
    const run = {
      ...readyRunState(),
      selectedChannels: ["meta" as const],
      selectedChannelSizes: {
        meta: ["Feed square"]
      },
      modelSelections: {
        meta: {
          imageModelId: gptImage2Model.id,
          imageModel: gptImage2Model,
          imageOptions: {
            quality: "medium" as const
          }
        }
      }
    };
    const postProcessAsset = vi.fn(async ({ rawPath }: { rawPath: string }) => ({
      finalPath: rawPath,
      draftPath: rawPath,
      thumbnailUrl: `/thumbs/${path.basename(rawPath)}`
    }));
    const generateFalAsset = vi.fn(async ({ assetId }: { assetId: string }) => {
      return {
        runId: run.runId,
        assetId,
        modelId: gptImage2Model.id,
        seed: 123,
        status: "dry_run",
        outputPath: `/raw/${assetId}.png`,
        costUsd: 0
      } satisfies FalAssetResult;
    });

    await startGenerationRun(run.runId, {
      readRun: async () => run,
      buildPrompt: async () => builtPrompt(),
      generateFalAsset,
      postProcessAsset
    });

    await waitForGenerationRun(run.runId);

    expect(generateFalAsset).toHaveBeenCalledWith(
      expect.objectContaining({
        modelId: "openai/gpt-image-2",
        params: expect.objectContaining({
          image_size: {
            width: 1200,
            height: 1200
          },
          quality: "medium"
        })
      })
    );
  });
});

async function createReadyRun() {
  const run = await createRun({
    resortName: brief.resortName,
    headline: brief.headline,
    subheadline: brief.subheadline ?? null,
    offer: brief.offer,
    validDates: brief.validDates ?? null,
    ctaText: brief.ctaText ?? null,
    heroImageUrl: brief.heroImageUrl ?? null,
    brandColors: brief.brandColors,
    location: brief.location ?? null
  });
  await updateRunBrief(run.runId, brief);
  await updateRunChannels(run.runId, ["email_internal"]);
  await updateRunModelSelections(run.runId, {
    dryRun: true,
    selections: {
      email_internal: {
        imageModelId: imageModel.id,
        imageModel
      }
    }
  });

  return run;
}

function readyRunState(): RunState {
  return {
    runId: "01HX0000000000000000000000",
    createdAt: "2026-05-21T12:00:00.000Z",
    updatedAt: "2026-05-21T12:00:00.000Z",
    scrapedBrief: {
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
    brief,
    selectedChannels: ["email_internal"],
    dryRun: true,
    modelSelections: {
      email_internal: {
        imageModelId: imageModel.id,
        imageModel
      }
    }
  };
}

function builtPrompt(): BuiltPrompt {
  return {
    prompt: "Clean resort concept",
    negativePrompt: "no text",
    seed: 123,
    aspectRatio: "1:1"
  };
}

async function readStream(body: ReadableStream<Uint8Array> | null) {
  if (!body) {
    return "";
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let output = "";

  for (;;) {
    const next = await reader.read();

    if (next.done) {
      break;
    }

    output += decoder.decode(next.value, { stream: true });
  }

  output += decoder.decode();

  return output;
}

function parseSseEvents(sse: string) {
  return sse
    .split("\n\n")
    .map((event) => event.trim())
    .filter(Boolean)
    .map((event) => event.replace(/^data: /, ""))
    .map(
      (event) =>
        JSON.parse(event) as {
          assetId: string;
          status: "queued" | "running" | "done" | "failed";
          progress: number;
          thumbnailUrl?: string;
          error?: string;
        }
    );
}
