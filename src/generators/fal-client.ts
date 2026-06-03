import { createHash } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

import { fal as defaultFal } from "@fal-ai/client";
import sharp from "sharp";
import { request as undiciRequest } from "undici";

import type { ChannelKey } from "../config/channels";

export const FAL_CLIENT_BOUNDARY = "server-side-only";

export type FalMode = "subscribe" | "queue";

export type FalClientLike = {
  subscribe: (
    modelId: string,
    options: { input: Record<string, unknown> }
  ) => Promise<FalSubscribeResponse>;
  queue: {
    submit: (
      modelId: string,
      options: { input: Record<string, unknown> }
    ) => Promise<FalQueueSubmitResponse>;
  };
};

export type FalAssetRequest = {
  runId: string;
  projectSlug?: string;
  destinationSlug?: string;
  campaignSlug: string;
  assetId: string;
  channel?: ChannelKey;
  modelId: string;
  params: Record<string, unknown>;
  seed: number;
  size?: {
    w: number;
    h: number;
  };
  dryRun: boolean;
  supportsNegativePrompt?: boolean;
  mode?: FalMode;
  outputRoot?: string;
  outputPath?: string;
};

export type FalAssetResult = {
  runId: string;
  assetId: string;
  modelId: string;
  seed: number;
  status: "dry_run" | "completed" | "submitted";
  requestId?: string;
  data?: unknown;
  outputPath: string;
  costUsd: number;
};

export type FalClientOptions = {
  fal?: FalClientLike;
  now?: () => Date;
  retryBaseDelayMs?: number;
  maxRetries?: number;
};

type FalSubscribeResponse = {
  data?: unknown;
  requestId?: string;
  request_id?: string;
};

type FalQueueSubmitResponse = {
  request_id?: string;
  requestId?: string;
  status?: string;
};

type CostLogEntry = {
  timestamp: string;
  runId: string;
  assetId: string;
  channel?: ChannelKey;
  modelId: string;
  seed: number;
  params: Record<string, unknown>;
  reportedCostUsd: number;
  dryRun: boolean;
  requestId?: string;
  error?: string;
};

const DEFAULT_OUTPUT_ROOT = path.join(process.cwd(), "outputs");
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_BASE_DELAY_MS = 250;

defaultFal.config({ credentials: () => process.env.FAL_KEY });

export async function generateFalAsset(
  request: FalAssetRequest,
  options: FalClientOptions = {}
): Promise<FalAssetResult> {
  assertServerRuntime();

  const now = options.now ?? (() => new Date());
  const outputPath = resolveOutputPath(request);
  const paramsWithSeed = {
    ...paramsForModel(request.params, request.supportsNegativePrompt),
    seed: request.seed
  };

  if (request.dryRun) {
    await writeDryRunPlaceholder({
      outputPath,
      assetId: request.assetId,
      modelId: request.modelId,
      seed: request.seed,
      size: request.size ?? { w: 1200, h: 628 }
    });
    await appendCostLog(request, {
      timestamp: now().toISOString(),
      params: paramsWithSeed,
      reportedCostUsd: 0,
      dryRun: true
    });

    return {
      runId: request.runId,
      assetId: request.assetId,
      modelId: request.modelId,
      seed: request.seed,
      status: "dry_run",
      outputPath,
      costUsd: 0
    };
  }

  const fal = options.fal ?? defaultFal;
  const mode = request.mode ?? "subscribe";
  let response: FalQueueSubmitResponse | FalSubscribeResponse;

  try {
    response =
      mode === "queue"
        ? await runFalOperation(
            () => fal.queue.submit(request.modelId, { input: paramsWithSeed }),
            request.modelId,
            retryOptions(options)
          )
        : await runFalOperation(
            () => fal.subscribe(request.modelId, { input: paramsWithSeed }),
            request.modelId,
            retryOptions(options)
          );
  } catch (error) {
    await appendCostLog(request, {
      timestamp: now().toISOString(),
      params: paramsWithSeed,
      reportedCostUsd: 0,
      dryRun: false,
      error: messageFromError(error)
    });
    throw error;
  }

  const costUsd = mode === "queue" ? 0 : extractReportedCost(response);
  const requestId = requestIdFrom(response);

  if (mode === "subscribe" && request.size) {
    const outputUrl = extractImageUrl(response);

    if (!outputUrl) {
      throw new Error("fal.ai response did not include a downloadable image URL.");
    }

    await downloadImageToFile(outputUrl, outputPath);
  }

  await appendCostLog(request, {
    timestamp: now().toISOString(),
    params: paramsWithSeed,
    reportedCostUsd: costUsd,
    dryRun: false,
    requestId
  });

  return {
    runId: request.runId,
    assetId: request.assetId,
    modelId: request.modelId,
    seed: request.seed,
    status: mode === "queue" ? "submitted" : "completed",
    requestId,
    data: response,
    outputPath,
    costUsd
  };
}

