import { NextResponse } from "next/server";
import { z } from "zod";

import { rerollAsset } from "../../../src/lib/results";

const rerollRequestSchema = z.object({
  runId: z.string().trim().min(1),
  assetId: z.string().trim().min(1),
  modelId: z.string().trim().min(1).optional(),
  prompt: z.string().trim().min(1).optional(),
  negativePrompt: z.string().optional(),
  referenceImageUrls: z.array(z.string().url()).optional()
});

export async function POST(request: Request) {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = rerollRequestSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid reroll payload", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  try {
    const asset = await rerollAsset(parsed.data);

    return NextResponse.json({ asset });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to re-roll asset.";

    return NextResponse.json({ error: message }, { status: 404 });
  }
}
