import { inflateRawSync } from "node:zlib";

import type { ScrapedCreativeBrief } from "../scraper/landing-page";

export type ProjectDocumentAnalysis = {
  fileName: string;
  text: string;
  mediaCount: number;
  mediaFiles: string[];
  brief: ScrapedCreativeBrief;
};

type AnalyzeProjectDocumentOptions = {
  fileName: string;
};

const WESTGATE_BRAND_COLORS = ["#0e2545", "#c4a55d", "#d95d31", "#3892dc", "#148dd0"];
const MONTH =
  "Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?";
const DATE_RANGE_REGEX = new RegExp(
  `\\b((?:${MONTH})\\s+\\d{1,2}(?:,\\s*\\d{4})?\\s*(?:-|–|—|to|through)\\s*(?:${MONTH})(?:\\s+\\d{1,2})?(?:,\\s*\\d{4})?)\\b`,
  "i"
);
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
];

export async function analyzeProjectDocument(
  input: Buffer | ArrayBuffer | Uint8Array,
  options: AnalyzeProjectDocumentOptions
): Promise<ProjectDocumentAnalysis> {
  const bytes = Buffer.isBuffer(input)
    ? input
    : input instanceof Uint8Array
      ? Buffer.from(input)
      : Buffer.from(input);
  const entries = readZipEntries(bytes);
  const documentXml = entries.get("word/document.xml");

  if (!documentXml) {
    throw new Error("Uploaded file is not a readable Word document.");
  }

  const paragraphs = paragraphsFromDocumentXml(documentXml.toString("utf8"));
  const text = normalizeText(paragraphs.join("\n")) ?? "";
  const mediaFiles = [...entries.keys()].filter((name) => name.startsWith("word/media/"));
  const brief = buildBriefFromText({
    text,
    paragraphs,
    fileName: options.fileName
  });

  return {
    fileName: options.fileName,
    text,
    mediaCount: mediaFiles.length,
    mediaFiles,
    brief
  };
}

function buildBriefFromText({
  text,
  paragraphs,
  fileName
}: {
  text: string;
  paragraphs: string[];
  fileName: string;
}): ScrapedCreativeBrief {
  const projectTitle = firstNonEmpty([
    fieldValue(text, "Project Title"),
    titleFromFileName(fileName)
  ]);
  const campaignName = suggestCampaignName(projectTitle);
  const location = findDestination(text);
  const offer = suggestOffer(text);
  const projectDescription = fieldValue(text, "Project Description");
  const visualConcept = fieldValue(text, "Visual Concept");
  const launchDate = fieldValue(text, "Target Launch Date");
  const channels = fieldValue(text, "Marketing Channels");
  const resortName = suggestResortName(text, location);
  const targetAudience = targetAudienceBlock(paragraphs);

  return {
    resortName,
    headline: firstNonEmpty([
      campaignName && location ? `${campaignName} ${location} Vacation Package` : null,
      projectTitle
    ]),
    subheadline: firstNonEmpty([offer, projectDescription]),
    offer,
    validDates: firstNonEmpty([findValidDates(text), launchDate]),
    ctaText: null,
    heroImageUrl: null,
    brandColors: [...WESTGATE_BRAND_COLORS],
    location,
    campaignName: campaignName ?? undefined,
    promotionSummary: buildPromotionSummary({
      projectDescription,
      visualConcept,
      channels,
      offer
    }),
    targetAudience: targetAudience ?? undefined,
    tone: suggestTone(text),
    mustIncludeVisualElements: suggestMustIncludeVisuals(text, offer),
    mustAvoidElements: suggestMustAvoidElements(text)
  };
}

function fieldValue(text: string, label: string) {
  const escaped = escapeRegExp(label);
  const pattern = new RegExp(
    `(?:^|\\n)\\s*${escaped}\\*?\\s*:\\s*([^\\n]+(?:\\n(?!\\s*[A-Z][A-Za-z /()&-]{1,45}\\*?\\s*:)[^\\n]+)*)`,
    "i"
  );
  const match = text.match(pattern);

  return normalizeText(match?.[1]);
}

function titleFromFileName(fileName: string) {
  return normalizeText(fileName.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " "));
}

