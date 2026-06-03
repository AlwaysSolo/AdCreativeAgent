import type { RunState } from "./runs";
import {
  creativeAdElementSchema,
  type CreativeAdElement
} from "../schemas";

type ElementSource = CreativeAdElement["source"];

export function deriveAdElementsFromRun(run: RunState): CreativeAdElement[] {
  const brief = run.brief;
  const scraped = run.scrapedBrief;
  const textPool = [
    brief?.promotionSummary,
    brief?.subheadline,
    brief?.headline,
    brief?.offer,
    scraped.subheadline,
    scraped.headline,
    scraped.offer
  ];
  const elements: CreativeAdElement[] = [];

  addElement(elements, "destination", "Destination", run.destinationName ?? cityFromLocation(brief?.location ?? scraped.location), "scrape");
  addElement(elements, "promotion", "Promotion / theme", brief?.campaignName ?? promotionFromHeadline(brief?.headline ?? scraped.headline), "brief");
  addElement(elements, "offer", "Offer / price", brief?.offer ?? scraped.offer, "scrape");
  addElement(elements, "stay_length", "Stay length", durationFromText(textPool), "scrape");
  addElement(elements, "cta", "CTA", brief?.ctaText ?? scraped.ctaText ?? "Book Now", "scrape");
  addElement(elements, "headline", "Headline", brief?.headline ?? scraped.headline, "scrape");
  addElement(elements, "audience", "Target audience", brief?.targetAudience, "brief");
  addElement(elements, "tone", "Tone", brief?.tone, "brief");
  addElement(elements, "campaign_summary", "What it is about", brief?.promotionSummary, "brief");
  addElement(
    elements,
    "visual_must_include",
    "Must-include visuals",
    brief?.mustIncludeVisualElements?.join(", "),
    "brief"
  );
  addElement(
    elements,
    "visual_must_avoid",
    "Must-avoid elements",
    brief?.mustAvoidElements?.join(", "),
    "brief"
  );

  return elements;
}

export function selectedAdElementsText(elements: readonly CreativeAdElement[] | undefined) {
  const selected = (elements ?? []).filter((element) => element.selected);

  if (selected.length === 0) {
    return "No ad elements approved yet.";
  }

  return selected
    .map((element) => `- ${element.label}: ${element.value}`)
    .join("\n");
}

function addElement(
  elements: CreativeAdElement[],
  id: string,
  label: string,
  rawValue: string | null | undefined,
  source: ElementSource
) {
  const value = cleanElementValue(rawValue);

  if (!value || elements.some((element) => element.id === id)) {
    return;
  }

  elements.push(
    creativeAdElementSchema.parse({
      id,
      label,
      value,
      source,
      selected: true
    })
  );
}

function cleanElementValue(value: string | null | undefined) {
  return stripBrandNames(value)
    .replace(/\s+/g, " ")
    .replace(/\s+\|.*$/g, "")
    .trim();
}

function stripBrandNames(value: string | null | undefined) {
  return (value ?? "")
    .replace(/\bWestgate Reservations\b/gi, "")
    .replace(/\bWestgate Resorts\b/gi, "")
    .replace(/\bWestgate\b/gi, "")
    .replace(/\s{2,}/g, " ");
}

function cityFromLocation(location: string | null | undefined) {
  return location?.split(",")[0]?.trim();
}

function promotionFromHeadline(headline: string | null | undefined) {
  const cleaned = cleanElementValue(headline);
  const holidayMatch = cleaned.match(
    /\b(4th of July|July 4th|Memorial Day|Christmas|Valentine'?s Day|Spring Break|Halloween|Summer|New Year'?s|Easter|Thanksgiving)\b/i
  );

  return holidayMatch?.[1];
}

function durationFromText(values: readonly (string | null | undefined)[]) {
  const text = values.filter(Boolean).join(" ");
  const dayNightMatch = text.match(/\b(\d+)\s*[- ]?\s*days?\s*\/\s*(\d+)\s*[- ]?\s*nights?\b/i);

  if (dayNightMatch) {
    return `${dayNightMatch[1]} Days / ${dayNightMatch[2]} Nights`;
  }

  const nightMatch = text.match(/\b(\d+)\s*[- ]?\s*nights?\b/i);

  if (nightMatch) {
    return `${nightMatch[1]} Nights`;
  }

  return undefined;
}
