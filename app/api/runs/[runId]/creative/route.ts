import { NextResponse } from "next/server";
import { z } from "zod";

import {
  selectedSizesForChannel,
  type ChannelKey,
  type ChannelSize
} from "../../../../../src/config/channels";
import { callCreativePromptAgent } from "../../../../../src/generators/creative-prompt-agent";
import { buildPrompt } from "../../../../../src/generators/prompt-builder";
import {
  markCreativeAngleApproved,
  saveCreativeAnglesForRun
} from "../../../../../src/lib/creative-angles";
import { parseCreativeConcepts } from "../../../../../src/lib/creative-concepts";
import { selectedAdElementsText } from "../../../../../src/lib/creative-elements";
import {
  readRun,
  updateRunCreativeAngle,
  updateRunCreativeWorkspace,
  type ModelSelectionState,
  type RunState
} from "../../../../../src/lib/runs";
import {
  creativeAdElementSchema,
  creativeChatMessageSchema,
  referenceImageUrlSchema,
  type CreativeChatMessage,
  type CreativeConcept,
  type CreativeWorkspace,
  type ReviewedPrompt
} from "../../../../../src/schemas";

const creativeActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("elements"),
    referenceImageUrls: z.array(referenceImageUrlSchema).optional(),
    adElements: z.array(creativeAdElementSchema).min(1)
  }),
  z.object({
    action: z.enum(["ask", "message"]),
    referenceImageUrls: z.array(referenceImageUrlSchema).optional(),
    message: z.string().trim().optional()
  }),
  z.object({
    action: z.literal("concepts"),
    referenceImageUrls: z.array(referenceImageUrlSchema).optional()
  }),
  z.object({
    action: z.literal("approve"),
    referenceImageUrls: z.array(referenceImageUrlSchema).optional(),
    conceptId: z.string().trim().min(1)
  })
]);

type RouteContext = {
  params: {
    runId: string;
  };
};

