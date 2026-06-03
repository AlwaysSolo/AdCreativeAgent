import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { load } from "cheerio";
import { request } from "undici";

export type ScrapedCreativeBrief = {
  resortName: string | null;
  headline: string | null;
  subheadline: string | null;
  offer: string | null;
  validDates: string | null;
  ctaText: string | null;
  heroImageUrl: string | null;
  brandColors: string[];
  location: string | null;
  campaignName?: string;
  promotionSummary?: string;
  targetAudience?: string;
  tone?: string;
  mustIncludeVisualElements?: string[];
  mustAvoidElements?: string[];
};

type CachedScrape = {
  schemaVersion: number;
  cachedAt: string;
  url: string;
  brief: ScrapedCreativeBrief;
};

type ScrapeOptions = {
  cacheDir?: string;
  fetchHtml?: (url: string) => Promise<string>;
  now?: () => Date;
};

type FetchedHtml = {
  html: string;
  finalUrl: string;
};

const DEFAULT_CACHE_TTL_MS = 60 * 60 * 1000;
const DEFAULT_CACHE_DIR = path.join(process.cwd(), "cache", "scrape");
const CACHE_SCHEMA_VERSION = 5;
const MAX_REDIRECTS = 5;
const WESTGATE_BRAND_COLORS = ["#0e2545", "#c4a55d", "#d95d31", "#3892dc", "#148dd0"] as const;
const MONTH =
  "Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?";
const DATE_RANGE_REGEX = new RegExp(
  `\\b((?:${MONTH})\\s+\\d{1,2}(?:,\\s*\\d{4})?\\s*(?:-|–|—|to|through)\\s*(?:${MONTH})\\s+\\d{1,2}(?:,\\s*\\d{4})?)\\b`,
  "i"
);
const OFFER_REGEX =
  /\b(save\s+\d+%|save\s+\$\d[\d,]*(?:\.\d{2})?|\d+%\s+off|from\s+\$\d[\d,]*(?:\.\d{2})?|\$\d[\d,]*(?:\.\d{2})?)(?=\s|[.,;:!?]|$)/i;
const CTA_REGEX =
  /\b(book now|book by phone|reserve|reserve now|learn more|get offer|view offer|call today|call now|search)\b/i;
const HEX_COLOR_REGEX = /#[0-9a-fA-F]{6}\b/g;
const RGB_COLOR_REGEX = /rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)/g;
const WORDPRESS_GLOBAL_COLORS = new Set([
  "#abb8c3",
  "#f78da7",
  "#cf2e2e",
  "#ff6900",
  "#fcb900",
  "#7bdcb5",
  "#00d084",
  "#8ed1fc",
  "#0693e3",
  "#9b51e0"
]);

export function getScrapeCachePath(url: string, cacheDir = DEFAULT_CACHE_DIR) {
  const hash = createHash("sha256").update(url).digest("hex");

  return path.join(cacheDir, `${hash}.json`);
}

export async function scrapeLandingPage(
  url: string,
  options: ScrapeOptions = {}
): Promise<ScrapedCreativeBrief> {
  const cacheDir = options.cacheDir ?? DEFAULT_CACHE_DIR;
  const now = options.now ?? (() => new Date());
  const cachePath = getScrapeCachePath(url, cacheDir);
  const cached = await readCachedScrape(cachePath, now());

  if (cached?.url === url) {
    return cached.brief;
  }

  const fetched = options.fetchHtml
    ? { html: await options.fetchHtml(url), finalUrl: url }
    : await fetchHtml(url);
  const brief = extractCreativeBriefFromHtml(fetched.html, fetched.finalUrl);

  await mkdir(cacheDir, { recursive: true });
  await writeFile(
    cachePath,
    JSON.stringify(
      {
        schemaVersion: CACHE_SCHEMA_VERSION,
        cachedAt: now().toISOString(),
        url,
        brief
      } satisfies CachedScrape,
      null,
      2
    )
  );

  return brief;
}

