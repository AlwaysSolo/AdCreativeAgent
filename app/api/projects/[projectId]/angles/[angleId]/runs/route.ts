import { NextResponse } from "next/server";
import { z } from "zod";

import { createRunFromCreativeAngle } from "../../../../../../../src/lib/creative-angles";

const createAngleRunSchema = z.object({
  destinationSlug: z.string().trim().min(1)
});

type RouteContext = {
  params: {
    projectId: string;
    angleId: string;
  };
};

export async function POST(request: Request, { params }: RouteContext) {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = createAngleRunSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid creative angle run payload", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  try {
    const run = await createRunFromCreativeAngle({
      projectId: params.projectId,
      destinationSlug: parsed.data.destinationSlug,
      angleId: params.angleId
    });

    return NextResponse.json(
      {
        runId: run.runId,
        redirectHref: `/channels?runId=${encodeURIComponent(run.runId)}`
      },
      { status: 201 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create angle run.";

    return NextResponse.json({ error: message }, { status: 404 });
  }
}