async function writeDryRunPlaceholder({
  outputPath,
  assetId,
  modelId,
  seed,
  size
}: {
  outputPath: string;
  assetId: string;
  modelId: string;
  seed: number;
  size: { w: number; h: number };
}) {
  await mkdir(path.dirname(outputPath), { recursive: true });

  const background = colorFor(`${modelId}:${assetId}:${seed}:${size.w}x${size.h}`);
  const textColor = contrastColor(background);
  const svg = placeholderSvg({
    width: size.w,
    height: size.h,
    textColor,
    lines: ["DRY RUN", `${size.w}x${size.h}`, modelId, `seed ${seed}`]
  });

  await sharp({
    create: {
      width: size.w,
      height: size.h,
      channels: 3,
      background
    }
  })
    .composite([{ input: Buffer.from(svg) }])
    .png()
    .toFile(outputPath);
}

function placeholderSvg({
  width,
  height,
  textColor,
  lines
}: {
  width: number;
  height: number;
  textColor: string;
  lines: string[];
}) {
  const fontSize = Math.max(14, Math.min(width / 12, height / 6));
  const lineHeight = fontSize * 1.25;
  const startY = height / 2 - ((lines.length - 1) * lineHeight) / 2;

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`,
    `<rect width="100%" height="100%" fill="transparent"/>`,
    ...lines.map(
      (line, index) =>
        `<text x="50%" y="${startY + index * lineHeight}" text-anchor="middle" dominant-baseline="middle" font-family="Arial, sans-serif" font-size="${fontSize}" font-weight="${index === 0 ? 700 : 500}" fill="${textColor}">${escapeXml(line)}</text>`
    ),
    "</svg>"
  ].join("");
}

async function appendCostLog(
  request: FalAssetRequest,
  entry: Pick<
    CostLogEntry,
    "timestamp" | "params" | "reportedCostUsd" | "dryRun" | "requestId" | "error"
  >
) {
  const runDir = runOutputDir(request);
  await mkdir(runDir, { recursive: true });

  const line: CostLogEntry = {
    timestamp: entry.timestamp,
    runId: request.runId,
    assetId: request.assetId,
    channel: request.channel,
    modelId: request.modelId,
    seed: request.seed,
    params: entry.params,
    reportedCostUsd: entry.reportedCostUsd,
    dryRun: entry.dryRun,
    requestId: entry.requestId,
    error: entry.error
  };

  await appendFile(path.join(runDir, "cost-log.jsonl"), `${JSON.stringify(line)}\n`, "utf8");
}

async function withRetry<T>(
  operation: () => Promise<T>,
  { maxRetries, retryBaseDelayMs }: { maxRetries: number; retryBaseDelayMs: number }
) {
  let attempt = 0;

  for (;;) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= maxRetries || !isRetryableFalError(error)) {
        throw error;
      }

      await sleep(retryBaseDelayMs * 2 ** attempt);
      attempt += 1;
    }
  }
}

async function runFalOperation<T>(
  operation: () => Promise<T>,
  modelId: string,
  options: { maxRetries: number; retryBaseDelayMs: number }
) {
  try {
    return await withRetry(operation, options);
  } catch (error) {
    throw normalizeFalError(error, modelId);
  }
}

function retryOptions(options: FalClientOptions) {
  return {
    maxRetries: options.maxRetries ?? DEFAULT_MAX_RETRIES,
    retryBaseDelayMs: options.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS
  };
}

function isRetryableFalError(error: unknown) {
  const status = statusFromError(error);

  return status === 429 || (status !== null && status >= 500 && status <= 599);
}

function normalizeFalError(error: unknown, modelId: string) {
  if (isFalAuthError(error)) {
    return new Error(
      `fal.ai authentication failed. Check FAL_KEY in .env.local, restart npm run dev, and confirm the key can access ${modelId}.`
    );
  }

  if (isFalValidationError(error)) {
    return new Error(`fal.ai rejected ${modelId} request: ${extractFalErrorDetails(error)}`);
  }

  return error;
}

function isFalAuthError(error: unknown) {
  const status = statusFromError(error);

  if (status === 401 || status === 403) {
    return true;
  }

  const message = messageFromError(error);

  return /\b(unauthorized|forbidden|authentication|invalid api key)\b/i.test(message);
}

function isFalValidationError(error: unknown) {
  const status = statusFromError(error);

  if (status === 422) {
    return true;
  }

  return /\bunprocessable entity\b/i.test(messageFromError(error));
}

function statusFromError(error: unknown) {
  if (!isRecord(error)) {
    return null;
  }

  const candidates = [
    error.status,
    error.statusCode,
    isRecord(error.response) ? error.response.status : undefined
  ];
  const status = candidates.find((candidate) => typeof candidate === "number");

  return typeof status === "number" ? status : null;
}

function extractFalErrorDetails(error: unknown) {
  const detail = firstPresent([
    nestedValue(error, ["body", "detail"]),
    nestedValue(error, ["data", "detail"]),
    nestedValue(error, ["detail"]),
    nestedValue(error, ["details"]),
    nestedValue(error, ["response", "data", "detail"]),
    nestedValue(error, ["response", "body", "detail"]),
    nestedValue(error, ["response", "_data", "detail"]),
    nestedValue(error, ["response", "data"]),
    nestedValue(error, ["response", "body"]),
    nestedValue(error, ["body"]),
    nestedValue(error, ["data"])
  ]);
  const formatted = formatFalDetail(detail);

  return formatted || messageFromError(error);
}

function firstPresent(values: unknown[]) {
  return values.find((value) => value !== undefined && value !== null);
}

function nestedValue(value: unknown, pathSegments: string[]) {
  let current: unknown = value;

  for (const segment of pathSegments) {
    if (!isRecord(current)) {
      return undefined;
    }

    current = current[segment];
  }

  return current;
}

function formatFalDetail(detail: unknown): string {
  if (Array.isArray(detail)) {
    return detail.map(formatFalDetail).filter(Boolean).join("; ");
  }

  if (isRecord(detail)) {
    const location = Array.isArray(detail.loc)
      ? detail.loc
          .filter((part): part is string | number => typeof part === "string" || typeof part === "number")
          .join(".")
      : undefined;
    const message = typeof detail.msg === "string" ? detail.msg : undefined;

    if (location && message) {
      return `${location}: ${message}`;
    }

    if (message) {
      return message;
    }

    if (typeof detail.message === "string") {
      return detail.message;
    }

    return JSON.stringify(detail);
  }

  if (typeof detail === "string") {
    return detail;
  }

  return "";
}

function messageFromError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function extractReportedCost(response: unknown) {
  const records = [response];

  if (isRecord(response) && isRecord(response.data)) {
    records.push(response.data);
  }

  for (const record of records) {
    if (!isRecord(record)) {
      continue;
    }

    for (const key of ["reportedCostUsd", "costUsd", "cost_usd", "cost"]) {
      const value = record[key];

      if (typeof value === "number" && Number.isFinite(value)) {
        return value;
      }
    }
  }

  return 0;
}

function requestIdFrom(response: unknown) {
  if (!isRecord(response)) {
    return undefined;
  }

  const requestId = response.requestId ?? response.request_id;

  return typeof requestId === "string" ? requestId : undefined;
}

function extractImageUrl(response: unknown) {
  const data = isRecord(response) ? response.data : undefined;
  const records = [response, data].filter(isRecord);

  for (const record of records) {
    const image = record.image;

    if (isRecord(image) && typeof image.url === "string") {
      return image.url;
    }

    if (typeof image === "string") {
      return image;
    }

    const output = record.output;

    if (isRecord(output) && typeof output.url === "string") {
      return output.url;
    }

    if (typeof output === "string") {
      return output;
    }

    const images = record.images;

    if (Array.isArray(images)) {
      const imageWithUrl = images.find(
        (entry): entry is { url: string } => isRecord(entry) && typeof entry.url === "string"
      );

      if (imageWithUrl) {
        return imageWithUrl.url;
      }
    }
  }

  return null;
}

async function downloadImageToFile(url: string, outputPath: string) {
  const parsedUrl = new URL(url);

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new Error(`Unsupported fal.ai output URL protocol: ${parsedUrl.protocol}`);
  }

  const response = await undiciRequest(parsedUrl, {
    method: "GET",
    bodyTimeout: 30_000,
    headersTimeout: 30_000
  });

  if (response.statusCode < 200 || response.statusCode >= 300) {
    await response.body.dump();
    throw new Error(`Unable to download fal.ai output image: HTTP ${response.statusCode}`);
  }

  const bytes = Buffer.from(await response.body.arrayBuffer());

  await mkdir(path.dirname(outputPath), { recursive: true });
  await sharp(bytes).toFile(outputPath);
}

function paramsForModel(params: Record<string, unknown>, supportsNegativePrompt: boolean | undefined) {
  if (supportsNegativePrompt !== false) {
    return params;
  }

  const { negative_prompt: negativePrompt, prompt, ...rest } = params;

  if (typeof prompt !== "string" || typeof negativePrompt !== "string" || !negativePrompt.trim()) {
    return {
      ...rest,
      prompt
    };
  }

  return {
    ...rest,
    prompt: `${prompt}\n\nAvoid generating: ${negativePrompt}`
  };
}

function resolveOutputPath(request: FalAssetRequest) {
  if (request.outputPath) {
    return request.outputPath;
  }

  return path.join(runOutputDir(request), "raw", `${safeSegment(request.assetId)}.png`);
}

function runOutputDir(
  request: Pick<
    FalAssetRequest,
    "outputRoot" | "projectSlug" | "destinationSlug" | "campaignSlug" | "runId"
  >
) {
  const segments = [
    request.outputRoot ?? DEFAULT_OUTPUT_ROOT,
    request.projectSlug ? safeSegment(request.projectSlug) : null,
    request.destinationSlug ? safeSegment(request.destinationSlug) : null,
    safeSegment(request.campaignSlug),
    request.runId
  ].filter((segment): segment is string => Boolean(segment));

  return path.join(
    ...segments
  );
}

function safeSegment(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function colorFor(input: string) {
  const hash = createHash("sha256").update(input).digest();

  return `#${hash[0].toString(16).padStart(2, "0")}${hash[1]
    .toString(16)
    .padStart(2, "0")}${hash[2].toString(16).padStart(2, "0")}`;
}

function contrastColor(hexColor: string) {
  const red = Number.parseInt(hexColor.slice(1, 3), 16);
  const green = Number.parseInt(hexColor.slice(3, 5), 16);
  const blue = Number.parseInt(hexColor.slice(5, 7), 16);
  const luminance = (0.299 * red + 0.587 * green + 0.114 * blue) / 255;

  return luminance > 0.55 ? "#111827" : "#ffffff";
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function assertServerRuntime() {
  if (typeof window !== "undefined" && process.env.NODE_ENV !== "test") {
    throw new Error("src/generators/fal-client.ts is server-side only.");
  }
}