export function extractCreativeBriefFromHtml(
  html: string,
  sourceUrl: string
): ScrapedCreativeBrief {
  const $ = load(html);
  const pageText = normalizeText($("body").text());
  const jsonLd = parseJsonLd($);
  const appData = parseWestgateAppData(html);
  const special = findWestgateSpecial(appData, sourceUrl);
  const resort = findRelatedAppDataRecord(appData, "resorts", "resort_id", numberArray(special?.resorts));
  const destination = findRelatedAppDataRecord(
    appData,
    "destinations",
    "id",
    numberArray(special?.destinations)
  );
  const title = $("title").first().text();
  const ogTitle = metaContent($, "property", "og:title");
  const metaDescription = metaContent($, "name", "description");
  const ogDescription = metaContent($, "property", "og:description");
  const searchableText = [
    title,
    ogTitle,
    metaDescription,
    ogDescription,
    stringValue(special?.title),
    pageText
  ].join(" ");

  const resortName = firstNonEmpty([
    stringValue(resort?.title),
    title,
    metaContent($, "property", "og:site_name"),
    schemaString(jsonLd, "name")
  ]);
  const headline = firstNonEmpty([
    firstUsefulHeading($, "h1"),
    ogTitle,
    title,
    stringValue(special?.title)
  ]);
  const subheadline = firstNonEmpty([
    firstUsefulHeading($, "h2"),
    metaDescription,
    ogDescription,
    firstUsefulParagraph($),
    stringValue(resort?.excerpt)
  ]);
  const heroImageUrl = resolveUrl(
    firstNonEmpty([
      nestedString(special, ["thumbnails", "full"]),
      metaContent($, "property", "og:image"),
      metaContent($, "name", "twitter:image"),
      $("img").first().attr("src")
    ]),
    sourceUrl
  );
  const baseBrief = {
    resortName,
    headline,
    subheadline,
    offer: firstNonEmpty([findOfferFromSpecial(special), findOffer(searchableText)]),
    validDates: findValidDates(pageText),
    ctaText: findCtaText($),
    heroImageUrl,
    brandColors: [...WESTGATE_BRAND_COLORS],
    location: firstNonEmpty([
      locationFromRecord(resort),
      stringValue(destination?.long),
      findLocation(jsonLd, pageText)
    ])
  };
  const suggestionContext = {
    specialTitle: stringValue(special?.title),
    packageIncludes: recordArray(special, "package_includes")
      .map((item) => stringValue(item.item))
      .filter((item): item is string => item !== null),
    resortExcerpt: stringValue(resort?.excerpt),
    pageText: searchableText
  };

  return {
    ...baseBrief,
    ...suggestBriefFields(baseBrief, suggestionContext)
  };
}

async function fetchHtml(url: string): Promise<FetchedHtml> {
  let currentUrl = url;

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const response = await request(currentUrl, {
      method: "GET",
      headers: {
        "user-agent": "ResortAdCreativeGenerator/0.1 (+local-dev)"
      },
      bodyTimeout: 15_000,
      headersTimeout: 15_000
    });

    if (isRedirectStatus(response.statusCode)) {
      const location = firstHeaderValue(response.headers.location);

      await response.body.dump();

      if (!location) {
        throw new Error(`Scrape failed with HTTP ${response.statusCode} redirect missing location`);
      }

      currentUrl = resolveRedirectLocation(currentUrl, location);
      continue;
    }

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new Error(`Scrape failed with HTTP ${response.statusCode}`);
    }

    return {
      html: await response.body.text(),
      finalUrl: currentUrl
    };
  }

  throw new Error(`Scrape failed after ${MAX_REDIRECTS} redirects`);
}

