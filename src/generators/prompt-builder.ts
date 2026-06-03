import { randomInt } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { channels, type ChannelKey, type ChannelSize } from "../config/channels";
import type { CreativeBrief, ModelInfo } from "../schemas";

export type BuildPromptInput = {
  brief: CreativeBrief;
  channel: ChannelKey;
  size: ChannelSize;
  model: ModelInfo;
  seed?: number;
  brandGuidelinesPath?: string;
};

export type BuiltPrompt = {
  prompt: string;
  negativePrompt: string;
  seed: number;
  aspectRatio: string;
};

const UNIVERSAL_NEGATIVES = [
  "no brand marks",
  "no trademarks",
  "no company names",
  "no resort or property names",
  "no text artifacts"
];

const STRICT_NO_TEXT_NEGATIVES = [
  "no text",
  "no typography",
  "no letters",
  "no words",
  "no brand marks",
  "no watermarks",
  "no captions",
  "no signage with readable text",
  "no readable signage",
  "no UI elements",
  "no graphic overlays"
];

export async function buildPrompt(input: BuildPromptInput): Promise<BuiltPrompt> {
  const channel = channels[input.channel];
  const brandGuidelines = scrubForbiddenPromptTerms(
    await readBrandGuidelines(input.brandGuidelinesPath)
  );
  const brief = sanitizeBriefForPrompt(input.brief);
  const canRenderOnImageText =
    channel.allowOnImageText === true &&
    input.model.capabilities?.supportsOnImageText === true;
  const promptParts = channel.allowOnImageText
    ? [
        directResponseTravelAdPrompt(brief, input.size),
        overlayCompositionGuidance(input.channel, input.size)
      ]
    : [
        creativeDirection(brief, canRenderOnImageText),
        resortContext(brief),
        lifestyleSubject(brief),
        brandGuidance(brandGuidelines, brief, channel.allowOnImageText),
        styleModifiers(input.model, canRenderOnImageText, brief),
        compositionGuidance(input.channel, input.size)
      ];
  const negativePrompt = negativePromptFor(brief, brandGuidelines, channel.allowOnImageText);

  return {
    prompt: scrubForbiddenPromptTerms(compactPrompt(promptParts)),
    negativePrompt: scrubForbiddenPromptTerms(negativePrompt),
    seed: input.seed ?? randomInt(1, 2_147_483_647),
    aspectRatio: selectAspectRatio(input.size, input.model)
  };
}

function creativeDirection(brief: CreativeBrief, canRenderOnImageText: boolean) {
  const direction = [
    `Creative direction: ${brief.offer} paired with "${brief.headline}"`,
    optionalPhrase(brief.promotionSummary, "campaign summary"),
    optionalPhrase(brief.tone, "tone")
  ];

  if (canRenderOnImageText) {
    direction.push(
      `Use structured on-image text only for approved copy: headline "${brief.headline}", offer "${brief.offer}"${brief.ctaText ? `, CTA "${brief.ctaText}"` : ""}.`
    );
  } else {
    direction.push(
      "Treat headline, offer, and CTA as creative direction only; do not render them as readable image text."
    );
  }

  return direction.filter(Boolean).join(". ");
}

function resortContext(brief: CreativeBrief) {
  const location = brief.location ? ` in ${brief.location}` : "";
  const details = [brief.subheadline, brief.validDates].filter(Boolean).join("; ");

  return [
    `Resort context: ${brief.resortName}${location}`,
    details ? `Context details: ${details}` : undefined
  ]
    .filter(Boolean)
    .join(". ");
}

function lifestyleSubject(brief: CreativeBrief) {
  const audience = brief.targetAudience ?? "resort guests";
  const include = brief.mustIncludeVisualElements.length
    ? ` Include ${brief.mustIncludeVisualElements.join(", ")}.`
    : "";

  return `Lifestyle subject: ${audience} enjoying an inviting resort moment.${include}`;
}

