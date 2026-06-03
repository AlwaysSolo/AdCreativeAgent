import { NextResponse } from "next/server";
import { z } from "zod";

import {
  channels,
  selectedSizesForChannel,
  type ChannelSize
} from "../../../src/config/channels";
import { callCreativePromptAgent } from "../../../src/generators/creative-prompt-agent";
import { readRun } from "../../../src/lib/runs";
import { channelKeySchema, referenceImageUrlSchema } from "../../../src/schemas";

const promptAgentRequestSchema = z.object({
  runId: z.string().trim().min(1),
  channel: channelKeySchema,
  sizeName: z.string().trim().min(1),
  modelId: z.string().trim().min(1),
  prompt: z.string().trim().min(1),
  negativePrompt: z.string().trim().min(1),
  referenceImageUrls: z.array(referenceImageUrlSchema).optional(),
  mode: z.enum(["discovery", "concepts", "prompt"]).default("prompt"),
  userNotes: z.string().trim().min(1).optional()
});

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => null)) as unknown;
  const parsed = promptAgentRequestSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid prompt-agent payload", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const run = await readRun(parsed.data.runId);

  if (!run?.brief) {
    return NextResponse.json({ error: "Run brief not found." }, { status: 404 });
  }

  const size = findSelectedSize(
    parsed.data.channel,
    parsed.data.sizeName,
    run.selectedChannelSizes
  );

  if (!size) {
    return NextResponse.json({ error: "Selected channel size not found." }, { status: 404 });
  }

  try {
    const result = await callCreativePromptAgent({
      brief: run.brief,
      channel: parsed.data.channel,
      size,
      modelId: parsed.data.modelId,
      basePrompt: parsed.data.prompt,
      negativePrompt: parsed.data.negativePrompt,
      referenceImageUrls: parsed.data.referenceImageUrls,
      mode: parsed.data.mode,
      userNotes: parsed.data.userNotes
    });

    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to generate a creative prompt.";
    const status = message.includes("OPENAI_API_KEY") ? 503 : 502;

    return NextResponse.json({ error: message }, { status });
  }
}

function findSelectedSize(
  channel: keyof typeof channels,
  sizeName: string,
  selectedChannelSizes: Parameters<typeof selectedSizesForChannel>[1]
): ChannelSize | undefined {
  return selectedSizesForChannel(channel, selectedChannelSizes).find(
    (size) => size.name === sizeName
  );
}
