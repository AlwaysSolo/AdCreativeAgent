import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import sharp from "sharp";
import { vi } from "vitest";

import { MassEditWorkspace } from "../components/MassEditWorkspace";
import { POST as massEditPost } from "../app/api/projects/[projectId]/mass-edit/route";
import { GET as massEditStreamGet } from "../app/api/mass-edit/stream/route";
import {
  resetMassEditState,
  startMassEditRun,
  waitForMassEditRun
} from "../src/lib/mass-edit";
import { createProject, getProjectPath } from "../src/lib/projects";
import type { MassEditRunRequest, ModelInfo } from "../src/schemas";

const editModel: ModelInfo = {
  id: "openai/gpt-image-2/edit",
  name: "GPT Image 2 Edit",
  kind: "image",
  tags: ["image-to-image", "premium"],
  capabilities: {
    imageToImage: true
  }
};

describe("mass edit orchestration", () => {
  let outputRoot: string;

  beforeEach(async () => {
    resetMassEditState();
    outputRoot = await mkdtemp(path.join(os.tmpdir(), "mass-edit-"));
  });

  afterEach(async () => {
    resetMassEditState();
    await rm(outputRoot, { force: true, recursive: true });
  });

  it("runs multiple dry-run batches and preserves each source image dimensions", async () => {
    const project = await createProject("July 4th Batch Edits");
    const request: MassEditRunRequest = {
      projectId: project.projectId,
      dryRun: true,
      batches: [
        {
          id: "remove-logo",
          name: "Remove logo",
          prompt: "Remove all visible logos while keeping the original resort photo.",
          modelId: editModel.id,
          model: editModel,
          quality: "high",
          images: [
            {
              id: "pool",
              name: "pool.jpg",
              sourceUrl: "https://fal.media/files/pool.jpg",
              width: 1080,
              height: 1350
            }
          ]
        },
        {
          id: "add-logo",
          name: "Add logo",
          prompt: "Add a small approved logo to the lower right corner.",
          modelId: "fal-ai/image-edit",
          model: {
            id: "fal-ai/image-edit",
            name: "Image Edit",
            kind: "image"
          },
          images: [
            {
              id: "lobby",
              name: "lobby.png",
              sourceUrl: "https://fal.media/files/lobby.png",
              width: 1000,
              height: 333
            }
          ]
        }
      ]
    };

    try {
      const started = await startMassEditRun(request, {
        outputRoot
      });

      await waitForMassEditRun(started.runId);

      expect(started.assetCount).toBe(2);

      const runDir = path.join(outputRoot, "july-4th-batch-edits", "mass-edits", started.runId);
      const poolMeta = await sharp(
        path.join(runDir, "final", "remove-logo", "pool_1080x1350.png")
      ).metadata();
      const lobbyMeta = await sharp(
        path.join(runDir, "final", "add-logo", "lobby_1000x333.png")
      ).metadata();
      const costLog = await readFile(path.join(runDir, "cost-log.jsonl"), "utf8");
      const costEntries = costLog
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as { modelId: string; params: Record<string, unknown> });

      expect(poolMeta.width).toBe(1080);
      expect(poolMeta.height).toBe(1350);
      expect(lobbyMeta.width).toBe(1000);
      expect(lobbyMeta.height).toBe(333);
      expect(costEntries.find((entry) => entry.modelId === "openai/gpt-image-2/edit")).toMatchObject({
        modelId: "openai/gpt-image-2/edit",
        params: {
          prompt: "Remove all visible logos while keeping the original resort photo.",
          image_urls: ["https://fal.media/files/pool.jpg"],
          image_size: { width: 1088, height: 1360 },
          quality: "high"
        }
      });
      expect(costEntries.find((entry) => entry.modelId === "fal-ai/image-edit")).toMatchObject({
        modelId: "fal-ai/image-edit",
        params: {
          image_urls: ["https://fal.media/files/lobby.png"],
          image_size: { width: 1008, height: 336 }
        }
      });
    } finally {
      await rm(getProjectPath(project.projectId), { force: true });
    }
  });

  it("POST starts a mass-edit run and the stream replays progress", async () => {
    const project = await createProject("Route Batch Project");

    try {
      const response = await massEditPost(
        new Request(`http://localhost:3000/api/projects/${project.projectId}/mass-edit`, {
          method: "POST",
          body: JSON.stringify({
            outputRoot,
            dryRun: true,
            batches: [
              {
                id: "remove-logo",
                name: "Remove logo",
                prompt: "Remove logo.",
                modelId: editModel.id,
                model: editModel,
                images: [
                  {
                    id: "pool",
                    name: "pool.jpg",
                    sourceUrl: "https://fal.media/files/pool.jpg",
                    width: 640,
                    height: 480
                  }
                ]
              }
            ]
          })
        }),
        { params: { projectId: project.projectId } }
      );
      const payload = (await response.json()) as { runId: string; assetCount: number };

      expect(response.status).toBe(202);
      expect(payload.assetCount).toBe(1);

      await waitForMassEditRun(payload.runId);

      const streamResponse = await massEditStreamGet(
        new Request(`http://localhost:3000/api/mass-edit/stream?runId=${payload.runId}`)
      );
      const events = parseSseEvents(await readStream(streamResponse.body));

      expect(streamResponse.headers.get("content-type")).toContain("text/event-stream");
      expect(events.map((event) => event.status)).toEqual(
        expect.arrayContaining(["queued", "running", "done"])
      );
      expect(events.at(-1)).toMatchObject({ status: "done", progress: 100 });
    } finally {
      await rm(getProjectPath(project.projectId), { force: true });
    }
  });
});