function directResponseTravelAdPrompt(brief: CreativeBrief, size: ChannelSize) {
  const price = extractPrice(brief.offer);
  const duration = extractDurationLabel(brief);
  const promoBadge = extractPromoBadge(brief);
  const theme = promoThemeLabel(brief, promoBadge);
  const headline = offerAdHeadline(brief, theme);
  const destination = destinationLabel(brief);
  const priceCopy = price ?? brief.offer;
  const durationCopy = duration ?? "offer details";
  const badgeCopy = promoBadge ?? theme.toUpperCase();

  return [
    `Design a ${formatCreativeFormat(size)} direct-response travel ad promoting ${indefiniteArticle(destination)} ${destination} ${theme} family getaway.`,
    "Use the reference image as needed to create a unique view that is attractive and attention grabbing.",
    "The ad creative should feel fun, family-friendly, active, and vacation-ready, but the final piece must be structured like a promotional offer ad with layered text blocks and strong price hierarchy.",
    "Match the visual language of bold direct-response travel ads: huge central price, and simple bright color contrast.",
    `Make sure the whole creative is ${theme} theme.`,
    "Really Important: the graphic should only occupy 40% of the whole ad creative.",
    `The creative should include only these text elements: Main headline: "${headline}" price: "${priceCopy}" banner under price: "${durationCopy}" Secondary support line. Small promotional badge: "${badgeCopy}".`,
    "Do NOT include promotional tags or filler taglines beyond those exact required elements.",
    "Do NOT include brand marks, trademarks, company names, resort names, or property names."
  ].join(" ");
}

function brandGuidance(
  brandGuidelines: string,
  brief: CreativeBrief,
  allowOnImageText: boolean
) {
  const palette = brief.brandColors.length
    ? `Use brand-informed color palette ${brief.brandColors.join(", ")} in lighting, wardrobe, decor, and environment.`
    : "Use the brand palette as environmental color guidance.";
  const overlayRule = allowOnImageText
    ? "Use brand assets only as anonymous color and layout inspiration; do not render brand marks, trademarks, company names, resort names, or property names."
    : "For this no-text channel, brand color palette informs the scene; do not render brand marks, trademarks, company names, resort names, or property names.";

  return `Brand guidelines: ${brandGuidelines}. ${palette} ${overlayRule}`;
}

function styleModifiers(model: ModelInfo, canRenderOnImageText: boolean, brief: CreativeBrief) {
  const tags = new Set((model.tags ?? []).map((tag) => tag.toLowerCase()));
  const modifiers: string[] = [];

  if (hasAny(tags, ["illustration", "vector"])) {
    modifiers.push("flat illustration, brand palette, editorial style");
  }

  if (hasAny(tags, ["photorealistic", "photoreal", "diffusion", "text-to-image"])) {
    modifiers.push("cinematic, 35mm, golden hour, shallow depth of field");
  }

  if (canRenderOnImageText) {
    modifiers.push(
      `structured on-image text with clean hierarchy, exact spelling, headline "${brief.headline}", offer "${brief.offer}"`
    );
  }

  return modifiers.length
    ? `Style modifiers for ${model.id}: ${modifiers.join("; ")}.`
    : `Style modifiers for ${model.id}: polished resort creative, natural light, premium composition.`;
}

function compositionGuidance(channel: ChannelKey, size: ChannelSize) {
  if (channel === "meta" && size.w === 1920 && size.h === 1080) {
    return "Meta Feed Landscape composition: keep the key subject and any on-image text within the central 60% horizontal band; avoid the outer left and right thirds because mobile feed crops aggressively.";
  }

  if (channel === "meta" && size.aspectLabel === "9:16") {
    return "Meta Stories/Reels composition: vertical, subject centered, safe zones top and bottom.";
  }

  if (channel === "meta") {
    return "Meta composition: social-first framing, clear subject hierarchy, room for channel overlays.";
  }

  if (channel === "google_display") {
    return "Google Display composition: subject in the center 60% of the frame, simple readable hierarchy, resilient crop for compact ad units.";
  }

  if (channel === "website") {
    return "Website composition: clean resort concept photo, strong negative space left or right for HTML overlay, no baked-in copy or brand marks.";
  }

  if (channel === "email_internal") {
    return "Email Internal composition: balanced central composition, near-square framing, consistent hero concept for both required crops.";
  }

  return "SEO composition: editorial, clean, magazine-feature aesthetic with no overlays.";
}

function overlayCompositionGuidance(channel: ChannelKey, size: ChannelSize) {
  if (channel === "meta" && size.w === 1920 && size.h === 1080) {
    return "Keep all important text, the price, and key subject inside the central 60% horizontal band; avoid the outer left and right thirds because mobile feed crops aggressively.";
  }

  if (channel === "meta" && size.aspectLabel === "9:16") {
    return "Use vertical framing with the subject centered and keep text clear of the top and bottom safe zones.";
  }

  if (channel === "google_display") {
    return "Keep the subject and offer hierarchy in the center 60% of the frame so compact display units remain readable.";
  }

  return undefined;
}

function negativePromptFor(
  brief: CreativeBrief,
  brandGuidelines: string,
  allowOnImageText: boolean
) {
  const negatives = new Set<string>(UNIVERSAL_NEGATIVES);

  if (!allowOnImageText) {
    for (const negative of STRICT_NO_TEXT_NEGATIVES) {
      negatives.add(negative);
    }
  }

  for (const avoid of brief.mustAvoidElements) {
    negatives.add(avoid);
  }

  for (const forbidden of extractForbiddenGuidance(brandGuidelines)) {
    negatives.add(forbidden);
  }

  return Array.from(negatives).join(", ");
}

