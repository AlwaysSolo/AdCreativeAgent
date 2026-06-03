import type { ScrapedCreativeBrief } from "../scraper/landing-page";

export type DestinationInfo = {
  destinationName: string;
  destinationSlug: string;
};

type DestinationInput = Partial<
  Pick<ScrapedCreativeBrief, "resortName" | "headline" | "subheadline" | "location">
>;

const KNOWN_DESTINATIONS = [
  "Orlando",
  "Las Vegas",
  "Branson",
  "Williamsburg",
  "Myrtle Beach",
  "Gatlinburg",
  "Park City",
  "River Ranch",
  "Cocoa Beach",
  "Daytona Beach",
  "Miami",
  "Nashville",
  "New York City"
] as const;

export function inferDestination(
  brief: DestinationInput,
  sourceUrl?: string | null
): DestinationInfo | null {
  const searchableText = [
    brief.location,
    brief.headline,
    brief.subheadline,
    brief.resortName,
    readableUrlText(sourceUrl)
  ]
    .filter((value): value is string => Boolean(value?.trim()))
    .join(" ");
  const knownDestination = KNOWN_DESTINATIONS.find((destination) =>
    destinationMatches(searchableText, destination)
  );
  const destinationName = knownDestination ?? cityFromLocation(brief.location);

  if (!destinationName) {
    return null;
  }

  return {
    destinationName,
    destinationSlug: safeSegment(destinationName)
  };
}

function destinationMatches(text: string, destination: string) {
  if (!text) {
    return false;
  }

  const pattern = destination
    .split(/\s+/)
    .map(escapeRegExp)
    .join("[-\\s_]+");

  return new RegExp(`\\b${pattern}\\b`, "i").test(text);
}

function readableUrlText(sourceUrl: string | null | undefined) {
  if (!sourceUrl) {
    return null;
  }

  try {
    const parsed = new URL(sourceUrl);

    return `${parsed.hostname} ${parsed.pathname.replace(/[-_/]+/g, " ")}`;
  } catch {
    return sourceUrl.replace(/[-_/]+/g, " ");
  }
}

function cityFromLocation(location: string | null | undefined) {
  if (!location) {
    return null;
  }

  const parts = location
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => !/^\d/.test(part))
    .filter((part) => !/^[A-Z]{2,3}$/.test(part));

  return parts[0] ?? null;
}

function safeSegment(value: string) {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);

  return slug || "destination";
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
