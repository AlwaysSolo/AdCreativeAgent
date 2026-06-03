import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { load } from "cheerio";

import type { ModelInfo } from "../schemas";

export type ModelCatalogResult = {
  models: ModelInfo[];
  fetchedAt: string;
  source: "live" | "cache";
  staleSince?: string;
};

type CatalogCache = {
  fetchedAt: string;
  models: ModelInfo[];
};

type CatalogOptions = {
  cachePath?: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  forceRefresh?: boolean;
};

export type ModelSearchOptions = {
  q?: string | null;
  kind?: ModelInfo["kind"] | null;
  tags?: string[];
  limit?: number;
};

const MODEL_INDEX_URL = "https://fal.ai/models";
const DEFAULT_CACHE_PATH = path.join(process.cwd(), "cache", "models-catalog.json");
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export async function loadModelCatalog(
  options: CatalogOptions = {}
): Promise<ModelCatalogResult> {
  const cachePath = options.cachePath ?? DEFAULT_CACHE_PATH;
  const now = options.now?.() ?? new Date();
  const cached = await readCatalogCache(cachePath);

  if (!options.forceRefresh && cached && isFresh(cached, now)) {
    return {
      models: cached.models,
      fetchedAt: cached.fetchedAt,
      source: "cache"
    };
  }

  try {
    return await fetchAndCacheCatalog({ ...options, cachePath, now: () => now });
  } catch (error) {
    if (cached) {
      return {
        models: cached.models,
        fetchedAt: cached.fetchedAt,
        source: "cache",
        staleSince: cached.fetchedAt
      };
    }

    throw error;
  }
}

export async function refreshModelCatalog(
  options: Omit<CatalogOptions, "forceRefresh"> = {}
) {
  return loadModelCatalog({ ...options, forceRefresh: true });
}

export function searchModelCatalog(
  models: readonly ModelInfo[],
  options: ModelSearchOptions = {}
) {
  const query = normalizeSearch(options.q ?? "");
  const queryTerms = query ? query.split(" ").filter(Boolean) : [];
  const requiredTags = (options.tags ?? []).map(normalizeSearch).filter(Boolean);
  const limit = options.limit ?? 50;

  return models
    .filter((model) => !options.kind || model.kind === options.kind)
    .filter((model) => {
      if (requiredTags.length === 0) {
        return true;
      }

      const modelTags = new Set((model.tags ?? []).map(normalizeSearch));

      return requiredTags.every((tag) => modelTags.has(tag));
    })
    .map((model) => ({
      model,
      score: scoreModel(model, queryTerms, query)
    }))
    .filter(({ score }) => queryTerms.length === 0 || score > 0)
    .sort((left, right) => right.score - left.score || left.model.id.localeCompare(right.model.id))
    .slice(0, limit)
    .map(({ model }) => model);
}

export function createManualModelInfo(modelId: string, kind: "image" | "video"): ModelInfo {
  if (!looksLikeModelId(modelId)) {
    throw new Error("Model id must look like provider/model-name.");
  }

  return stripUndefined({
    id: modelId,
    name: modelId,
    kind,
    tags: ["manual-entry"],
    capabilities: stripUndefined({
      textToImage: kind === "image" ? true : undefined,
      imageToVideo: kind === "video" ? true : undefined
    })
  });
}

export function normalizeModelIndex(raw: string): ModelInfo[] {
  const trimmed = raw.trim();

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return normalizeRecords(extractRecords(JSON.parse(trimmed)));
  }

  const htmlModels = normalizeHtmlCards(raw);

  if (htmlModels.length > 0) {
    return htmlModels;
  }

  return normalizeRecords(extractRecordsFromText(raw));
}

async function fetchAndCacheCatalog(
  options: Required<Pick<CatalogOptions, "cachePath" | "now">> & CatalogOptions
): Promise<ModelCatalogResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(MODEL_INDEX_URL, {
    headers: {
      accept: "text/html,application/json",
      "user-agent": "ResortAdCreativeGenerator/0.1 (+local-dev)"
    }
  });

  if (!response.ok) {
    throw new Error(`fal.ai model index returned HTTP ${response.status}`);
  }

  const models = dedupeModels(normalizeModelIndex(await response.text()));
  const fetchedAt = options.now().toISOString();
  const cache: CatalogCache = { fetchedAt, models };

  await mkdir(path.dirname(options.cachePath), { recursive: true });
  await writeFile(options.cachePath, JSON.stringify(cache, null, 2));

  return {
    models,
    fetchedAt,
    source: "live"
  };
}

