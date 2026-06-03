import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { render, screen, within } from "@testing-library/react";
import sharp from "sharp";

import { POST as createProjectPost } from "../app/api/projects/route";
import { POST as createRunPost } from "../app/api/runs/route";
import { PUT as updateBriefPut } from "../app/api/runs/[runId]/brief/route";
import { PUT as updateChannelsPut } from "../app/api/runs/[runId]/channels/route";
import { PUT as updateModelsPut } from "../app/api/runs/[runId]/models/route";
import { POST as estimatePost } from "../app/api/estimate/route";
import { POST as generatePost } from "../app/api/generate/route";
import ReviewPage from "../app/review/page";
import { channels, type ChannelKey } from "../src/config/channels";
import { getRunPath } from "../src/lib/runs";
import { getProjectPath } from "../src/lib/projects";
import { loadRunResults } from "../src/lib/results";
import {
  resetGenerationState,
  waitForGenerationRun
} from "../src/lib/generation";
import { scrapeLandingPage } from "../src/scraper/landing-page";
import { suggestDefaultModel } from "../src/models/router";
import type { CreativeBrief, ModelInfo } from "../src/schemas";

const allChannels = Object.keys(channels) as ChannelKey[];
const expectedAssetCount = allChannels.reduce(
  (count, channel) => count + channels[channel].sizes.length,
  0
);
const noTextAssetCount = allChannels
  .filter((channel) => channels[channel].allowOnImageText === false)
  .reduce((count, channel) => count + channels[channel].sizes.length, 0);

const catalog: ModelInfo[] = [
  {
    id: "fal-ai/ideogram/v3",
    name: "Ideogram v3",
    kind: "image",
    tags: ["text-to-image", "supports-on-image-text", "premium"],
    pricing: { unit: "image", amountUsd: 0.05 },
    capabilities: {
      textToImage: true,
      supportsOnImageText: true,
      supportedAspects: ["1:1", "4:5", "16:9", "9:16", "21:9"]
    }
  },
  {
    id: "fal-ai/flux-pro/v1.1-ultra",
    name: "Flux Pro Ultra",
    kind: "image",
    tags: ["text-to-image", "photorealistic", "premium"],
    pricing: { unit: "image", amountUsd: 0.04 },
    capabilities: {
      textToImage: true,
      supportsOnImageText: false,
      supportedAspects: ["1:1", "4:5", "16:9", "9:16", "21:9"]
    }
  }
];