describe("MassEditWorkspace", () => {
  it("lets the user add independent edit sections and submits batch prompts", async () => {
    const fetchSpy = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).includes("/api/projects/01HXPROJECT00000000000000/mass-edit")) {
        return jsonResponse({ runId: "01HXMASS000000000000000000", assetCount: 0 }, 202);
      }

      return jsonResponse({ models: [] });
    });
    vi.stubGlobal("fetch", fetchSpy);
    vi.stubGlobal(
      "EventSource",
      class {
        onmessage: ((event: MessageEvent) => void) | null = null;
        onerror: (() => void) | null = null;
        close = vi.fn();
        constructor(_url: string) {
          setTimeout(() => this.onerror?.(), 0);
        }
      }
    );

    try {
      render(<MassEditWorkspace projectId="01HXPROJECT00000000000000" projectName="July 4th" />);
      fireEvent.click(screen.getByRole("button", { name: "Add edit section" }));

      expect(screen.getByRole("heading", { name: "Edit section 1" })).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Edit section 2" })).toBeInTheDocument();

      fireEvent.change(screen.getAllByLabelText("Section name")[0], {
        target: { value: "Remove logo" }
      });
      fireEvent.change(screen.getAllByLabelText("Edit prompt")[0], {
        target: { value: "Remove every visible logo." }
      });
      fireEvent.change(screen.getAllByLabelText("Model id")[0], {
        target: { value: "openai/gpt-image-2/edit" }
      });
      fireEvent.click(screen.getAllByRole("button", { name: "Use manual model" })[0]);
      fireEvent.change(screen.getAllByLabelText("Uploaded image URL")[0], {
        target: { value: "https://fal.media/files/pool.jpg" }
      });
      fireEvent.change(screen.getAllByLabelText("Source width")[0], {
        target: { value: "1080" }
      });
      fireEvent.change(screen.getAllByLabelText("Source height")[0], {
        target: { value: "1350" }
      });
      fireEvent.click(screen.getAllByRole("button", { name: "Add image URL" })[0]);
      fireEvent.click(screen.getByRole("button", { name: "Run mass edit" }));

      await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledWith(
          "/api/projects/01HXPROJECT00000000000000/mass-edit",
          expect.objectContaining({
            method: "POST",
            headers: { "content-type": "application/json" },
            body: expect.stringContaining("Remove every visible logo.")
          })
        );
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

async function readStream(body: ReadableStream<Uint8Array> | null) {
  if (!body) {
    return "";
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let output = "";

  for (;;) {
    const next = await reader.read();

    if (next.done) {
      break;
    }

    output += decoder.decode(next.value, { stream: true });
  }

  output += decoder.decode();

  return output;
}

function parseSseEvents(sse: string) {
  return sse
    .split("\n\n")
    .map((event) => event.trim())
    .filter(Boolean)
    .map((event) => event.replace(/^data: /, ""))
    .map(
      (event) =>
        JSON.parse(event) as {
          assetId: string;
          status: "queued" | "running" | "done" | "failed";
          progress: number;
          thumbnailUrl?: string;
          error?: string;
        }
    );
}

function jsonResponse(payload: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(payload), {
      status,
      headers: { "content-type": "application/json" }
    })
  );
}
