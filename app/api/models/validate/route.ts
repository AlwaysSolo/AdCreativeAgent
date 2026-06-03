import { NextResponse } from "next/server";
import { z } from "zod";

import { createManualModelInfo } from "../../../../src/models/catalog";

const validateManualModelSchema = z.object({
  modelId: z.string().min(1),
  kind: z.enum(["image", "video"]),
  dryRun: z.literal(true).default(true)
});

export async function POST(request: Request) {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = validateManualModelSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid model validation payload", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  try {
    const model = createManualModelInfo(parsed.data.modelId, parsed.data.kind);

    return NextResponse.json({
      model,
      dryRun: true
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid model id.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
