import { NextResponse } from "next/server";
import { z } from "zod";

import { updateRunBrief } from "../../../../../src/lib/runs";
import { creativeBriefSchema } from "../../../../../src/schemas";

const updateBriefSchema = z.object({
  brief: creativeBriefSchema
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

  const parsed = updateBriefSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid brief payload", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  try {
    const run = await updateRunBrief(params.runId, parsed.data.brief);

    return NextResponse.json({ runId: run.runId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to update run.";

    return NextResponse.json({ error: message }, { status: 404 });
  }
}
