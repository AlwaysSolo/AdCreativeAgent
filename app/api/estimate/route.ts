import { NextResponse } from "next/server";
import { z } from "zod";

import { computeCostEstimate } from "../../../src/lib/estimate";
import { channelKeySchema, creativeBriefSchema, modelInfoSchema } from "../../../src/schemas";

const estimateModelSelectionSchema = z.object({
  imageModel: modelInfoSchema.optional(),
  videoModel: modelInfoSchema.optional(),
  generateVideo: z.boolean().optional()
});

const estimateRequestSchema = z.object({
  brief: creativeBriefSchema,
  channels: z.array(channelKeySchema).min(1),
  selectedChannelSizes: z
    .partialRecord(channelKeySchema, z.array(z.string().trim().min(1)).min(1))
    .optional(),
  models: z.partialRecord(channelKeySchema, estimateModelSelectionSchema)
});

export async function POST(request: Request) {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = estimateRequestSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid estimate payload", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  return NextResponse.json(computeCostEstimate(parsed.data));
}
