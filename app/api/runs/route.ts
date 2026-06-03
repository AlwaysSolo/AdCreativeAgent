import { NextResponse } from "next/server";
import { z } from "zod";

import { createRun } from "../../../src/lib/runs";
import { readProject } from "../../../src/lib/projects";

const scrapedBriefSchema = z.object({
  resortName: z.string().min(1).nullable(),
  headline: z.string().min(1).nullable(),
  subheadline: z.string().min(1).nullable(),
  offer: z.string().min(1).nullable(),
  validDates: z.string().min(1).nullable(),
  ctaText: z.string().min(1).nullable(),
  heroImageUrl: z.string().url().nullable(),
  brandColors: z.array(z.string()),
  location: z.string().min(1).nullable(),
  campaignName: z.string().min(1).optional(),
  promotionSummary: z.string().min(1).optional(),
  targetAudience: z.string().min(1).optional(),
  tone: z.string().min(1).optional(),
  mustIncludeVisualElements: z.array(z.string().min(1)).optional(),
  mustAvoidElements: z.array(z.string().min(1)).optional()
});

const createRunSchema = z.object({
  projectId: z.string().trim().min(1),
  sourceUrl: z.string().url().optional(),
  scrapedBrief: scrapedBriefSchema
});

export async function POST(request: Request) {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = createRunSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid run payload", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const project = await readProject(parsed.data.projectId);

  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const run = await createRun(parsed.data.scrapedBrief, {
    project,
    sourceUrl: parsed.data.sourceUrl
  });

  return NextResponse.json({ runId: run.runId });
}
