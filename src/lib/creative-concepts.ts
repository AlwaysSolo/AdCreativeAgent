import {
  creativeConceptSchema,
  type CreativeConcept
} from "../schemas";

type RawConcept = {
  title?: unknown;
  concept?: unknown;
  description?: unknown;
  heroVisual?: unknown;
  adStructure?: unknown;
  approvedElementsUsed?: unknown;
  avoid?: unknown;
};

export function parseCreativeConcepts(text: string): CreativeConcept[] {
  const parsed = parseJsonConcepts(text);

  if (parsed.length > 0) {
    return parsed;
  }

  return [
    creativeConceptSchema.parse({
      id: "concept-1",
      title: "Creative Agent Concept",
      description: text.trim()
    })
  ];
}

function parseJsonConcepts(text: string) {
  const payload = safeJsonParse(extractJson(text));

  if (!payload) {
    return [];
  }

  const rawConcepts = Array.isArray(payload)
    ? payload
    : isObject(payload) && Array.isArray(payload.concepts)
      ? payload.concepts
      : [];

  return rawConcepts
    .map((raw, index) => normalizeConcept(raw, index))
    .filter((concept): concept is CreativeConcept => concept !== null)
    .slice(0, 3);
}

function normalizeConcept(raw: unknown, index: number) {
  if (!isObject(raw)) {
    return null;
  }

  const concept = raw as RawConcept;
  const title = stringValue(concept.title);
  const description = stringValue(concept.concept) ?? stringValue(concept.description);
  const heroVisual = stringValue(concept.heroVisual);
  const adStructure = stringValue(concept.adStructure);

  if (!title || !description || !heroVisual || !adStructure) {
    return null;
  }

  return creativeConceptSchema.parse({
    id: `concept-${index + 1}`,
    title,
    description,
    heroVisual,
    adStructure,
    approvedElementsUsed: stringArray(concept.approvedElementsUsed),
    avoid: stringArray(concept.avoid)
  });
}

function extractJson(text: string) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);

  if (fenced?.[1]) {
    return fenced[1].trim();
  }

  return trimmed;
}

function safeJsonParse(text: string) {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const values = value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);

  return values.length > 0 ? values : undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