async function readCatalogCache(cachePath: string) {
  try {
    const parsed = JSON.parse(await readFile(cachePath, "utf8")) as unknown;

    if (!isRecord(parsed) || typeof parsed.fetchedAt !== "string" || !Array.isArray(parsed.models)) {
      return null;
    }

    return {
      fetchedAt: parsed.fetchedAt,
      models: parsed.models.filter(isModelInfo)
    } satisfies CatalogCache;
  } catch {
    return null;
  }
}

function isFresh(cache: CatalogCache, now: Date) {
  const fetchedAt = new Date(cache.fetchedAt);

  return !Number.isNaN(fetchedAt.valueOf()) && now.valueOf() - fetchedAt.valueOf() < CACHE_TTL_MS;
}

function normalizeRecords(records: unknown[]) {
  return dedupeModels(records.map(normalizeRecord).filter((model): model is ModelInfo => model !== null));
}

function normalizeRecord(record: unknown): ModelInfo | null {
  if (!isRecord(record)) {
    return null;
  }

  const id = firstString(record, [
    "id",
    "endpointId",
    "endpoint_id",
    "modelId",
    "model_id",
    "slug",
    "path"
  ]);

  if (!id || !looksLikeModelId(id)) {
    return null;
  }

  const name = firstString(record, ["name", "title", "displayName", "display_name"]) ?? labelFromId(id);
  const description =
    firstString(record, ["description", "shortDescription", "summary"]) ?? undefined;
  const tags = uniqueStrings([
    ...arrayOfStrings(record.tags),
    ...arrayOfStrings(record.categories),
    ...inferTags(id, name, description)
  ]);
  const capabilities = inferCapabilities(record, id, name, description, tags);

  return stripUndefined({
    id,
    name,
    kind: inferKind(id, name, description, tags),
    description: description ?? undefined,
    tags,
    thumbnailUrl:
      firstString(record, ["thumbnailUrl", "thumbnail_url", "imageUrl", "image", "coverImage"]) ??
      undefined,
    pricing: inferPricing(record),
    capabilities
  });
}