function extractForbiddenGuidance(brandGuidelines: string) {
  return brandGuidelines
    .split(/\r?\n|\.|;/)
    .map((line) => line.trim())
    .filter((line) => /^(forbidden|avoid|must avoid|prohibited)\b/i.test(line))
    .map((line) => line.replace(/^(forbidden|avoid|must avoid|prohibited)\s*:?\s*/i, ""))
    .filter(Boolean);
}

function selectAspectRatio(size: ChannelSize, model: ModelInfo) {
  const targetRatio = size.w / size.h;
  const supported = model.capabilities?.supportedAspects ?? [];

  if (supported.includes(size.aspectLabel)) {
    return size.aspectLabel;
  }

  const parsed = supported
    .map((aspect) => ({ aspect, ratio: parseAspectRatio(aspect) }))
    .filter((entry): entry is { aspect: string; ratio: number } => entry.ratio !== null);

  if (parsed.length === 0) {
    return size.aspectLabel;
  }

  const close = parsed
    .filter((entry) => Math.abs(entry.ratio - targetRatio) <= 0.05)
    .sort((a, b) => Math.abs(a.ratio - targetRatio) - Math.abs(b.ratio - targetRatio))[0];

  if (close) {
    return close.aspect;
  }

  const wider = parsed
    .filter((entry) => entry.ratio >= targetRatio)
    .sort((a, b) => a.ratio - b.ratio)[0];

  if (wider) {
    return wider.aspect;
  }

  return parsed.sort(
    (a, b) => Math.abs(a.ratio - targetRatio) - Math.abs(b.ratio - targetRatio)
  )[0].aspect;
}

function parseAspectRatio(aspect: string) {
  const match = aspect.match(/~?(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)/);

  if (!match) {
    return null;
  }

  return Number(match[1]) / Number(match[2]);
}

async function readBrandGuidelines(brandGuidelinesPath = defaultBrandGuidelinesPath()) {
  try {
    return normalizeText(await readFile(brandGuidelinesPath, "utf8"));
  } catch {
    return "No brand guidelines file found.";
  }
}

function defaultBrandGuidelinesPath() {
  return path.join(process.cwd(), "brand-assets", "brand-guidelines.md");
}

function compactPrompt(parts: Array<string | undefined>) {
  return normalizeText(parts.filter(Boolean).join("\n"));
}

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function sanitizeBriefForPrompt(brief: CreativeBrief): CreativeBrief {
  return {
    ...brief,
    resortName: "resort",
    headline: sanitizePromptField(brief.headline),
    offer: sanitizePromptField(brief.offer),
    subheadline: optionalSanitizedField(brief.subheadline),
    validDates: optionalSanitizedField(brief.validDates),
    ctaText: optionalSanitizedField(brief.ctaText),
    heroImageUrl: brief.heroImageUrl,
    brandColors: brief.brandColors,
    location: optionalSanitizedField(brief.location),
    campaignName: optionalSanitizedField(brief.campaignName),
    promotionSummary: optionalSanitizedField(brief.promotionSummary),
    targetAudience: optionalSanitizedField(brief.targetAudience),
    tone: optionalSanitizedField(brief.tone),
    mustIncludeVisualElements: brief.mustIncludeVisualElements
      .filter((item) => !/\bwestgate\b/i.test(item))
      .map(sanitizePromptField)
      .filter(Boolean),
    mustAvoidElements: brief.mustAvoidElements
      .map((item) =>
        scrubForbiddenPromptTerms(item).replace(/\bcompetitor brand marks\b/gi, "competitor branding")
      )
      .filter(Boolean)
  };
}

function optionalSanitizedField(value: string | undefined) {
  return value ? sanitizePromptField(value) : undefined;
}

function sanitizePromptField(value: string) {
  return scrubForbiddenPromptTerms(value.replace(/\s*\|.*$/g, ""));
}