function suggestCampaignName(projectTitle: string | null) {
  return normalizeText(
    projectTitle
      ?.replace(/\bcampaign\b/gi, "")
      .replace(/\bproject\b/gi, "")
      .replace(/\s+/g, " ")
  );
}

function suggestOffer(text: string) {
  const price = text.match(/\$\d[\d,]*/)?.[0] ?? null;

  if (!price) {
    return null;
  }

  const ticketCount = text.match(/\b(\d+)\s+(?:AquaGlow\s+)?tickets?\b/i)?.[1] ?? null;
  const hasAquaGlow = /\baquaglow\b/i.test(text);
  const stayLength = stayLengthFromText(text);

  if (stayLength && ticketCount) {
    return `${stayLength} + ${ticketCount}${hasAquaGlow ? " AquaGlow" : ""} tickets for ${price}`;
  }

  const lineWithPrice = text
    .split(/\n/)
    .map((line) => line.trim())
    .find((line) => line.includes(price));

  return normalizeText(lineWithPrice);
}

function stayLengthFromText(text: string) {
  if (/\b4\s*\/\s*3\b/.test(text) || /\b4\s*days?\s*\/\s*3\s*nights?\b/i.test(text)) {
    return "3 Nights";
  }

  const nights = text.match(/\b(\d+)\s*nights?\b/i)?.[1];

  return nights ? `${nights} Nights` : null;
}

function findValidDates(text: string) {
  return normalizeText(text.match(DATE_RANGE_REGEX)?.[1]);
}

function findDestination(text: string) {
  return KNOWN_DESTINATIONS.find((destination) =>
    new RegExp(`\\b${escapeRegExp(destination)}\\b`, "i").test(text)
  ) ?? null;
}

function suggestResortName(text: string, location: string | null) {
  const logoLine = text.match(/\bLogos?\s*:\s*([^\n]+)/i)?.[1];
  const westgateLogoName = logoLine
    ?.split(/\s+and\s+|,/i)
    .map((item) => item.trim())
    .find((item) => /^Westgate\b/i.test(item));

  return firstNonEmpty([
    westgateLogoName ?? null,
    location ? `Westgate Resorts ${location}` : null
  ]);
}

function targetAudienceBlock(paragraphs: string[]) {
  const start = paragraphs.findIndex((paragraph) => /^Target Audience\s*:?\s*$/i.test(paragraph));

  if (start === -1) {
    return fieldValue(paragraphs.join("\n"), "Target Audience");
  }

  const block: string[] = [];

  for (const paragraph of paragraphs.slice(start + 1)) {
    if (/^(Does this project|DELIVERABLES|BRAND|Social Ads|Website measure|Visual Concept)\b/i.test(paragraph)) {
      break;
    }

    block.push(paragraph);
  }

  return normalizeText(block.join(" "));
}

function buildPromotionSummary({
  projectDescription,
  visualConcept,
  channels,
  offer
}: {
  projectDescription: string | null;
  visualConcept: string | null;
  channels: string | null;
  offer: string | null;
}) {
  return firstNonEmpty([
    [
      projectDescription,
      visualConcept ? `Visual concept: ${visualConcept}` : null,
      channels ? `Requested channels: ${channels}.` : null
    ]
      .filter(Boolean)
      .join(" "),
    offer ? `Promote ${offer}.` : null
  ]) ?? undefined;
}

function suggestTone(text: string) {
  const normalized = text.toLowerCase();
  const values = [
    normalized.includes("fun") ? "fun" : null,
    normalized.includes("famil") ? "family-friendly" : null,
    normalized.includes("event") || normalized.includes("water park") ? "energetic" : null,
    normalized.includes("neon") || normalized.includes("glow") ? "neon" : null
  ].filter((value): value is string => value !== null);

  return values.length > 0 ? Array.from(new Set(values)).join(", ") : "upbeat, inviting";
}

function suggestMustIncludeVisuals(text: string, offer: string | null) {
  const normalized = text.toLowerCase();
  const values = [
    normalized.includes("neon") || normalized.includes("glow") ? "AquaGlow neon lights" : null,
    normalized.includes("famil") ? "families enjoying the event" : null,
    normalized.includes("resort by day") || normalized.includes("relaxation of the resort")
      ? "resort relaxation by day and AquaGlow excitement by night"
      : null,
    offer ? `clear offer badge: ${offer}` : null,
    normalized.includes("aquatica") ? "Aquatica night-event atmosphere" : null
  ];

  return uniqueStrings(values.filter((value): value is string => value !== null));
}

