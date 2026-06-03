import { NextResponse } from "next/server";
import { z } from "zod";

import { startGenerationRun } from "../../../src/lib/generation";

const generateRequestSchema = z.object({
  runId: z.string().trim().min(1),
  outputRoot: z.string().trim().min(1).optional()
});

export async function POST(request: Request) {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = generateRequestSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid generate payload", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  try {
    const result = await startGenerationRun(parsed.data.runId, {
      outputRoot: parsed.data.outputRoot
    });

    return NextResponse.json(result, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to start generation.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