describe("end-to-end Dry Run flow", () => {
  let outputRoot: string | null;
  let runId: string | null;
  let projectId: string | null;

  beforeEach(async () => {
    resetGenerationState();
    runId = null;
    projectId = null;
    outputRoot = await mkdtemp(path.join(os.tmpdir(), "dry-run-e2e-"));
  });

  afterEach(async () => {
    resetGenerationState();
    if (runId) {
      await rm(getRunPath(runId), { force: true });
    }
    if (projectId) {
      await rm(getProjectPath(projectId), { force: true });
    }
    if (outputRoot) {
      await rm(outputRoot, { force: true, recursive: true });
    }
  });

  it("drives scrape, brief, all channels, suggested models, review, generate, and results without fal.ai spend", async () => {
    const testOutputRoot = expectOutputRoot(outputRoot);
    const scrapedBrief = await scrapeLandingPage("https://example.com/e2e-westgate", {
      cacheDir: path.join(testOutputRoot, "cache", "scrape"),
      fetchHtml: () =>
        readFile(path.join(process.cwd(), "tests", "fixtures", "scraper", "full-resort.html"), "utf8"),
      now: () => new Date("2026-05-21T12:00:00.000Z")
    });
    const projectResponse = await createProjectPost(
      jsonRequest("http://localhost:3000/api/projects", { name: "E2E Project" })
    );
    const projectPayload = (await projectResponse.json()) as {
      project: { projectId: string };
    };
    projectId = projectPayload.project.projectId;
    const createResponse = await createRunPost(
      jsonRequest("http://localhost:3000/api/runs", {
        projectId,
        sourceUrl: "https://example.com/e2e-westgate",
        scrapedBrief
      })
    );
    const createPayload = (await createResponse.json()) as { runId: string };
    runId = createPayload.runId;
    const brief = resolvedBrief(scrapedBrief);
    const selections = Object.fromEntries(
      allChannels.map((channel) => {
        const model = suggestDefaultModel(channel, "image", catalog, {
          includesOnImageText: true
        });

        if (!model) {
          throw new Error(`No suggested model for ${channel}`);
        }

        return [
          channel,
          {
            imageModelId: model.id,
            imageModel: model,
            forceNoTextMode: channels[channel].allowOnImageText === false ? false : undefined
          }
        ];
      })
    );
    const estimateResponse = await estimatePost(
      jsonRequest("http://localhost:3000/api/estimate", {
        brief,
        channels: allChannels,
        models: selections
      })
    );
    const estimate = (await estimateResponse.json()) as {
      totalUsd: number;
      requiresCostConfirm: boolean;
    };

    expect(projectResponse.status).toBe(201);
    expect(createResponse.status).toBe(200);
    expect(estimate.totalUsd).toBeGreaterThan(0);

    await expectOk(
      updateBriefPut(
        jsonRequest(`http://localhost:3000/api/runs/${runId}/brief`, { brief }, "PUT"),
        { params: { runId } }
      )
    );
    await expectOk(
      updateChannelsPut(
        jsonRequest(
          `http://localhost:3000/api/runs/${runId}/channels`,
          { selectedChannels: allChannels },
          "PUT"
        ),
        { params: { runId } }
      )
    );
    await expectOk(
      updateModelsPut(
        jsonRequest(
          `http://localhost:3000/api/runs/${runId}/models`,
          {
            dryRun: true,
            selections,
            estimatedCostUsd: estimate.totalUsd,
            requiresCostConfirm: estimate.requiresCostConfirm
          },
          "PUT"
        ),
        { params: { runId } }
      )
    );

    render(await ReviewPage({ searchParams: { runId } }));

    expect(screen.getByRole("heading", { name: "Review" })).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Meta" })).getByText("4 resolved prompts"))
      .toBeInTheDocument();

    const generateResponse = await generatePost(
      jsonRequest("http://localhost:3000/api/generate", { runId, outputRoot: testOutputRoot })
    );
    const generatePayload = (await generateResponse.json()) as {
      runId: string;
      assetCount: number;
    };

    expect(generateResponse.status).toBe(202);
    expect(generatePayload).toEqual({ runId, assetCount: expectedAssetCount });

    await waitForGenerationRun(runId);

    const runDir = path.join(testOutputRoot, "e2e-project", "orlando", "spring-villas-e2e", runId);
    const results = await loadRunResults(runId, { outputRoot: testOutputRoot });

    expect(results.groups).toHaveLength(5);
    expect(results.groups.flatMap((group) => group.assets)).toHaveLength(expectedAssetCount);
    await expectFile(path.join(runDir, "contact-sheet.html"));

    const expectedAssets = allChannels.flatMap((channel) =>
      channels[channel].sizes.map((size) => ({
        channel,
        assetId: assetIdFor(channel, size.name, size.w, size.h)
      }))
    );

    for (const { assetId, channel } of expectedAssets) {
      await expectFile(path.join(runDir, "raw", `${assetId}.png`));
      await expectFile(path.join(runDir, "final", channel, `${assetId}.png`));
      await expectFile(path.join(runDir, "drafts", channel, `${assetId}.png`));
    }

    const metaLandscape = path.join(
      runDir,
      "final",
      "meta",
      "meta_feed-landscape_1920x1080.png"
    );
    const metaLandscapeMetadata = await sharp(metaLandscape).metadata();

    expect(channels.meta.sizes).toHaveLength(4);
    expect(metaLandscapeMetadata).toMatchObject({ width: 1920, height: 1080 });

    const costLog = await readJsonl(path.join(runDir, "cost-log.jsonl"));
    const ocrLog = await readJsonl(path.join(runDir, "ocr-log.jsonl"));

    expect(costLog).toHaveLength(expectedAssetCount);
    expect(costLog.every((entry) => typeof entry.modelId === "string" && entry.dryRun === true))
      .toBe(true);
    expect(ocrLog).toHaveLength(noTextAssetCount);
    expect(new Set(ocrLog.map((entry) => entry.channel))).toEqual(
      new Set(["website", "email_internal", "seo"])
    );
    expect(ocrLog.every((entry) => entry.ocrChecked === true)).toBe(true);
  });
});

function resolvedBrief(scraped: Awaited<ReturnType<typeof scrapeLandingPage>>): CreativeBrief {
  return {
    resortName: scraped.resortName ?? "Westgate Lakes Resort & Spa",
    headline: scraped.headline ?? "Spring Villa Escape",
    offer: scraped.offer ?? "Save 30%",
    subheadline: scraped.subheadline ?? undefined,
    validDates: scraped.validDates ?? undefined,
    ctaText: scraped.ctaText ?? undefined,
    heroImageUrl: scraped.heroImageUrl ?? undefined,
    brandColors: scraped.brandColors,
    location: scraped.location ?? undefined,
    campaignName: "Spring Villas E2E",
    promotionSummary: "Dry-run campaign for all channel outputs.",
    targetAudience: "families and couples",
    tone: "relaxed premium",
    mustIncludeVisualElements: ["poolside villas", "sunlit resort grounds"],
    mustAvoidElements: ["competitor logos"]
  };
}

function assetIdFor(channel: ChannelKey, name: string, w: number, h: number) {
  return `${channel}_${safeSegment(name)}_${w}x${h}`;
}

function safeSegment(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function jsonRequest(url: string, payload: unknown, method = "POST") {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
}

async function expectOk(responsePromise: Promise<Response>) {
  const response = await responsePromise;
  const body = response.clone();

  expect(response.status, await body.text()).toBe(200);
}

async function expectFile(filePath: string) {
  await expect(stat(filePath)).resolves.toBeTruthy();
}

async function readJsonl(filePath: string) {
  const content = await readFile(filePath, "utf8");

  return content
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function expectOutputRoot(value: string | null): string {
  if (!value) {
    throw new Error("Test output root was not initialized.");
  }

  return value;
}