function suggestMustAvoidElements(text: string) {
  const normalized = text.toLowerCase();
  const values = [
    normalized.includes("website measure") && normalized.includes("no text")
      ? "text or logos on Website concept-photo assets"
      : null,
    normalized.includes("email internal") && normalized.includes("no westgate logo")
      ? "Westgate logo on Email Internal assets"
      : null,
    normalized.includes("avoid interfering with meta")
      ? "placing important text in Meta bottom safe-area margins"
      : null,
    "unapproved third-party logos"
  ];

  return uniqueStrings(values.filter((value): value is string => value !== null));
}

function paragraphsFromDocumentXml(xml: string) {
  const paragraphMatches = xml.match(/<w:p\b[\s\S]*?<\/w:p>/g) ?? [];

  return paragraphMatches
    .map((paragraphXml) =>
      normalizeText(
        paragraphXml
          .replace(/<w:tab\b[^>]*\/>/g, "\t")
          .replace(/<w:br\b[^>]*\/>/g, "\n")
          .replace(/<w:cr\b[^>]*\/>/g, "\n")
          .match(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)
          ?.map((textNode) =>
            decodeXmlEntities(textNode.replace(/^<w:t\b[^>]*>/, "").replace(/<\/w:t>$/, ""))
          )
          .join("") ?? ""
      )
    )
    .filter((paragraph): paragraph is string => paragraph !== null);
}

function readZipEntries(bytes: Buffer) {
  const entries = new Map<string, Buffer>();
  const eocdOffset = findEndOfCentralDirectory(bytes);

  if (eocdOffset === -1) {
    throw new Error("Uploaded file is not a valid DOCX package.");
  }

  const totalEntries = bytes.readUInt16LE(eocdOffset + 10);
  let centralOffset = bytes.readUInt32LE(eocdOffset + 16);

  for (let index = 0; index < totalEntries; index += 1) {
    if (bytes.readUInt32LE(centralOffset) !== 0x02014b50) {
      throw new Error("Uploaded DOCX package has an invalid central directory.");
    }

    const compressionMethod = bytes.readUInt16LE(centralOffset + 10);
    const compressedSize = bytes.readUInt32LE(centralOffset + 20);
    const fileNameLength = bytes.readUInt16LE(centralOffset + 28);
    const extraLength = bytes.readUInt16LE(centralOffset + 30);
    const commentLength = bytes.readUInt16LE(centralOffset + 32);
    const localHeaderOffset = bytes.readUInt32LE(centralOffset + 42);
    const fileName = bytes
      .subarray(centralOffset + 46, centralOffset + 46 + fileNameLength)
      .toString("utf8");
    const localFileNameLength = bytes.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = bytes.readUInt16LE(localHeaderOffset + 28);
    const compressedStart = localHeaderOffset + 30 + localFileNameLength + localExtraLength;
    const compressed = bytes.subarray(compressedStart, compressedStart + compressedSize);

    if (bytes.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
      throw new Error("Uploaded DOCX package has an invalid local header.");
    }

    entries.set(fileName, decompressZipEntry(compressed, compressionMethod));
    centralOffset += 46 + fileNameLength + extraLength + commentLength;
  }

  return entries;
}

function findEndOfCentralDirectory(bytes: Buffer) {
  for (let index = bytes.length - 22; index >= 0; index -= 1) {
    if (bytes.readUInt32LE(index) === 0x06054b50) {
      return index;
    }
  }

  return -1;
}

function decompressZipEntry(bytes: Buffer, method: number) {
  if (method === 0) {
    return Buffer.from(bytes);
  }

  if (method === 8) {
    return inflateRawSync(bytes);
  }

  throw new Error(`Unsupported DOCX compression method: ${method}`);
}

function firstNonEmpty(values: Array<string | null | undefined>) {
  return values.find((value): value is string => Boolean(value?.trim())) ?? null;
}

function normalizeText(value: string | null | undefined) {
  const normalized = value?.replace(/\r/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();

  return normalized && normalized.length > 0 ? normalized : null;
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function decodeXmlEntities(value: string) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