function normalizeHtmlCards(html: string) {
  const $ = load(html);
  const models: ModelInfo[] = [];

  $('a[href^="/models/"]').each((_, element) => {
    const href = $(element).attr("href")?.split("?")[0] ?? "";

    if (!href || href.endsWith("/api")) {
      return;
    }

    const id = decodeURIComponent(href.replace(/^\/models\//, "")).replace(/\/api$/, "");

    if (!looksLikeModelId(id)) {
      return;
    }

    const card = $(element);
    const image = card.find("img").first();
    const visibleLabel = normalizeWhitespace(card.find("span").first().text());
    const name = visibleLabel || labelFromId(id);
    const description =
      normalizeWhitespace(card.find("p").first().text()) ||
      normalizeWhitespace(image.attr("alt")) ||
      undefined;
    const tags = uniqueStrings(inferTags(id, name, description));

    models.push(
      stripUndefined({
        id,
        name,
        kind: inferKind(id, name, description, tags),
        description,
        tags,
        thumbnailUrl: image.attr("src") || undefined,
        capabilities: inferCapabilities({}, id, name, description, tags)
      })
    );
  });

  return dedupeModels(models);
}

function extractRecords(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value.flatMap(extractRecords);
  }

  if (!isRecord(value)) {
    return [];
  }

  const direct = Array.isArray(value.models)
    ? value.models
    : Array.isArray(value.data)
      ? value.data
      : Array.isArray(value.items)
        ? value.items
        : Array.isArray(value.endpoints)
          ? value.endpoints
          : null;

  if (direct) {
    return direct.flatMap(extractRecords);
  }

  if (hasPotentialModelId(value)) {
    return [value];
  }

  return Object.values(value).flatMap(extractRecords);
}

function extractRecordsFromText(value: string) {
  const records: unknown[] = [];
  const modelIdPattern = /(?:fal-ai|[^"'\s/]+)\/[a-z0-9][a-z0-9._/-]+/gi;

  for (const match of value.matchAll(modelIdPattern)) {
    const id = match[0].replace(/\\u002f/g, "/");

    if (looksLikeModelId(id)) {
      records.push({ id, name: labelFromId(id) });
    }
  }

  return records;
}

function inferKind(
  id: string,
  name: string,
  description: string | undefined,
  tags: readonly string[]
): ModelInfo["kind"] {
  const corpus = textCorpus(id, name, description, tags);

  if (/\b(audio|speech|voice|music|sound|tts|text-to-speech)\b/.test(corpus)) {
    return "audio";
  }

  if (/\b(video|image-to-video|text-to-video|i2v|t2v|kling|veo|runway|seedance|ltx)\b/.test(corpus)) {
    return "video";
  }

  if (
    /\b(image|photo|photoreal|text-to-image|image-to-image|flux|ideogram|imagen|stable-diffusion|sdxl|recraft|nano-banana|background|upscale)\b/.test(
      corpus
    )
  ) {
    return "image";
  }

  return "other";
}

function inferCapabilities(
  record: Record<string, unknown>,
  id: string,
  name: string,
  description: string | undefined,
  tags: readonly string[]
) {
  const corpus = textCorpus(id, name, description, tags);
  const explicitCapabilities = isRecord(record.capabilities) ? record.capabilities : {};
  const maxResolution = inferMaxResolution(record, explicitCapabilities);
  const supportedAspects = firstStringArray(record, ["supportedAspects", "aspectRatios"]) ??
    firstStringArray(explicitCapabilities, ["supportedAspects", "aspectRatios"]);

  return stripUndefined({
    textToImage:
      booleanValue(explicitCapabilities.textToImage) ??
      /\b(text-to-image|text to image|txt2img|t2i)\b/.test(corpus),
    imageToImage:
      booleanValue(explicitCapabilities.imageToImage) ??
      /\b(image-to-image|image to image|img2img|i2i|edit|inpaint|outpaint)\b/.test(corpus),
    imageToVideo:
      booleanValue(explicitCapabilities.imageToVideo) ??
      /\b(image-to-video|image to video|i2v)\b/.test(corpus),
    supportsOnImageText:
      booleanValue(explicitCapabilities.supportsOnImageText) ??
      /\b(ideogram|text rendering|typography|poster|logo generation)\b/.test(corpus),
    supportsNegativePrompt:
      booleanValue(explicitCapabilities.supportsNegativePrompt) ??
      inferNegativePromptSupport(corpus),
    maxResolution,
    supportedAspects
  });
}

function inferNegativePromptSupport(corpus: string) {
  if (/\b(openai|gpt image|gpt-image|dall e|dall-e|imagen)\b/.test(corpus)) {
    return false;
  }

  return undefined;
}

function inferTags(id: string, name: string, description: string | undefined) {
  const corpus = textCorpus(id, name, description, []);
  const tags: string[] = [];

  if (/\b(text-to-image|text to image|txt2img|t2i|flux|ideogram|imagen)\b/.test(corpus)) {
    tags.push("text-to-image");
  }
  if (/\b(image-to-image|image to image|edit|inpaint|outpaint)\b/.test(corpus)) {
    tags.push("image-to-image");
  }
  if (/\b(image-to-video|image to video|i2v)\b/.test(corpus)) {
    tags.push("image-to-video");
  }
  if (/\b(photoreal|photo|cinematic|realistic)\b/.test(corpus)) {
    tags.push("photorealistic");
  }
  if (/\b(illustration|vector|anime|cartoon)\b/.test(corpus)) {
    tags.push("illustration");
  }
  if (/\b(ideogram|text rendering|typography|poster)\b/.test(corpus)) {
    tags.push("supports-on-image-text");
  }
  if (/\b(fast|schnell|turbo|lightning)\b/.test(corpus)) {
    tags.push("fast");
  }
  if (/\b(pro|ultra|premium|master)\b/.test(corpus)) {
    tags.push("premium");
  }

  return tags;
}

function inferPricing(record: Record<string, unknown>) {
  const pricing = isRecord(record.pricing) ? record.pricing : null;

  if (pricing) {
    const unit = firstString(pricing, ["unit"]);
    const amountUsd = numberValue(pricing.amountUsd) ?? numberValue(pricing.amount_usd);

    if (isPricingUnit(unit) && amountUsd !== null && amountUsd >= 0) {
      return {
        unit,
        amountUsd
      };
    }
  }

  const amountUsd = numberValue(record.amountUsd) ?? numberValue(record.priceUsd);

  if (amountUsd !== null && amountUsd >= 0) {
    return {
      unit: "request" as const,
      amountUsd
    };
  }

  return undefined;
}

function inferMaxResolution(...records: Array<Record<string, unknown>>) {
  for (const record of records) {
    const direct = isRecord(record.maxResolution) ? record.maxResolution : null;
    const w = numberValue(direct?.w) ?? numberValue(direct?.width) ?? numberValue(record.maxWidth);
    const h = numberValue(direct?.h) ?? numberValue(direct?.height) ?? numberValue(record.maxHeight);

    if (w && h) {
      return {
        w,
        h
      };
    }
  }

  return undefined;
}

function scoreModel(model: ModelInfo, queryTerms: readonly string[], query: string) {
  if (queryTerms.length === 0) {
    return 1;
  }

  const id = normalizeSearch(model.id);
  const name = normalizeSearch(model.name);
  const description = normalizeSearch(model.description ?? "");
  const tags = normalizeSearch((model.tags ?? []).join(" "));
  let score = 0;

  if (id === query) {
    score += 1000;
  }
  if (id.includes(query)) {
    score += 200;
  }
  if (name.includes(query)) {
    score += 150;
  }

  for (const term of queryTerms) {
    if (id.includes(term)) {
      score += 50;
    }
    if (name.includes(term)) {
      score += 30;
    }
    if (tags.includes(term)) {
      score += 20;
    }
    if (description.includes(term)) {
      score += 5;
    }
  }

  return score;
}

function textCorpus(
  id: string,
  name: string,
  description: string | undefined,
  tags: readonly string[]
) {
  return normalizeSearch([id, name, description ?? "", ...tags].join(" "));
}

function normalizeSearch(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function labelFromId(id: string) {
  return id.split("/").slice(1).join("/") || id;
}

function looksLikeModelId(value: string) {
  return /^[a-z0-9][a-z0-9._-]+\/[a-z0-9][a-z0-9._/-]+$/i.test(value);
}

function hasPotentialModelId(record: Record<string, unknown>) {
  return ["id", "endpointId", "endpoint_id", "modelId", "model_id", "slug"].some((key) => {
    const value = record[key];

    return typeof value === "string" && looksLikeModelId(value);
  });
}

function firstString(record: Record<string, unknown>, keys: readonly string[]) {
  for (const key of keys) {
    const value = record[key];

    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

function firstStringArray(record: Record<string, unknown>, keys: readonly string[]) {
  for (const key of keys) {
    const values = arrayOfStrings(record[key]);

    if (values.length > 0) {
      return values;
    }
  }

  return undefined;
}

function arrayOfStrings(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];
}

function uniqueStrings(values: readonly string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function normalizeWhitespace(value: string | null | undefined) {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function booleanValue(value: unknown) {
  return typeof value === "boolean" ? value : undefined;
}

function isPricingUnit(value: string | null): value is "image" | "second" | "megapixel" | "request" {
  return value === "image" || value === "second" || value === "megapixel" || value === "request";
}

function dedupeModels(models: readonly ModelInfo[]) {
  const byId = new Map<string, ModelInfo>();

  for (const model of models) {
    if (!byId.has(model.id)) {
      byId.set(model.id, model);
    }
  }

  return Array.from(byId.values());
}

function isModelInfo(value: unknown): value is ModelInfo {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    (value.kind === "image" ||
      value.kind === "video" ||
      value.kind === "audio" ||
      value.kind === "other")
  );
}

function stripUndefined<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined)
  ) as {
    [K in keyof T as undefined extends T[K] ? never : K]: T[K];
  } & Partial<T>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
