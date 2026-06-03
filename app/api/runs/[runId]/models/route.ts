import { NextResponse } from "next/server";
import { z } from "zod";

import { updateRunModelSelections } from "../../../../../src/lib/runs";
import {
  channelKeySchema,
  imageModelOptionsSchema,
  modelInfoSchema
} from "../../../../../src/schemas";

const modelSelectionStateSchema = z.object({
  imageModelId: z.string().min(1).optional(),
  videoModelId: z.string().min(1).optional(),
  imageModel: modelInfoSchema.optional(),
  videoModel: modelInfoSchema.optional(),
  imageOptions: imageModelOptionsSchema.optional(),
  generateVideo: z.boolean().optional(),
  forceNoTextMode: z.boolean().optional()
});

const updateModelsSchema = z.object({
  dryRun: z.boolean(),
  estimatedCostUsd: z.number().nonnegative().optional(),
  requiresCostConfirm: z.boolean().optional(),
  selections: z.partialRecord(channelKeySchema, modelSelectionStateSchema)
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

  const parsed = updateModelsSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid model payload", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  try {
    const run = await updateRunModelSelections(params.runId, parsed.data);

    return NextResponse.json({
      runId: run.runId,
      dryRun: run.dryRun,
      selections: run.modelSelections
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to update models.";

    return NextResponse.json({ error: message }, { status: 404 });
  }
}