async function readCachedScrape(cachePath: string, now: Date) {
  try {
    const parsed = JSON.parse(await readFile(cachePath, "utf8")) as CachedScrape;
    const cachedAt = new Date(parsed.cachedAt);

    if (parsed.schemaVersion !== CACHE_SCHEMA_VERSION) {
      return null;
    }

    if (Number.isNaN(cachedAt.valueOf())) {
      return null;
    }

    if (now.valueOf() - cachedAt.valueOf() > DEFAULT_CACHE_TTL_MS) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

function isRedirectStatus(statusCode: number) {
  return [301, 302, 303, 307, 308].includes(statusCode);
}

function firstHeaderValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
}

function resolveRedirectLocation(currentUrl: string, location: string) {
  const redirectedUrl = new URL(location, currentUrl);

  if (redirectedUrl.protocol !== "http:" && redirectedUrl.protocol !== "https:") {
    throw new Error(`Scrape failed with unsupported redirect protocol ${redirectedUrl.protocol}`);
  }

  return redirectedUrl.toString();
}

function metaContent(
  $: ReturnType<typeof load>,
  attribute: "name" | "property",
  value: string
) {
  return $(`meta[${attribute}="${value}"]`).attr("content");
}

function normalizeText(value: string | null | undefined) {
  const normalized = value?.replace(/\s+/g, " ").trim();

  return normalized && normalized.length > 0 ? normalized : null;
}

function firstNonEmpty(values: Array<string | null | undefined>) {
  for (const value of values) {
    const normalized = normalizeText(value);

    if (normalized) {
      return normalized;
    }
  }

  return null;
}

function findOffer(text: string | null) {
  if (!text) {
    return null;
  }

  return normalizeText(text.match(OFFER_REGEX)?.[1]);
}

function findValidDates(text: string | null) {
  if (!text) {
    return null;
  }

  return normalizeText(text.match(DATE_RANGE_REGEX)?.[1]);
}

function findCtaText($: ReturnType<typeof load>) {
  const candidates = collectCtaCandidates($);
  const templateCandidates: string[] = [];

  $('script[type="text/ng-template"]').each((_, element) => {
    const templateHtml = $(element).contents().text();
    const template = load(templateHtml);

    templateCandidates.push(...collectCtaCandidates(template));
  });

  return [...candidates, ...templateCandidates]
    .filter((text) => CTA_REGEX.test(text))
    .sort((left, right) => ctaPriority(left) - ctaPriority(right) || left.length - right.length)[0] ?? null;
}

function collectCtaCandidates($: ReturnType<typeof load>) {
  return $("a, button, input[type='submit'], [role='button'], strong")
    .toArray()
    .filter((element) => !hasHiddenAngularCondition($, element))
    .map((element) =>
      normalizeText(
        $(element).text() ||
          $(element).attr("value") ||
          $(element).attr("aria-label") ||
          $(element).attr("title")
      )
    )
    .filter((value): value is string => value !== null);
}

function hasHiddenAngularCondition(
  $: ReturnType<typeof load>,
  element: Parameters<ReturnType<typeof load>>[0]
) {
  return $(element)
    .parents()
    .addBack()
    .toArray()
    .some((candidate) => {
      const condition = [$(candidate).attr("ng-if"), $(candidate).attr("ng-show")]
        .filter(Boolean)
        .join(" ");

      return /\bopen_dated\b/i.test(condition);
    });
}

function ctaPriority(text: string) {
  const normalized = text.toLowerCase();

  if (normalized.includes("book now")) {
    return 0;
  }

  if (normalized.includes("reserve now")) {
    return 1;
  }

  if (normalized.includes("book by phone")) {
    return 2;
  }

  if (normalized.includes("get offer") || normalized.includes("view offer")) {
    return 3;
  }

  if (normalized === "reserve") {
    return 4;
  }

  if (normalized === "search") {
    return 8;
  }

  return 6;
}

function extractBrandColors(html: string) {
  const colors: string[] = [];

  for (const match of html.matchAll(HEX_COLOR_REGEX)) {
    colors.push(match[0].toLowerCase());
  }

  for (const match of html.matchAll(RGB_COLOR_REGEX)) {
    const channels = match
      .slice(1, 4)
      .map((value) => Number(value))
      .filter((value) => value >= 0 && value <= 255);

    if (channels.length === 3) {
      colors.push(
        `#${channels.map((value) => value.toString(16).padStart(2, "0")).join("")}`
      );
    }
  }

  const filtered = colors.filter((color) => isUsefulBrandColor(color));

  return (filtered.length > 0 ? filtered : colors).slice(0, 8);
}

function resolveUrl(value: string | null, sourceUrl: string) {
  if (!value) {
    return null;
  }

  try {
    return new URL(value, sourceUrl).toString();
  } catch {
    return value;
  }
}

function parseJsonLd($: ReturnType<typeof load>) {
  const values: unknown[] = [];

  $('script[type="application/ld+json"]').each((_, element) => {
    try {
      values.push(...flattenJsonLd(JSON.parse($(element).contents().text())));
    } catch {
      // Ignore malformed structured data and continue with visible content.
    }
  });

  return values;
}

function parseWestgateAppData(html: string) {
  const marker = ".constant('APP_DATA'";
  const markerIndex = html.indexOf(marker);

  if (markerIndex === -1) {
    return null;
  }

  const jsonText = extractBalancedJsonObject(html, markerIndex + marker.length);

  if (!jsonText) {
    return null;
  }

  try {
    const parsed = JSON.parse(jsonText);

    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function extractBalancedJsonObject(text: string, startIndex: number) {
  const objectStart = text.indexOf("{", startIndex);

  if (objectStart === -1) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = objectStart; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }

      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;

      if (depth === 0) {
        return text.slice(objectStart, index + 1);
      }
    }
  }

  return null;
}

