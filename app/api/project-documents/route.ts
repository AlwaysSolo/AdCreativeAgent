import { NextResponse } from "next/server";

import { createRun } from "../../../src/lib/runs";
import { readProject } from "../../../src/lib/projects";
import { analyzeProjectDocument } from "../../../src/project-documents/analyzer";

const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;

export async function POST(request: Request) {
  let formData: FormData;

  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid multipart form data" }, { status: 400 });
  }

  const projectId = stringValue(formData.get("projectId"));
  const file = formData.get("file");

  if (!projectId) {
    return NextResponse.json({ error: "Project id is required." }, { status: 400 });
  }

  if (!isUploadedFile(file)) {
    return NextResponse.json({ error: "Project document is required." }, { status: 400 });
  }

  if (!file.name.toLowerCase().endsWith(".docx")) {
    return NextResponse.json({ error: "Upload a .docx project document." }, { status: 400 });
  }

  if (file.size > MAX_DOCUMENT_BYTES) {
    return NextResponse.json({ error: "Project document is too large." }, { status: 413 });
  }

  const project = await readProject(projectId);

  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  try {
    const analysis = await analyzeProjectDocument(Buffer.from(await file.arrayBuffer()), {
      fileName: file.name
    });
    const run = await createRun(analysis.brief, {
      project,
      sourceType: "project_document",
      sourceDocumentName: file.name,
      sourceDocumentMediaCount: analysis.mediaCount
    });

    return NextResponse.json(
      {
        runId: run.runId,
        redirectHref: `/brief?runId=${encodeURIComponent(run.runId)}`,
        brief: analysis.brief,
        mediaCount: analysis.mediaCount
      },
      { status: 201 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to analyze project document.";

    return NextResponse.json({ error: message }, { status: 422 });
  }
}

function stringValue(value: FormDataEntryValue | null) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function isUploadedFile(value: FormDataEntryValue | null): value is File {
  return (
    typeof value === "object" &&
    value !== null &&
    "arrayBuffer" in value &&
    "name" in value &&
    "size" in value
  );
}
