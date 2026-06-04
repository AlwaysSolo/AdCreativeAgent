import { readFile } from "node:fs/promises";
import path from "node:path";

import { channels, type ChannelKey, type ChannelSize } from "../config/channels";
import type { CreativeBrief } from "../schemas";

export type CreativePromptAgentMode = "discovery" | "concepts" | "prompt";

export type CreativePromptAgentContext = {
  brief: CreativeBrief;
  channel: ChannelKey;
  size: ChannelSize;
  modelId: string;
  basePrompt: string;
  negativePrompt: string;
  referenceImageUrls?: readonly string[];
  mode?: CreativePromptAgentMode;
  userNotes?: string;
};

export type CreativePromptAgentRequest = {
  model: string;
  instructions: string;
  input: Array<{
    role: "user";
    content: CreativePromptAgentInputContent[];
  }>;
  temperature: number;
};

export type CreativePromptAgentResult = {
  text: string;
  model: string;
};

type CreativePromptAgentInputContent =
  | {
      type: "input_text";
      text: string;
    }
  | {
      type: "input_image";
      image_url: string;
    };

type OpenAiPromptAgentOptions = {
  apiKey?: string;
  model?: string;
  instructionsPath?: string;
  fetch?: FetchLike;
};

type BuildRequestOptions = {
  instructions: string;
  model?: string;
};

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";

export async function readCreativePromptAgentInstructions(
  instructionsPath = defaultInstructionsPath()
) {
  return readFile(instructionsPath, "utf8");
}

export function buildCreativePromptAgentRequest(
  context: CreativePromptAgentContext,
  options: BuildRequestOptions
): CreativePromptAgentRequest {
  const referenceImageUrls = uniqueUrls([
    ...(context.referenceImageUrls ?? []),
    context.brief.heroImageUrl
  ]);
  const content: CreativePromptAgentInputContent[] = [
    {
      type: "input_text",
      text: buildAgentUserContext(context, referenceImageUrls)
    },
    ...referenceImageUrls.map((url) => ({
      type: "input_image" as const,
      image_url: url
    }))
  ];

  return {
    model: options.model ?? defaultOpenAiPromptModel(),
    instructions: [options.instructions, applicationGuardrails()].join("\n\n"),
    input: [
      {
        role: "user",
        content
      }
    ],
    temperature: 0.8
  };
}

export async function callCreativePromptAgent(
  context: CreativePromptAgentContext,
  options: OpenAiPromptAgentOptions = {}
): Promise<CreativePromptAgentResult> {
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error("OpenAI prompt agent is not configured. Set OPENAI_API_KEY in .env.local.");
  }

  const instructions = await readCreativePromptAgentInstructions(options.instructionsPath);
  const request = buildCreativePromptAgentRequest(context, {
    instructions,
    model: options.model ?? process.env.OPENAI_PROMPT_MODEL
  });
  const fetchImplementation = options.fetch ?? fetch;
  const response = await fetchImplementation(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify(request)
  });

  if (!response.ok) {
    const body = await safeReadResponseText(response);
    throw new Error(
      `OpenAI prompt agent failed with HTTP ${response.status}${body ? `: ${body}` : ""}`
    );
  }

  const payload = (await response.json()) as unknown;
  const text = outputTextFromResponse(payload);

  if (!text) {
    throw new Error("OpenAI prompt agent returned no output text.");
  }

  if ((context.mode ?? "prompt") === "prompt" && isFollowUpBlock(text)) {
    throw new Error("OpenAI prompt agent returned a follow-up block during final prompt mode.");
  }

  return {
    text,
    model: request.model
  };
}

function defaultInstructionsPath() {
  return path.join(process.cwd(), "src", "generators", "resort-ad-creative-prompt-agent.md");
}

function defaultOpenAiPromptModel() {
  return "gpt-5.4";
}