function findWestgateSpecial(appData: Record<string, unknown> | null, sourceUrl: string) {
  const specials = recordArray(appData, "specials");
  const normalizedSource = normalizeUrlForMatch(sourceUrl);

  return (
    specials.find((special) => normalizeUrlForMatch(stringValue(special.url)) === normalizedSource) ??
    specials.find((special) => numberValue(special.special_id) === numberValue(appData?.page_id)) ??
    null
  );
}

function findRelatedAppDataRecord(
  appData: Record<string, unknown> | null,
  collectionKey: string,
  idKey: string,
  ids: number[]
) {
  if (ids.length === 0) {
    return null;
  }

  return recordArray(appData, collectionKey).find((record) => {
    const id = numberValue(record[idKey]);

    return id !== null && ids.includes(id);
  }) ?? null;
}

function findOfferFromSpecial(special: Record<string, unknown> | null) {
  const discounted = numberValue(nestedValue(special, ["prices", "discounted"]));
  const savings = numberValue(nestedValue(special, ["prices", "savings"]));

  if (discounted !== null) {
    return `from $${formatWholeUsd(discounted)}`;
  }

  if (savings !== null) {
    return `Save $${formatWholeUsd(savings)}`;
  }

  return null;
}

function firstUsefulHeading($: ReturnType<typeof load>, selector: "h1" | "h2") {
  const ignored = new Set(["site index", "share this offer"]);

  return $(selector)
    .toArray()
    .map((element) => normalizeText($(element).text()))
    .find((text): text is string => text !== null && !ignored.has(text.toLowerCase())) ?? null;
}

function firstUsefulParagraph($: ReturnType<typeof load>) {
  return $("main p, article p, .entry-content p, p")
    .toArray()
    .map((element) => normalizeText($(element).text()))
    .find((text): text is string => text !== null && text.length >= 40 && !text.includes("{{")) ?? null;
}

function locationFromRecord(record: Record<string, unknown> | null) {
  const city = stringValue(record?.city);
  const state = stringValue(record?.state);

  return firstNonEmpty([[city, state].filter(Boolean).join(", "), stringValue(record?.destination)]);
}

function recordArray(record: Record<string, unknown> | null, key: string) {
  const value = record?.[key];

  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function nestedString(record: Record<string, unknown> | null, keys: string[]) {
  const value = nestedValue(record, keys);

  return typeof value === "string" ? value : null;
}

function nestedValue(record: Record<string, unknown> | null, keys: string[]) {
  let current: unknown = record;

  for (const key of keys) {
    if (!isRecord(current)) {
      return null;
    }

    current = current[key];
  }

  return current;
}

function numberArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(numberValue)
    .filter((entry): entry is number => entry !== null);
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function formatWholeUsd(value: number) {
  return Math.round(value).toLocaleString("en-US");
}

function normalizeUrlForMatch(value: string | null) {
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value);

    url.hash = "";
    url.search = "";

    return url.toString().replace(/\/$/, "");
  } catch {
    return value.replace(/\/$/, "");
  }
}

function isUsefulBrandColor(color: string) {
  if (WORDPRESS_GLOBAL_COLORS.has(color)) {
    return false;
  }

  const channels = color
    .slice(1)
    .match(/[0-9a-f]{2}/gi)
    ?.map((value) => Number.parseInt(value, 16));

  if (!channels || channels.length !== 3) {
    return true;
  }

  const [red, green, blue] = channels;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);

  if (max < 24 || min > 232) {
    return false;
  }

  return max - min > 16;
}

