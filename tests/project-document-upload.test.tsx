import { rm } from "node:fs/promises";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { vi } from "vitest";

import { POST as uploadProjectDocumentPost } from "../app/api/project-documents/route";
import ProjectPage from "../app/projects/[projectId]/page";
import { ProjectDocumentUploadForm } from "../components/ProjectDocumentUploadForm";
import { createProject, getProjectPath } from "../src/lib/projects";
import { getRunPath, readRun } from "../src/lib/runs";
import { createDocxFixtureBuffer } from "./utils/docx-fixture";

describe("project document upload", () => {
  it("creates a project run from an uploaded DOCX and pre-fills the brief", async () => {
    const project = await createProject("AquaGlow Project");
    let runId: string | null = null;

    try {
      const formData = new FormData();
      formData.set("projectId", project.projectId);
      const documentBytes = await createDocxFixtureBuffer();
      formData.set(
        "file",
        new File([arrayBufferFromBuffer(documentBytes)], "AquaGlow Campaign.docx", {
          type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        })
      );

      const response = await uploadProjectDocumentPost({
        formData: async () => formData
      } as Request);
      const payload = (await response.json()) as {
        runId: string;
        redirectHref: string;
      };
      runId = payload.runId;
      const run = await readRun(runId);

      expect(response.status).toBe(201);
      expect(payload.redirectHref).toBe(`/brief?runId=${runId}`);
      expect(run).toMatchObject({
        projectId: project.projectId,
        sourceType: "project_document",
        sourceDocumentName: "AquaGlow Campaign.docx",
        destinationName: "Orlando",
        scrapedBrief: {
          campaignName: "AquaGlow",
          offer: "3 Nights + 4 AquaGlow tickets for $199",
          targetAudience: expect.stringContaining("Parents")
        }
      });
    } finally {
      await rm(getProjectPath(project.projectId), { force: true });
      if (runId) {
        await rm(getRunPath(runId), { force: true });
      }
    }
  });

  it("renders document upload beside the landing page scrape on the project page", async () => {
    const project = await createProject("Document Intake Project");

    try {
      render(await ProjectPage({ params: { projectId: project.projectId } }));

      expect(screen.getByLabelText("Landing page URL")).toBeInTheDocument();
      expect(screen.getByLabelText("Project document")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Analyze project document" }))
        .toBeInTheDocument();
    } finally {
      await rm(getProjectPath(project.projectId), { force: true });
    }
  });

  it("submits the uploaded project document and redirects to Step 2", async () => {
    const assignSpy = vi.fn();
    const fetchSpy = vi.fn(async () =>
      new Response(
        JSON.stringify({
          runId: "01HX0000000000000000000000",
          redirectHref: "/brief?runId=01HX0000000000000000000000"
        }),
        {
          status: 201,
          headers: { "content-type": "application/json" }
        }
      )
    );
    vi.stubGlobal("fetch", fetchSpy);
    Object.defineProperty(window, "location", {
      value: { assign: assignSpy },
      writable: true
    });

    try {
      render(<ProjectDocumentUploadForm projectId="01HXPROJECT0000000000000" />);
      const documentBytes = await createDocxFixtureBuffer();
      fireEvent.change(screen.getByLabelText("Project document"), {
        target: {
          files: [
            new File([arrayBufferFromBuffer(documentBytes)], "AquaGlow Campaign.docx", {
              type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            })
          ]
        }
      });
      fireEvent.click(screen.getByRole("button", { name: "Analyze project document" }));

      await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledWith("/api/project-documents", {
          method: "POST",
          body: expect.any(FormData)
        });
        expect(assignSpy).toHaveBeenCalledWith(
          "/brief?runId=01HX0000000000000000000000"
        );
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

function arrayBufferFromBuffer(buffer: Buffer): ArrayBuffer {
  const copy = new Uint8Array(buffer.byteLength);

  copy.set(buffer);

  return copy.buffer;
}