function scrubForbiddenPromptTerms(value: string) {
  return value
    .replace(/\bWestgate\s+Reservations'?\b/gi, "")
    .replace(/\bWestgate\b/gi, "")
    .replace(/\bReservations\b/gi, "")
    .replace(/\blogos?\b/gi, "brand marks")
    .replace(/\s+([.,;:!?])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function optionalPhrase(value: string | undefined, label: string) {
  return value ? `${label}: ${value}` : undefined;
}

function hasAny(tags: Set<string>, candidates: string[]) {
  return candidates.some((candidate) => tags.has(candidate));
}

function extractPrice(offer: string) {
  return offer.match(/\$\s?\d[\d,]*(?:\.\d{2})?/)?.[0].replace(/\s+/g, "") ?? null;
}

function extractDurationLabel(brief: CreativeBrief) {
  const text = searchableBriefText(brief);
  const slashMatch = text.match(/\b\d+\s*(?:day|days)\s*\/\s*(\d+)\s*(?:night|nights)\b/i);

  if (slashMatch) {
    return `${slashMatch[1]} NIGHTS`;
  }

  const nightMatch = text.match(/\b(\d+)\s*[- ]?(?:night|nights)\b/i);

  if (nightMatch) {
    return `${nightMatch[1]} NIGHTS`;
  }

  const wordNightMatch = text.match(
    /\b(one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:night|nights)\b/i
  );

  if (wordNightMatch) {
    return `${wordNumberToDigit(wordNightMatch[1])} NIGHTS`;
  }

  return null;
}

function extractPromoBadge(brief: CreativeBrief) {
  const text = searchableBriefText(brief);
  const promoPatterns: Array<[RegExp, string]> = [
    [/\bmemorial\s+day\b/i, "MEMORIAL DAY"],
    [/\b(?:4th|fourth)\s+of\s+july\b/i, "4TH OF JULY"],
    [/\bjuly\s+4(?:th)?\b/i, "4TH OF JULY"],
    [/\bindependence\s+day\b/i, "INDEPENDENCE DAY"],
    [/\blabor\s+day\b/i, "LABOR DAY"],
    [/\bthanksgiving\b/i, "THANKSGIVING"],
    [/\bblack\s+friday\b/i, "BLACK FRIDAY"],
    [/\bcyber\s+monday\b/i, "CYBER MONDAY"],
    [/\bchristmas\b/i, "CHRISTMAS"],
    [/\bnew\s+year(?:'s)?\b/i, "NEW YEAR"],
    [/\bspring\b/i, "SPRING"],
    [/\bsummer\b/i, "SUMMER"],
    [/\bfall\b/i, "FALL"],
    [/\bwinter\b/i, "WINTER"]
  ];

  return promoPatterns.find(([pattern]) => pattern.test(text))?.[1] ?? null;
}

function offerAdHeadline(brief: CreativeBrief, theme: string) {
  const candidate = brief.campaignName ?? brief.headline;
  const normalized = candidate.replace(/\s+/g, " ").trim();

  if (/\bfamily\s+getaway\b/i.test(normalized)) {
    return normalized;
  }

  if (theme) {
    return `${theme} Family Getaway`;
  }

  return normalized;
}

function promoThemeLabel(brief: CreativeBrief, promoBadge: string | null) {
  if (promoBadge === "4TH OF JULY") {
    return "July 4th";
  }

  if (promoBadge === "INDEPENDENCE DAY") {
    return "Independence Day";
  }

  if (promoBadge) {
    return titleCase(promoBadge);
  }

  return titleCase((brief.campaignName ?? brief.headline).replace(/\|.*$/, "").trim());
}

function destinationLabel(brief: CreativeBrief) {
  const location = brief.location?.split(",")[0]?.trim();

  if (location) {
    return location;
  }

  const headlineLocation = brief.headline.match(/\b([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)?)\s+(?:4th|Memorial|Labor|Spring|Summer|Fall|Winter)\b/)?.[1];

  return headlineLocation ?? "resort";
}

function formatCreativeFormat(size: ChannelSize) {
  if (size.w === size.h) {
    return "square";
  }

  if (size.aspectLabel === "9:16" || size.h > size.w) {
    return "vertical";
  }

  if (size.w > size.h) {
    return "landscape";
  }

  return `${size.w}x${size.h}`;
}

function indefiniteArticle(value: string) {
  return /^[aeiou]/i.test(value) ? "an" : "a";
}

function titleCase(value: string) {
  return value
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) =>
      word.length <= 3 && /\d/.test(word)
        ? word.toUpperCase()
        : `${word.charAt(0).toUpperCase()}${word.slice(1)}`
    )
    .join(" ");
}

function searchableBriefText(brief: CreativeBrief) {
  return [
    brief.resortName,
    brief.headline,
    brief.offer,
    brief.subheadline,
    brief.validDates,
    brief.ctaText,
    brief.location,
    brief.campaignName,
    brief.promotionSummary,
    brief.targetAudience,
    brief.tone,
    ...brief.mustIncludeVisualElements
  ]
    .filter(Boolean)
    .join(" ");
}

function wordNumberToDigit(value: string) {
  const lookup: Record<string, number> = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10
  };

  return lookup[value.toLowerCase()] ?? value;
}