type BaseScrapedCreativeBrief = Pick<
  ScrapedCreativeBrief,
  | "resortName"
  | "headline"
  | "subheadline"
  | "offer"
  | "validDates"
  | "ctaText"
  | "heroImageUrl"
  | "brandColors"
  | "location"
>;

type SuggestionContext = {
  specialTitle: string | null;
  packageIncludes: string[];
  resortExcerpt: string | null;
  pageText: string;
};

function suggestBriefFields(
  brief: BaseScrapedCreativeBrief,
  context: SuggestionContext
): Partial<ScrapedCreativeBrief> {
  if (!brief.resortName || !brief.headline || !brief.offer) {
    return {};
  }

  const combinedText = normalizeText(
    [
      brief.headline,
      brief.subheadline,
      brief.offer,
      brief.location,
      context.specialTitle,
      context.resortExcerpt,
      context.packageIncludes.join(" "),
      context.pageText
    ].join(" ")
  ) ?? "";
  const campaignName = suggestCampaignName(brief, context.specialTitle);
  const packageSummary = context.packageIncludes.slice(0, 4).join(", ");

  return removeEmptySuggestionFields({
    campaignName: campaignName ?? undefined,
    promotionSummary: buildPromotionSummary(brief, context, packageSummary),
    targetAudience: suggestTargetAudience(combinedText),
    tone: suggestTone(combinedText),
    mustIncludeVisualElements: suggestMustIncludeVisuals(brief, context),
    mustAvoidElements: suggestMustAvoidElements(combinedText)
  });
}

function suggestCampaignName(brief: BaseScrapedCreativeBrief, specialTitle: string | null) {
  const sourceText = [
    specialTitle,
    brief.headline,
    brief.offer,
    brief.resortName
  ]
    .filter(Boolean)
    .join(" ");

  return firstNonEmpty([
    compactCampaignNameFromPromotion(sourceText),
    compactCampaignNameFromHeadline(brief.headline),
    compactCampaignNameFromHeadline(specialTitle),
    brief.resortName
  ]);
}