function buildAgentUserContext(
  context: CreativePromptAgentContext,
  referenceImageUrls: readonly string[]
) {
  const channel = channels[context.channel];
  const formatKind = channel.allowOnImageText
    ? "ad creative with approved promotional text/graphics"
    : "clean concept photo with no rendered text or graphics";
  const mode = context.mode ?? "prompt";
  const referenceSummary = referenceImageUrls.length
    ? referenceImageUrls.join("\n")
    : "No reference image URL is currently attached.";

  return normalizeLines([
    `Task mode: ${mode}`,
    `Requested output: ${modeInstruction(mode)}`,
    `Channel: ${context.channel}`,
    `Channel rule badge: ${channel.uiBadge}`,
    `Channel allowOnImageText: ${channel.allowOnImageText}`,
    `Target size: ${context.size.name} ${context.size.w}x${context.size.h} (${context.size.aspectLabel})`,
    `Image model selected for final generation: ${context.modelId}`,
    "",
    "Campaign brief:",
    `- Internal property reference: ${redactForbiddenBrandTerms(context.brief.resortName) || "resort property"}`,
    `- Headline/theme: ${redactForbiddenBrandTerms(context.brief.headline)}`,
    `- Offer: ${redactForbiddenBrandTerms(context.brief.offer)}`,
    `- Location: ${redactForbiddenBrandTerms(context.brief.location ?? "unspecified")}`,
    `- Campaign name: ${redactForbiddenBrandTerms(context.brief.campaignName ?? "unspecified")}`,
    `- Promotion summary: ${redactForbiddenBrandTerms(context.brief.promotionSummary ?? "unspecified")}`,
    `- Target audience: ${redactForbiddenBrandTerms(context.brief.targetAudience ?? "unspecified")}`,
    `- Tone: ${redactForbiddenBrandTerms(context.brief.tone ?? "unspecified")}`,
    `- Must include visual elements: ${context.brief.mustIncludeVisualElements.map(redactForbiddenBrandTerms).join(", ") || "none"}`,
    `- Must avoid: ${[
      ...context.brief.mustAvoidElements.map(redactForbiddenBrandTerms),
      context.negativePrompt
    ]
      .filter(Boolean)
      .join(", ")}`,
    "",
    `Format intent: ${formatKind}.`,
    "Reference image URLs:",
    referenceSummary,
    "",
    "Current app-generated fallback prompt for context only:",
    redactForbiddenBrandTerms(context.basePrompt),
    "",
    context.userNotes ? `User notes: ${redactForbiddenBrandTerms(context.userNotes)}` : undefined
  ]);
}

function modeInstruction(mode: CreativePromptAgentMode) {
  if (mode === "discovery") {
    return "Ask only the missing discovery questions needed before concepting.";
  }

  if (mode === "concepts") {
    return [
      "Return only valid JSON for 2-3 complete, independent creative angle objects.",
      "Use this exact shape: { \"concepts\": [{ \"title\": string, \"concept\": string, \"heroVisual\": string, \"adStructure\": string, \"approvedElementsUsed\": string[], \"avoid\": string[] }] }.",
      "Do not write markdown or commentary. Do not let one angle continue into another."
    ].join(" ");
  }

  return [
    "Write the final image-generation prompt using the mandatory section structure.",
    "Do not ask follow-up questions in this mode. Do not return FOLLOW_UP.",
    "If no reference image is attached, continue anyway using the available scrape, project document, approved ad elements, destination, campaign context, and approved creative concept.",
    "When exact property architecture is unknown, describe a believable destination-appropriate resort setting without claiming reference-image fidelity.",
    "Return only the user-ready prompt."
  ].join(" ");
}

function applicationGuardrails() {
  return [
    "Application guardrails that override the markdown instruction file:",
    "- Do not include brand marks, trademarks, company names, resort names, property names, or logos in the generated prompt.",
    "- Do not use the word Westgate or ask the image model to render a Westgate logo/name.",
    "- Property names are internal reference only and must not appear in on-image copy or final prompt text.",
    "- For channels where allowOnImageText is false, do not request any rendered text, typography, lettering, signage, logos, CTA buttons, pricing bursts, or graphic overlays.",
    "- Preserve the channel rule badge and target size intent from the user context."
  ].join("\n");
}

function outputTextFromResponse(payload: unknown) {
  if (isObject(payload) && typeof payload.output_text === "string") {
    return payload.output_text.trim();
  }

  if (!isObject(payload) || !Array.isArray(payload.output)) {
    return "";
  }

  return payload.output
    .flatMap((item) => (isObject(item) && Array.isArray(item.content) ? item.content : []))
    .map((content) =>
      isObject(content) && content.type === "output_text" && typeof content.text === "string"
        ? content.text
        : ""
    )
    .join("\n")
    .trim();
}

function isFollowUpBlock(text: string) {
  return /^\s*FOLLOW[_ -]?UP\s*:/i.test(text);
}

function uniqueUrls(urls: readonly (string | undefined)[]) {
  return Array.from(
    new Set(
      urls
        .map((url) => url?.trim())
        .filter((url): url is string => Boolean(url))
    )
  );
}

async function safeReadResponseText(response: Response) {
  try {
    return (await response.text()).slice(0, 500);
  } catch {
    return "";
  }
}

function normalizeLines(lines: Array<string | undefined>) {
  return lines.filter((line): line is string => line !== undefined).join("\n").trim();
}

function redactForbiddenBrandTerms(value: string) {
  return value
    .replace(/\bWestgate\s+Reservations'?\b/gi, "")
    .replace(/\bWestgate\b/gi, "")
    .replace(/\bReservations\b/gi, "")
    .replace(/\blogos?\b/gi, "brand marks")
    .replace(/\s+([.,;:!?])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