export async function POST(request: Request, { params }: RouteContext) {
  const payload = (await request.json().catch(() => null)) as unknown;
  const parsed = creativeActionSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid creative-agent payload", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const run = await readRun(params.runId);

  if (!run?.brief || !run.selectedChannels?.length || !run.modelSelections) {
    return NextResponse.json(
      { error: "Complete the brief, channels, and model selection first." },
      { status: 409 }
    );
  }

  try {
    const workspace = withReferenceImages(run.creativeWorkspace ?? emptyWorkspace(), parsed.data);
    const runWithWorkspace: RunState = {
      ...run,
      creativeWorkspace: workspace
    };
    const action = parsed.data.action;

    if (action === "elements") {
      const updated = await updateRunCreativeWorkspace(params.runId, {
        ...workspace,
        status: "elements_approved",
        adElements: parsed.data.adElements,
        elementsApproved: true
      });

      return NextResponse.json({ workspace: updated.creativeWorkspace });
    }

    if (action === "approve") {
      const conceptId = "conceptId" in parsed.data ? parsed.data.conceptId : "";
      const concept = (workspace.concepts ?? []).find(
        (candidate) => candidate.id === conceptId
      );

      if (!concept) {
        return NextResponse.json({ error: "Creative concept not found." }, { status: 404 });
      }

      const [angle] = await saveAnglesIfPossible(runWithWorkspace, [concept]);

      if (angle) {
        await markCreativeAngleApproved({
          projectId: angle.projectId,
          destinationSlug: angle.destinationSlug,
          angleId: angle.angleId
        });
        await updateRunCreativeAngle(params.runId, angle);
      }

      const generatedPrompts = await generateApprovedPrompts(runWithWorkspace, concept);
      const updated = await updateRunCreativeWorkspace(params.runId, {
        ...workspace,
        status: "prompts_ready",
        approvedConceptId: concept.id,
        savedCreativeAngleIds: angle
          ? Array.from(new Set([...(workspace.savedCreativeAngleIds ?? []), angle.angleId]))
          : workspace.savedCreativeAngleIds,
        generatedPrompts,
        messages: [
          ...workspace.messages,
          assistantMessage(
            `Approved "${concept.title}". I created ${generatedPrompts.length} prompts for Review.`
          )
        ]
      });

      return NextResponse.json({ workspace: updated.creativeWorkspace });
    }

    const nextMessages =
      action === "message" && parsed.data.message?.trim()
        ? [...workspace.messages, userMessage(parsed.data.message)]
        : workspace.messages;
    const actionText =
      action === "concepts"
        ? await generateConceptText(runWithWorkspace, nextMessages)
        : await generateQuestionText(runWithWorkspace, nextMessages);

    if (action === "concepts") {
      const concepts = parseCreativeConcepts(actionText);
      const angleRecords = await saveAnglesIfPossible(
        {
          ...runWithWorkspace,
          creativeWorkspace: {
            ...workspace,
            concepts
          }
        },
        concepts
      );
      const updated = await updateRunCreativeWorkspace(params.runId, {
        ...workspace,
        status: "concepts_ready",
        messages: [...nextMessages, assistantMessage(actionText)],
        concepts,
        savedCreativeAngleIds: angleRecords.length
          ? angleRecords.map((angle) => angle.angleId)
          : workspace.savedCreativeAngleIds
      });

      return NextResponse.json({ workspace: updated.creativeWorkspace });
    }

    const updated = await updateRunCreativeWorkspace(params.runId, {
      ...workspace,
      status: "questioning",
      messages: [...nextMessages, assistantMessage(actionText)]
    });

    return NextResponse.json({ workspace: updated.creativeWorkspace });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to continue creative direction.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function saveAnglesIfPossible(run: RunState, concepts: readonly CreativeConcept[]) {
  if (!run.projectId || !run.destinationSlug || concepts.length === 0) {
    return [];
  }

  return saveCreativeAnglesForRun(run, concepts);
}

function emptyWorkspace(): CreativeWorkspace {
  return {
    status: "not_started",
    elementsApproved: false,
    referenceImageUrls: [],
    messages: []
  };
}

async function generateQuestionText(run: RunState, messages: readonly CreativeChatMessage[]) {
  const firstJob = firstPromptJob(run);

  if (!firstJob) {
    throw new Error("No selected creative size is ready.");
  }

  const fallback = await buildPrompt({
    brief: run.brief!,
    channel: firstJob.channel,
    size: firstJob.size,
    model: firstJob.selection.imageModel!
  });

  return callAgentTextOrFallback(
    {
      brief: run.brief!,
      channel: firstJob.channel,
      size: firstJob.size,
      modelId: firstJob.selection.imageModel!.id,
      basePrompt: fallback.prompt,
      negativePrompt: fallback.negativePrompt,
      referenceImageUrls: run.creativeWorkspace?.referenceImageUrls,
      mode: "discovery",
      userNotes: approvedElementNotes(run, messages)
    },
    fallbackDiscoveryQuestions(run)
  );
}

async function generateConceptText(run: RunState, messages: readonly CreativeChatMessage[]) {
  const firstJob = firstPromptJob(run);

  if (!firstJob) {
    throw new Error("No selected creative size is ready.");
  }

  const fallback = await buildPrompt({
    brief: run.brief!,
    channel: firstJob.channel,
    size: firstJob.size,
    model: firstJob.selection.imageModel!
  });

  return callAgentTextOrFallback(
    {
      brief: run.brief!,
      channel: firstJob.channel,
      size: firstJob.size,
      modelId: firstJob.selection.imageModel!.id,
      basePrompt: fallback.prompt,
      negativePrompt: fallback.negativePrompt,
      referenceImageUrls: run.creativeWorkspace?.referenceImageUrls,
      mode: "concepts",
      userNotes: [
        approvedElementNotes(run, messages),
        structuredConceptInstructions()
      ].join("\n\n")
    },
    fallbackConceptText(run)
  );
}

async function generateApprovedPrompts(run: RunState, concept: CreativeConcept) {
  const jobs = promptJobs(run);
  const prompts = await Promise.all(
    jobs.map(async (job): Promise<ReviewedPrompt> => {
      const fallback = await buildPrompt({
        brief: run.brief!,
        channel: job.channel,
        size: job.size,
        model: job.selection.imageModel!
      });
      const conceptText = `${concept.title}: ${concept.description}`;
      const approvedElements = selectedAdElementsText(run.creativeWorkspace?.adElements);
      const referenceImageUrls = run.creativeWorkspace?.referenceImageUrls ?? [];
      const prompt = await callAgentTextOrFallback(
        {
          brief: run.brief!,
          channel: job.channel,
          size: job.size,
          modelId: job.selection.imageModel!.id,
          basePrompt: fallback.prompt,
          negativePrompt: fallback.negativePrompt,
          referenceImageUrls,
          mode: "prompt",
          userNotes: [
            "Approved ad elements. Use only these selected elements for offer details, copy, CTA, destination, and campaign facts:",
            approvedElements,
            `Approved creative concept: ${conceptText}.`,
            "Build the final prompt for this exact channel and size. Do not add unapproved promotional taglines, brand names, or logo instructions."
          ].join("\n")
        },
        [
          "Approved ad elements. Use only these selected elements for offer details, copy, CTA, destination, and campaign facts:",
          approvedElements,
          `Approved creative direction: ${conceptText}.`,
          "Do not add unapproved promotional taglines, brand names, or logo instructions.",
          fallback.prompt
        ].join("\n\n")
      );

      return {
        assetId: assetIdFor(job.channel, job.size),
        channel: job.channel,
        sizeName: job.size.name,
        prompt,
        negativePrompt: fallback.negativePrompt,
        referenceImageUrls
      };
    })
  );

  return prompts;
}

async function callAgentTextOrFallback(
  context: Parameters<typeof callCreativePromptAgent>[0],
  fallback: string
) {
  if (!process.env.OPENAI_API_KEY) {
    return fallback;
  }

  try {
    return (await callCreativePromptAgent(context)).text;
  } catch {
    return fallback;
  }
}

function firstPromptJob(run: RunState) {
  return promptJobs(run)[0];
}

function promptJobs(run: RunState) {
  const jobs: Array<{
    channel: ChannelKey;
    size: ChannelSize;
    selection: ModelSelectionState;
  }> = [];

  for (const channel of run.selectedChannels ?? []) {
    const selection = run.modelSelections?.[channel];

    if (!selection?.imageModel) {
      continue;
    }

    for (const size of selectedSizesForChannel(channel, run.selectedChannelSizes)) {
      jobs.push({ channel, size, selection });
    }
  }

  return jobs;
}

function fallbackDiscoveryQuestions(run: RunState) {
  const location = run.brief?.location ?? "this destination";
  const offer = run.brief?.offer ?? "this offer";
  const elements = selectedAdElementsText(run.creativeWorkspace?.adElements);
  const references = referenceNotes(run);

  return [
    `I have the approved ad elements for the ${offer} campaign in ${location}:`,
    elements,
    references,
    "Before I create angles, tell me the property look I should anchor on: architecture, setting, and any reference-image details that matter.",
    "Also tell me whether the creative should lean more family-energy, premium cinematic, romantic, playful, or urgent direct-response."
  ].join("\n")
}

function fallbackConceptText(run: RunState) {
  const theme = run.brief?.campaignName ?? run.brief?.headline ?? "Vacation Offer";
  const location = run.brief?.location?.split(",")[0] ?? "the destination";
  const elements = selectedAdElementsText(run.creativeWorkspace?.adElements);
  const references = referenceNotes(run);

  return JSON.stringify(
    {
      concepts: [
        {
          title: `Offer-First ${theme}`,
          concept:
            "A direct-response ad angle built around the approved offer elements with a clean, unmistakable promotional hierarchy.",
          heroVisual: `A vivid ${location} travel scene with a celebratory seasonal atmosphere, using the reference imagery only for visual direction.`,
          adStructure:
            "Destination-led headline area, oversized price/offer focus, duration support, and a compact holiday badge if those elements are approved.",
          approvedElementsUsed: elements.split("\n").filter(Boolean),
          avoid: [
            "No logo or brand name",
            "No unapproved CTA, audience label, tone phrase, or extra promotional tagline"
          ]
        },
        {
          title: "Vacation Moment Hook",
          concept:
            "A lifestyle-led angle where the destination experience carries the visual attention while the offer remains simple and legible.",
          heroVisual:
            "Poolside or resort-arrival energy with holiday color accents in the sky and lighting, without turning the scene into generic commentary.",
          adStructure:
            "Hero image occupies a smaller visual area with the approved offer elements arranged as a bold promotional system.",
          approvedElementsUsed: elements.split("\n").filter(Boolean),
          avoid: [
            "No extra benefit bullets",
            "No copied page title if it was not approved as an ad element"
          ]
        },
        {
          title: "Editorial Travel Hook",
          concept:
            "A cleaner, premium angle for non-social placements where the destination mood leads and promotional information stays controlled.",
          heroVisual:
            "Cinematic resort atmosphere with enough negative space to adapt across selected formats.",
          adStructure:
            "Use only the approved ad elements, keeping the visual concept independent from any unselected scraped fields.",
          approvedElementsUsed: elements.split("\n").filter(Boolean),
          avoid: [
            "No logo or brand name",
            "No unapproved copy"
          ]
        }
      ],
      references
    },
    null,
    2
  );
}

function userMessage(content: string) {
  return creativeChatMessageSchema.parse({
    role: "user",
    content,
    createdAt: new Date().toISOString()
  });
}

function assistantMessage(content: string) {
  return creativeChatMessageSchema.parse({
    role: "assistant",
    content,
    createdAt: new Date().toISOString()
  });
}

function transcript(messages: readonly CreativeChatMessage[]) {
  return messages.map((message) => `${message.role}: ${message.content}`).join("\n");
}

function approvedElementNotes(run: RunState, messages: readonly CreativeChatMessage[]) {
  return [
    "Approved ad elements. Use only these selected elements for offer details, copy, CTA, destination, and campaign facts:",
    selectedAdElementsText(run.creativeWorkspace?.adElements),
    referenceNotes(run),
    "Conversation:",
    transcript(messages)
  ].join("\n");
}

function withReferenceImages(
  workspace: CreativeWorkspace,
  data: z.infer<typeof creativeActionSchema>
): CreativeWorkspace {
  if (!("referenceImageUrls" in data) || !data.referenceImageUrls) {
    return workspace;
  }

  return {
    ...workspace,
    referenceImageUrls: Array.from(new Set(data.referenceImageUrls))
  };
}

function referenceNotes(run: RunState) {
  const references = run.creativeWorkspace?.referenceImageUrls ?? [];

  if (references.length === 0) {
    return "Creative-agent reference images: none uploaded.";
  }

  return [
    "Creative-agent reference images to study for visual ideas:",
    ...references.map((url) => `- ${url}`)
  ].join("\n");
}

function structuredConceptInstructions() {
  return [
    "Creative angle output contract:",
    "Return ONLY valid JSON. No markdown, no prose before or after.",
    "Shape: { \"concepts\": [{ \"title\": string, \"concept\": string, \"heroVisual\": string, \"adStructure\": string, \"approvedElementsUsed\": string[], \"avoid\": string[] }] }.",
    "Return exactly 2 or 3 complete, independent angle objects.",
    "Each angle must be a concise ad creative direction, not a paragraph of general mood commentary.",
    "Do not let angle 2 or 3 continue the previous angle. Each object must stand alone.",
    "Use only the approved ad elements. Do not include unchecked elements, extra taglines, logo requests, brand names, or copied landing-page titles unless selected."
  ].join("\n");
}

function assetIdFor(channel: ChannelKey, size: ChannelSize) {
  return `${channel}_${safeSegment(size.name)}_${size.w}x${size.h}`;
}

function safeSegment(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}
