import { NextResponse } from "next/server";
import { z } from "zod";

import { updateRunReviewPrompts } from "../../../../../src/lib/runs";
import { promptAssignmentSchema, reviewedPromptSchema } from "../../../../../src/schemas";

const updatePromptsSchema = z.object({
  promptAssignments: z.array(promptAssignmentSchema),
  reviewedPrompts: z.array(reviewedPromptSchema).min(1)
});

type RouteContext = {
  params: {
    runId: string;
  };
};

export async function PUT(request: Request, { params }: RouteContext) {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = updatePromptsSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid prompt payload", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  try {
    const run = await updateRunReviewPrompts(params.runId, parsed.data);

    return NextResponse.json({
      runId: run.runId,
      promptAssignments: run.promptAssignments,
      reviewedPrompts: run.reviewedPrompts
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to update prompts.";

    return NextResponse.json({ error: message }, { status: 404 });
  }
}