function compactCampaignNameFromPromotion(text: string) {
  const normalized = text.toLowerCase();
  const promotions: Array<[RegExp, string]> = [
    [/\bmemorial\s+day\b/i, "Memorial Day"],
    [/\b(?:4th|fourth)\s+of\s+july\b/i, "July 4th"],
    [/\bjuly\s+4(?:th)?\b/i, "July 4th"],
    [/\bindependence\s+day\b/i, "July 4th"],
    [/\blabor\s+day\b/i, "Labor Day"],
    [/\bblack\s+friday\b/i, "Black Friday"],
    [/\bcyber\s+monday\b/i, "Cyber Monday"],
    [/\bchristmas\b/i, "Christmas"],
    [/\bnew\s+year(?:'s)?\b/i, "New Year"],
    [/\buniversal(?:'s)?\s+epic\s+universe\b/i, "Epic Universe"],
    [/\bepic\s+universe\b/i, "Epic Universe"],
    [/\bspring\b/i, "Spring"],
    [/\bsummer\b/i, "Summer"],
    [/\bfall\b/i, "Fall"],
    [/\bwinter\b/i, "Winter"]
  ];

  return promotions.find(([pattern]) => pattern.test(normalized))?.[1] ?? null;
}

function compactCampaignNameFromHeadline(value: string | null | undefined) {
  const withoutOffer = normalizeText(
    value
      ?.replace(/(?:\bfrom\s+\$[\d,]+|\bsave\s+\d+%|\bsave\s+\$?[\d,]+|\b\d+%\s+off|\$[\d,]+)/gi, "")
      .replace(/^\s*(?:on|for|your)\s+/i, "")
      .replace(/\b(?:vacation\s+package|package|deal|sale|offer|getaway)\b/gi, "")
      .replace(/\s+/g, " ")
  );

  if (!withoutOffer) {
    return null;
  }

  const words = withoutOffer.split(" ").filter(Boolean).slice(0, 3);

  return words.length > 0 ? words.join(" ") : null;
}

function buildPromotionSummary(
  brief: BaseScrapedCreativeBrief,
  context: SuggestionContext,
  packageSummary: string
) {
  const parts = [
    `Promote ${brief.offer} for ${brief.headline}`,
    brief.resortName ? `at ${brief.resortName}` : undefined,
    brief.location ? `in ${brief.location}` : undefined
  ].filter(Boolean);
  const packageDetails = packageSummary ? ` Package highlights: ${packageSummary}.` : "";
  const contextDetails = firstNonEmpty([brief.subheadline, context.resortExcerpt]);

  return `${parts.join(" ")}.${contextDetails ? ` ${contextDetails}` : ""}${packageDetails}`;
}

function suggestTargetAudience(text: string) {
  const normalized = text.toLowerCase();

  if (hasAnyText(normalized, ["universal", "theme park", "tickets", "orlando", "family"])) {
    return "Families and theme-park travelers planning an Orlando vacation";
  }

  if (hasAnyText(normalized, ["romantic", "couples", "anniversary", "honeymoon"])) {
    return "Couples planning a romantic resort getaway";
  }

  if (hasAnyText(normalized, ["luxury", "spa", "premium", "villa"])) {
    return "Luxury-minded travelers and resort vacation planners";
  }

  return "Travelers looking for a resort vacation deal";
}

function suggestTone(text: string) {
  const normalized = text.toLowerCase();

  if (hasAnyText(normalized, ["universal", "theme park", "tickets", "family", "attractions"])) {
    return "energetic, family-fun";
  }

  if (hasAnyText(normalized, ["romantic", "couples", "anniversary", "honeymoon"])) {
    return "relaxed, romantic, premium";
  }

  if (hasAnyText(normalized, ["luxury", "villa", "resort"])) {
    return "relaxed, premium";
  }

  return "upbeat, inviting";
}

function suggestMustIncludeVisuals(
  brief: BaseScrapedCreativeBrief,
  context: SuggestionContext
) {
  const visualElements = [
    brief.location ? `${brief.location} vacation setting` : null,
    brief.resortName ? `${brief.resortName} resort atmosphere` : null,
    ...context.packageIncludes.slice(0, 4),
    context.resortExcerpt ? "spacious resort-style accommodations" : null
  ];

  return uniqueStrings(visualElements.filter((item): item is string => item !== null)).slice(0, 6);
}

function suggestMustAvoidElements(text: string) {
  const avoids = ["competitor resort branding", "unapproved third-party logos", "readable fine print"];

  if (hasAnyText(text.toLowerCase(), ["universal", "theme park", "tickets"])) {
    avoids.push("using third-party park logos as if they are brand assets");
  }

  return avoids;
}

function hasAnyText(text: string, candidates: string[]) {
  return candidates.some((candidate) => text.includes(candidate));
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function removeEmptySuggestionFields(value: Partial<ScrapedCreativeBrief>) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => {
      if (Array.isArray(entry)) {
        return entry.length > 0;
      }

      return typeof entry === "string" ? entry.trim().length > 0 : entry !== undefined;
    })
  ) as Partial<ScrapedCreativeBrief>;
}

function flattenJsonLd(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value.flatMap(flattenJsonLd);
  }

  if (isRecord(value) && Array.isArray(value["@graph"])) {
    return [value, ...value["@graph"].flatMap(flattenJsonLd)];
  }

  return [value];
}

function schemaString(jsonLd: unknown[], key: string) {
  for (const entry of jsonLd) {
    if (!isRecord(entry)) {
      continue;
    }

    const value = entry[key];

    if (typeof value === "string") {
      return value;
    }
  }

  return null;
}

function findLocation(jsonLd: unknown[], text: string | null) {
  for (const entry of jsonLd) {
    if (!isRecord(entry)) {
      continue;
    }

    const address = entry.address;

    if (typeof address === "string") {
      return normalizeText(address);
    }

    if (isRecord(address)) {
      const locality = stringValue(address.addressLocality);
      const region = stringValue(address.addressRegion);
      const country = stringValue(address.addressCountry);
      const joined = [locality, region, country].filter(Boolean).join(", ");

      if (joined) {
        return joined;
      }
    }
  }

  return findLocationInText(text);
}

function findLocationInText(text: string | null) {
  if (!text) {
    return null;
  }

  const match = text.match(/\b(?:in|near)\s+([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)*,\s+[A-Z]{2})\b/);

  return normalizeText(match?.[1]);
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
