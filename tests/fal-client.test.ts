import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";

import sharp from "sharp";
import { vi } from "vitest";

import { generateFalAsset, type FalClientLike } from "../src/generators/fal-client";

describe("generateFalAsset", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "fal-client-"));
  });

  afterEach(async () => {
    await rm(tempDir, { force: true, recursive: true });
  });

  it("creates deterministic sharp placeholder images and cost logs during Dry Run", async () => {
    const fakeFal = fakeFalClient();
    const request = {
      runId: "01HX0000000000000000000000",
      campaignSlug: "spring-villas",
      assetId: "meta-feed",
      channel: "meta" as const,
      modelId: "fal-ai/flux-pro/v1.1-ultra",
      params: { prompt: "Poolside villas" },
      seed: 12345,
      size: { w: 320, h: 180 },
      dryRun: true,
      outputRoot: tempDir
    };

    const first = await generateFalAsset(request, { fal: fakeFal, now: fixedNow });
    const firstBytes = await readFile(first.outputPath);
    await rm(first.outputPath);
    const second = await generateFalAsset(request, { fal: fakeFal, now: fixedNow });
    const secondBytes = await readFile(second.outputPath);
    const metadata = await sharp(second.outputPath).metadata();
    const logLines = await readCostLog(tempDir, "spring-villas", request.runId);

    expect(fakeFal.subscribe).not.toHaveBeenCalled();
    expect(fakeFal.queue.submit).not.toHaveBeenCalled();
    expect(first.status).toBe("dry_run");
    expect(first.costUsd).toBe(0);
    expect(metadata.width).toBe(320);
    expect(metadata.height).toBe(180);
    expect(hash(firstBytes)).toBe(hash(secondBytes));
    expect(logLines).toHaveLength(2);
    expect(logLines[0]).toMatchObject({
      timestamp: fixedNow().toISOString(),
      runId: request.runId,
      assetId: "meta-feed",
      channel: "meta",
      modelId: request.modelId,
      seed: 12345,
      reportedCostUsd: 0,
      dryRun: true
    });
    expect(logLines[0].params).toMatchObject({
      prompt: "Poolside villas",
      seed: 12345
    });
  });

  it("retries fal.subscribe on 429 and logs the reported cost", async () => {
    const subscribe = vi
      .fn()
      .mockRejectedValueOnce(statusError(429))
      .mockRejectedValueOnce(statusError(500))
      .mockResolvedValueOnce({
        requestId: "req_123",
        data: {
          images: [{ url: "https://example.com/out.jpg" }],
          costUsd: 0.42
        }
      });
    const fakeFal = fakeFalClient({ subscribe });

    const result = await generateFalAsset(
      {
        runId: "01HX0000000000000000000000",
        campaignSlug: "spring-villas",
        assetId: "meta-feed",
        channel: "meta",
        modelId: "fal-ai/flux-pro/v1.1-ultra",
        params: { prompt: "Poolside villas" },
        seed: 67890,
        dryRun: false,
        mode: "subscribe",
        outputRoot: tempDir
      },
      {
        fal: fakeFal,
        now: fixedNow,
        retryBaseDelayMs: 0
      }
    );
    const [logEntry] = await readCostLog(tempDir, "spring-villas", result.runId);

    expect(subscribe).toHaveBeenCalledTimes(3);
    expect(subscribe).toHaveBeenCalledWith("fal-ai/flux-pro/v1.1-ultra", {
      input: { prompt: "Poolside villas", seed: 67890 }
    });
    expect(result.status).toBe("completed");
    expect(result.requestId).toBe("req_123");
    expect(result.costUsd).toBe(0.42);
    expect(logEntry).toMatchObject({
      modelId: "fal-ai/flux-pro/v1.1-ultra",
      seed: 67890,
      reportedCostUsd: 0.42,
      dryRun: false,
      requestId: "req_123"
    });
  });

  it("downloads live fal image output and overwrites stale raw placeholders", async () => {
    const runId = "01HX0000000000000000000000";
    const outputPath = path.join(tempDir, "spring-villas", runId, "raw", "meta-feed.png");
    const staleBytes = await sharp({
      create: {
        width: 24,
        height: 24,
        channels: 3,
        background: "#cc0000"
      }
    })
      .png()
      .toBuffer();
    const liveBytes = await sharp({
      create: {
        width: 24,
        height: 24,
        channels: 3,
        background: "#0044cc"
      }
    })
      .png()
      .toBuffer();
    const server = createServer((_, response) => {
      response.writeHead(200, { "content-type": "image/png" });
      response.end(liveBytes);
    });

    try {
      await mkdir(path.dirname(outputPath), { recursive: true });
      await writeFile(outputPath, staleBytes);
      await new Promise<void>((resolve) => {
        server.listen(0, "127.0.0.1", resolve);
      });

      const address = server.address();

      if (!address || typeof address === "string") {
        throw new Error("Expected local image server to bind to a TCP port");
      }

      const subscribe = vi.fn().mockResolvedValue({
        requestId: "req_live_image",
        data: {
          images: [{ url: `http://127.0.0.1:${address.port}/live.png` }],
          costUsd: 0.21
        }
      });
      const result = await generateFalAsset(
        {
          runId,
          campaignSlug: "spring-villas",
          assetId: "meta-feed",
          channel: "meta",
          modelId: "fal-ai/flux-pro/v1.1-ultra",
          params: { prompt: "Poolside villas" },
          seed: 24680,
          size: { w: 24, h: 24 },
          dryRun: false,
          mode: "subscribe",
          outputRoot: tempDir
        },
        {
          fal: fakeFalClient({ subscribe }),
          now: fixedNow
        }
      );

      expect(result.status).toBe("completed");
      expect(hash(await readFile(result.outputPath))).toBe(hash(liveBytes));
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("folds negative prompts into the positive prompt for models without negative prompt support", async () => {
    const subscribe = vi.fn().mockResolvedValue({
      requestId: "req_no_negative",
      data: { costUsd: 0.15 }
    });
    const fakeFal = fakeFalClient({ subscribe });

    await generateFalAsset(
      {
        runId: "01HX0000000000000000000000",
        campaignSlug: "spring-villas",
        assetId: "meta-feed",
        channel: "meta",
        modelId: "openai/gpt-image-2",
        params: {
          prompt: "Bright Orlando resort ad.",
          negative_prompt: "no readable fine print",
          width: 1080,
          height: 1080
        },
        seed: 333,
        dryRun: false,
        supportsNegativePrompt: false,
        outputRoot: tempDir
      },
      { fal: fakeFal, now: fixedNow }
    );

    expect(subscribe).toHaveBeenCalledWith("openai/gpt-image-2", {
      input: {
        prompt:
          "Bright Orlando resort ad.\n\nAvoid generating: no readable fine print",
        width: 1080,
        height: 1080,
        seed: 333
      }
    });

    const [logEntry] = await readCostLog(
      tempDir,
      "spring-villas",
      "01HX0000000000000000000000"
    );
    const loggedParams = logEntry.params as Record<string, unknown>;
    expect(loggedParams).not.toHaveProperty("negative_prompt");
    expect(loggedParams.prompt).toContain("Avoid generating: no readable fine print");
  });

  it("uses fal.queue.submit when queue mode is requested", async () => {
    const submit = vi.fn().mockResolvedValue({
      status: "IN_QUEUE",
      request_id: "queue_123",
      queue_position: 1,
      response_url: "https://queue.example/result",
      status_url: "https://queue.example/status",
      cancel_url: "https://queue.example/cancel"
    });
    const fakeFal = fakeFalClient({ submit });

    const result = await generateFalAsset(
      {
        runId: "01HX0000000000000000000000",
        campaignSlug: "spring-villas",
        assetId: "meta-feed",
        modelId: "fal-ai/queue-model",
        params: { prompt: "Queue this" },
        seed: 111,
        dryRun: false,
        mode: "queue",
        outputRoot: tempDir
      },
      { fal: fakeFal, now: fixedNow }
    );

    expect(submit).toHaveBeenCalledWith("fal-ai/queue-model", {
      input: { prompt: "Queue this", seed: 111 }
    });
    expect(result.status).toBe("submitted");
    expect(result.requestId).toBe("queue_123");
  });

  it("does not retry non-retryable fal errors", async () => {
    const subscribe = vi.fn().mockRejectedValue(statusError(400));

    await expect(
      generateFalAsset(
        {
          runId: "01HX0000000000000000000000",
          campaignSlug: "spring-villas",
          assetId: "meta-feed",
          modelId: "fal-ai/bad-request",
          params: { prompt: "Bad request" },
          seed: 222,
          dryRun: false,
          outputRoot: tempDir
        },
        { fal: fakeFalClient({ subscribe }), retryBaseDelayMs: 0 }
      )
    ).rejects.toMatchObject({ status: 400 });

    expect(subscribe).toHaveBeenCalledTimes(1);
  });

  it("turns fal authentication failures into actionable FAL_KEY guidance", async () => {
    const subscribe = vi.fn().mockRejectedValue(Object.assign(new Error("Unauthorized"), { status: 401 }));

    await expect(
      generateFalAsset(
        {
          runId: "01HX0000000000000000000000",
          campaignSlug: "spring-villas",
          assetId: "meta-feed",
          modelId: "openai/gpt-image-2",
          params: { prompt: "Live image request" },
          seed: 444,
          dryRun: false,
          outputRoot: tempDir
        },
        { fal: fakeFalClient({ subscribe }), retryBaseDelayMs: 0 }
      )
    ).rejects.toThrow("fal.ai authentication failed. Check FAL_KEY");

    expect(subscribe).toHaveBeenCalledTimes(1);
  });

  it("logs and explains fal validation failures with the rejected request params", async () => {
    const validationError = Object.assign(new Error("Unprocessable Entity"), {
      status: 422,
      body: {
        detail: [
          {
            loc: ["body", "image_size", "height"],
            msg: "Input should be a multiple of 16"
          }
        ]
      }
    });
    const subscribe = vi.fn().mockRejectedValue(validationError);

    await expect(
      generateFalAsset(
        {
          runId: "01HX0000000000000000000000",
          campaignSlug: "spring-villas",
          assetId: "website-hero",
          channel: "website",
          modelId: "openai/gpt-image-2",
          params: {
            prompt: "Live image request",
            image_size: {
              width: 1392,
              height: 593
            }
          },
          seed: 555,
          dryRun: false,
          outputRoot: tempDir
        },
        { fal: fakeFalClient({ subscribe }), retryBaseDelayMs: 0, now: fixedNow }
      )
    ).rejects.toThrow(
      "fal.ai rejected openai/gpt-image-2 request: body.image_size.height: Input should be a multiple of 16"
    );

    const [logEntry] = await readCostLog(
      tempDir,
      "spring-villas",
      "01HX0000000000000000000000"
    );

    expect(logEntry).toMatchObject({
      timestamp: fixedNow().toISOString(),
      runId: "01HX0000000000000000000000",
      assetId: "website-hero",
      channel: "website",
      modelId: "openai/gpt-image-2",
      seed: 555,
      reportedCostUsd: 0,
      dryRun: false,
      error:
        "fal.ai rejected openai/gpt-image-2 request: body.image_size.height: Input should be a multiple of 16"
    });
    expect(logEntry.params).toMatchObject({
      image_size: {
        width: 1392,
        height: 593
      },
      seed: 555
    });
  });
});

describe("server-only import check", () => {
  it("fails when a client component imports fal-client", async () => {
    const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "fal-client-import-check-"));

    try {
      await mkdir(path.join(fixtureRoot, "components"), { recursive: true });
      await mkdir(path.join(fixtureRoot, "src", "generators"), { recursive: true });
      await writeFile(
        path.join(fixtureRoot, "components", "BadClient.tsx"),
        ['"use client";', 'import "../src/generators/fal-client";'].join("\n"),
        "utf8"
      );
      await writeFile(
        path.join(fixtureRoot, "src", "generators", "fal-client.ts"),
        "export {};",
        "utf8"
      );

      const result = runServerOnlyCheck(fixtureRoot);

      expect(result.status).toBe(1);
      expect(`${result.stdout}${result.stderr}`).toContain("fal-client");
    } finally {
      await rm(fixtureRoot, { force: true, recursive: true });
    }
  });

  it("fails when a client component imports fal-client through the app alias", async () => {
    const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "fal-client-alias-check-"));

    try {
      await mkdir(path.join(fixtureRoot, "components"), { recursive: true });
      await mkdir(path.join(fixtureRoot, "src", "generators"), { recursive: true });
      await writeFile(
        path.join(fixtureRoot, "components", "BadClient.tsx"),
        ['"use client";', 'import "@/src/generators/fal-client";'].join("\n"),
        "utf8"
      );
      await writeFile(
        path.join(fixtureRoot, "src", "generators", "fal-client.ts"),
        "export {};",
        "utf8"
      );

      const result = runServerOnlyCheck(fixtureRoot);

      expect(result.status).toBe(1);
      expect(`${result.stdout}${result.stderr}`).toContain("fal-client");
    } finally {
      await rm(fixtureRoot, { force: true, recursive: true });
    }
  });

  it("passes for the current client import graph", () => {
    const result = runServerOnlyCheck(process.cwd());

    expect(result.status).toBe(0);
  });
});

function fakeFalClient(overrides: Partial<FalClientLike> & { submit?: FalClientLike["queue"]["submit"] } = {}) {
  const queue = {
    submit: overrides.submit ?? vi.fn()
  };

  return {
    subscribe: overrides.subscribe ?? vi.fn(),
    queue
  } satisfies FalClientLike;
}

function fixedNow() {
  return new Date("2026-05-21T12:00:00.000Z");
}

function statusError(status: number) {
  return Object.assign(new Error(`HTTP ${status}`), { status });
}

async function readCostLog(outputRoot: string, campaignSlug: string, runId: string) {
  const costLogPath = path.join(outputRoot, campaignSlug, runId, "cost-log.jsonl");
  const lines = (await readFile(costLogPath, "utf8")).trim().split("\n");

  return lines.map((line) => JSON.parse(line) as Record<string, unknown>);
}

function hash(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

function runServerOnlyCheck(root: string) {
  return spawnSync(process.execPath, ["scripts/check-server-only-imports.mjs", root], {
    cwd: process.cwd(),
    encoding: "utf8"
  });
}
