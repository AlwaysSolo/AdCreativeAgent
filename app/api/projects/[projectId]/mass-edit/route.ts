import { NextResponse } from "next/server";
import { z } from "zod";

import { startMassEditRun } from "../../../../../src/lib/mass-edit";
import { massEditBatchSchema } from "../../../../../src/schemas";

type RouteContext = {
  params: {
    projectId: string;
  };
};

const massEditRequestBodySchema = z.object({
  dryRun: z.boolean().default(true),
  outputRoot: z.string().trim().min(1).optional(),
  batches: z.array(massEditBatchSchema).min(1)
});

export async function POST(request: Request, { params }: RouteContext) {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = massEditRequestBodySchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid mass-edit payload", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  try {
    const result = await startMassEditRun(
      {
        projectId: params.projectId,
        dryRun: parsed.data.dryRun,
        batches: parsed.data.batches
      },
      {
        outputRoot: parsed.data.outputRoot
      }
    );

    return NextResponse.json(result, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to start mass edit.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
