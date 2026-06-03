import { NextResponse } from "next/server";
import { z } from "zod";

import { createProject, listProjects } from "../../../src/lib/projects";

const createProjectSchema = z.object({
  name: z.string().trim().min(1)
});

export async function GET() {
  const projects = await listProjects();

  return NextResponse.json({ projects });
}

export async function POST(request: Request) {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = createProjectSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid project payload", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const project = await createProject(parsed.data.name);

  return NextResponse.json({ project }, { status: 201 });
}
