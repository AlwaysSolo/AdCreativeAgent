import { NextResponse } from "next/server";
import { z } from "zod";

import { updateRunChannels } from "../../../../../src/lib/runs";
import { channelKeySchema } from "../../../../../src/schemas";

const updateChannelsSchema = z.object({
  selectedChannels: z.array(channelKeySchema).min(1),
  selectedChannelSizes: z
    .partialRecord(channelKeySchema, z.array(z.string().trim().min(1)).min(1))
    .optional()
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

  const parsed = updateChannelsSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid channel payload", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  try {
    const run = await updateRunChannels(
      params.runId,
      parsed.data.selectedChannels,
      parsed.data.selectedChannelSizes
    );

    return NextResponse.json({
      runId: run.runId,
      selectedChannels: run.selectedChannels,
      selectedChannelSizes: run.selectedChannelSizes
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to update channels.";

    return NextResponse.json({ error: message }, { status: 404 });
  }
}
