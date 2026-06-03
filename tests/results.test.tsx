import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import sharp from "sharp";

import ResultsPage from "../app/results/[runId]/page";
import { GET as downloadGet } from "../app/api/download/[runId]/route";
import { POST as rerollPost } from "../app/api/reroll/route";
import { ResultsContactSheet } from "../components/ResultsContactSheet";
import { handleOpenFolderRequest } from "../src/lib/open-folder-handler";
import { getRunPath } from "../src/lib/runs";
import {
  createRun,
  updateRunBrief,
  updateRunChannels,
  updateRunModelSelections
} from "../src/lib/runs";
import type { CreativeBrief, ModelInfo } from "../src/schemas";

const brief: CreativeBrief = {
  resortName: "Westgate Lakes Resort & Spa",
  headline: "Spring Villa Escape",
  offer: "Save 30%",
  brandColors: ["#005A8B"],
  campaignName: "Spring Villas",
  mustIncludeVisualElements: [],
  mustAvoidElements: []
};

const imageModel: ModelInfo = {
  id: "fal-ai/flux-pro/v1.1-ultra",
  name: "Flux Pro Ultra",
  kind: "image",
  tags: ["text-to-image", "photorealistic"],
  capabilities: {
    textToImage: true,
    supportsOnImageText: false,
    supportedAspects: ["1:1", "16:9"]
  }
};

describe("ResultsPage", () => {
  it("renders a grouped contact sheet with badges, metadata, reroll controls, downloads, and exports HTML", async () => {
    const fixture = await createResultFixture();

    try {
      render(await ResultsPage({ params: { runId: fixture.runId } }));

      expect(screen.getByRole("heading", { name: "Results" })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Start over" })).toHaveAttribute("href", "/");
      expect(screen.getByRole("link", { name: "Download all" })).toHaveAttribute(
        "href",
        `/api/download/${fixture.runId}`
      );
      expect(screen.getByRole("link", { name: "Download all" })).toHaveAttribute(
        "download",
        `${fixture.runId}-all.zip`
      );
      expect(screen.getByRole("button", { name: "Open output folder" })).toBeInTheDocument();

      const emailSection = screen.getByRole("region", { name: "Email Internal" });
      expect(within(emailSection).getByText("Concept photo only — no text/logo")).toBeInTheDocument();
      expect(within(emailSection).getByText(imageModel.id)).toBeInTheDocument();
      expect(within(emailSection).getByText("Seed 111")).toBeInTheDocument();
      expect(within(emailSection).getByRole("link", { name: "Download asset" })).toHaveAttribute(
        "href",
        `/api/download/${fixture.runId}?assetId=email_internal_email-near-square_600x585`
      );
      expect(within(emailSection).getByRole("link", { name: "Download asset" })).toHaveAttribute(
        "download",
        "email_internal_email-near-square_600x585.png"
      );
      expect(within(emailSection).getByRole("link", { name: "Download Email Internal ZIP" }))
        .toHaveAttribute("href", `/api/download/${fixture.runId}?channel=email_internal`);
      expect(within(emailSection).getByRole("link", { name: "Download Email Internal ZIP" }))
        .toHaveAttribute("download", `${fixture.runId}-email_internal.zip`);
      expect(within(emailSection).getByRole("button", { name: "Open folder" })).toBeInTheDocument();

      fireEvent.click(within(emailSection).getByRole("button", { name: "Re-roll" }));
      await waitFor(() => {
        expect(screen.getByText("Clean resort concept")).toBeInTheDocument();
        expect(screen.getByText("Flux Pro Ultra")).toBeInTheDocument();
      });

      expect(await readFile(path.join(fixture.runDir, "contact-sheet.html"), "utf8"))
        .toContain("email_internal_email-near-square_600x585");
    } finally {
      await fixture.cleanup();
    }
  });

  it("shows persisted generation failures when a run has no final assets", async () => {
    const fixture = await createFailedResultFixture();

    try {
      render(await ResultsPage({ params: { runId: fixture.runId } }));

      expect(screen.getByRole("heading", { name: "Results" })).toBeInTheDocument();
      expect(screen.getByText("Generation failed before final assets were written.")).toBeInTheDocument();
      expect(screen.getByText("email_internal_email-near-square_600x585")).toBeInTheDocument();
      expect(screen.getByText("fal.ai authentication failed. Check FAL_KEY in .env.local.")).toBeInTheDocument();
    } finally {
      await fixture.cleanup();
    }
  });
});

describe("ResultsContactSheet", () => {
  it("posts a local folder open request for an asset", async () => {
    const fetchSpy = vi.fn(async () => jsonResponse({ opened: true, path: "F:\\outputs\\asset" }));
    vi.stubGlobal("fetch", fetchSpy);

    try {
      render(<ResultsContactSheet runId="01HX" groups={[fixtureGroup()]} />);
      fireEvent.click(screen.getByRole("button", { name: "Open folder" }));

      await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledWith("/api/open-folder", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            runId: "01HX",
            assetId: "email_internal_email-near-square_600x585"
          })
        });
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("posts a reroll request and updates the asset seed", async () => {
    const fetchSpy = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url) === "/api/reference-images") {
        return jsonResponse({ url: "https://fal.media/files/reroll-reference.png" });
      }

      return jsonResponse({
        asset: {
          ...fixtureAsset(),
          seed: 222,
          modelId: "fal-ai/new-model",
          prompt: "Edited re-roll prompt",
          referenceImageUrls: ["https://fal.media/files/reroll-reference.png"],
          imageUrl: "/api/download/01HX?assetId=email_internal_email-near-square_600x585&inline=1&version=2"
        }
      });
    });
    vi.stubGlobal("fetch", fetchSpy);

    try {
      render(<ResultsContactSheet runId="01HX" groups={[fixtureGroup()]} />);
      fireEvent.click(screen.getByRole("button", { name: "Re-roll" }));
      fireEvent.change(screen.getByLabelText("Re-roll prompt"), {
        target: { value: "Edited re-roll prompt" }
      });
      fireEvent.change(screen.getByLabelText("Reference images for re-roll"), {
        target: {
          files: [new File(["reference"], "reroll-reference.png", { type: "image/png" })]
        }
      });
      expect(await screen.findByText("https://fal.media/files/reroll-reference.png")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Run re-roll" }));

      await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledWith("/api/reroll", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            runId: "01HX",
            assetId: "email_internal_email-near-square_600x585",
            modelId: imageModel.id,
            prompt: "Edited re-roll prompt",
            negativePrompt: "",
            referenceImageUrls: ["https://fal.media/files/reroll-reference.png"]
          })
        });
      });
      expect(await screen.findByText("Seed 222")).toBeInTheDocument();
      expect(screen.getByAltText("email_internal_email-near-square_600x585")).toHaveAttribute(
        "src",
        "/api/download/01HX?assetId=email_internal_email-near-square_600x585&inline=1&version=2"
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("download and reroll APIs", () => {
  it("opens the local run output folder for localhost requests", async () => {
    const fixture = await createResultFixture();
    const openedPaths: string[] = [];

    try {
      const response = await handleOpenFolderRequest(
        new Request("http://localhost:3000/api/open-folder", {
          method: "POST",
          body: JSON.stringify({ runId: fixture.runId })
        }),
        {
          opener: async (folderPath) => {
            openedPaths.push(folderPath);
          }
        }
      );
      const payload = (await response.json()) as { opened: boolean; path: string };

      expect(response.status).toBe(200);
      expect(payload.opened).toBe(true);
      expect(openedPaths).toEqual([fixture.runDir]);
    } finally {
      await fixture.cleanup();
    }
  });

  it("rejects folder open requests from non-localhost origins", async () => {
    const opener = vi.fn();
    const response = await handleOpenFolderRequest(
      new Request("http://example.com/api/open-folder", {
        method: "POST",
        body: JSON.stringify({ runId: "01HX" })
      }),
      { opener }
    );

    expect(response.status).toBe(403);
    expect(opener).not.toHaveBeenCalled();
  });

  it("returns per-channel and all-channel ZIP downloads", async () => {
    const fixture = await createResultFixture();

    try {
      const channelResponse = await downloadGet(
        new Request(`http://localhost:3000/api/download/${fixture.runId}?channel=email_internal`),
        { params: { runId: fixture.runId } }
      );
      const channelZip = Buffer.from(await channelResponse.arrayBuffer());
      const allResponse = await downloadGet(
        new Request(`http://localhost:3000/api/download/${fixture.runId}`),
        { params: { runId: fixture.runId } }
      );
      const allZip = Buffer.from(await allResponse.arrayBuffer());

      expect(channelResponse.status).toBe(200);
      expect(channelResponse.headers.get("content-type")).toContain("application/zip");
      expect(channelZip.subarray(0, 2).toString()).toBe("PK");
      expect(channelZip.toString("latin1")).toContain("email_internal_email-near-square_600x585.png");
      expect(allZip.toString("latin1")).toContain("email_internal/");
    } finally {
      await fixture.cleanup();
    }
  });

  it("serves inline previews separately from attachment downloads", async () => {
    const fixture = await createResultFixture();

    try {
      const inlineResponse = await downloadGet(
        new Request(
          `http://localhost:3000/api/download/${fixture.runId}?assetId=email_internal_email-near-square_600x585&inline=1`
        ),
        { params: { runId: fixture.runId } }
      );
      const attachmentResponse = await downloadGet(
        new Request(
          `http://localhost:3000/api/download/${fixture.runId}?assetId=email_internal_email-near-square_600x585`
        ),
        { params: { runId: fixture.runId } }
      );

      expect(inlineResponse.status).toBe(200);
      expect(inlineResponse.headers.get("content-disposition")).toBe(
        'inline; filename="email_internal_email-near-square_600x585.png"'
      );
      expect(attachmentResponse.headers.get("content-disposition")).toBe(
        'attachment; filename="email_internal_email-near-square_600x585.png"'
      );
    } finally {
      await fixture.cleanup();
    }
  });

  it("rerolls an asset in Dry Run mode and returns updated metadata", async () => {
    const fixture = await createResultFixture();

    try {
      const response = await rerollPost(
        new Request("http://localhost:3000/api/reroll", {
          method: "POST",
          body: JSON.stringify({
            runId: fixture.runId,
            assetId: "email_internal_email-near-square_600x585"
          })
        })
      );
      const payload = (await response.json()) as { asset: { assetId: string; seed: number } };

      expect(response.status).toBe(200);
      expect(payload.asset.assetId).toBe("email_internal_email-near-square_600x585");
      expect(payload.asset.seed).not.toBe(111);
    } finally {
      await fixture.cleanup();
    }
  });

  it("saves rerolls as new physical versions without replacing the original asset", async () => {
    const fixture = await createResultFixture();

    try {
      const response = await rerollPost(
        new Request("http://localhost:3000/api/reroll", {
          method: "POST",
          body: JSON.stringify({
            runId: fixture.runId,
            assetId: "email_internal_email-near-square_600x585"
          })
        })
      );
      const payload = (await response.json()) as {
        asset: {
          assetId: string;
          imageUrl: string;
          downloadFileName: string;
          finalPath: string;
        };
      };
      const finalFiles = await readdir(path.join(fixture.runDir, "final", "email_internal"));
      const rawFiles = await readdir(path.join(fixture.runDir, "raw"));

      expect(response.status).toBe(200);
      expect(finalFiles).toEqual(
        expect.arrayContaining([
          "email_internal_email-near-square_600x585.png",
          "email_internal_email-near-square_600x585_v2.png"
        ])
      );
      expect(rawFiles).toContain("email_internal_email-near-square_600x585_v2.png");
      expect(payload.asset.downloadFileName).toBe(
        "email_internal_email-near-square_600x585_v2.png"
      );
      expect(payload.asset.finalPath).toContain("email_internal_email-near-square_600x585_v2.png");
      expect(payload.asset.imageUrl).toContain("version=2");
    } finally {
      await fixture.cleanup();
    }
  });
});

async function createResultFixture() {
  const run = await createRun({
    resortName: brief.resortName,
    headline: brief.headline,
    subheadline: null,
    offer: brief.offer,
    validDates: null,
    ctaText: null,
    heroImageUrl: null,
    brandColors: brief.brandColors,
    location: null
  });
  await updateRunBrief(run.runId, brief);
  await updateRunChannels(run.runId, ["email_internal"]);
  await updateRunModelSelections(run.runId, {
    dryRun: true,
    selections: {
      email_internal: {
        imageModelId: imageModel.id,
        imageModel
      }
    }
  });

  const runDir = path.join(process.cwd(), "outputs", "spring-villas", run.runId);
  const finalDir = path.join(runDir, "final", "email_internal");
  await mkdir(finalDir, { recursive: true });
  await sharp({
    create: {
      width: 600,
      height: 585,
      channels: 3,
      background: "#005A8B"
    }
  })
    .png()
    .toFile(path.join(finalDir, "email_internal_email-near-square_600x585.png"));
  await writeFile(
    path.join(runDir, "cost-log.jsonl"),
    `${JSON.stringify({
      timestamp: "2026-05-21T12:00:00.000Z",
      runId: run.runId,
      assetId: "email_internal_email-near-square_600x585",
      channel: "email_internal",
      modelId: imageModel.id,
      seed: 111,
      params: { prompt: "Clean resort concept" },
      reportedCostUsd: 0,
      dryRun: true
    })}\n`,
    "utf8"
  );

  return {
    runId: run.runId,
    runDir,
    cleanup: async () => {
      await rm(getRunPath(run.runId), { force: true });
      await rm(runDir, { force: true, recursive: true });
    }
  };
}

async function createFailedResultFixture() {
  const run = await createRun({
    resortName: brief.resortName,
    headline: brief.headline,
    subheadline: null,
    offer: brief.offer,
    validDates: null,
    ctaText: null,
    heroImageUrl: null,
    brandColors: brief.brandColors,
    location: null
  });
  await updateRunBrief(run.runId, brief);
  await updateRunChannels(run.runId, ["email_internal"]);
  await updateRunModelSelections(run.runId, {
    dryRun: false,
    selections: {
      email_internal: {
        imageModelId: imageModel.id,
        imageModel
      }
    }
  });

  const runDir = path.join(process.cwd(), "outputs", "spring-villas", run.runId);
  await mkdir(runDir, { recursive: true });
  await writeFile(
    path.join(runDir, "generation-events.jsonl"),
    `${JSON.stringify({
      timestamp: "2026-05-21T12:00:00.000Z",
      runId: run.runId,
      assetId: "email_internal_email-near-square_600x585",
      status: "failed",
      progress: 100,
      error: "fal.ai authentication failed. Check FAL_KEY in .env.local."
    })}\n`,
    "utf8"
  );

  return {
    runId: run.runId,
    runDir,
    cleanup: async () => {
      await rm(getRunPath(run.runId), { force: true });
      await rm(runDir, { force: true, recursive: true });
    }
  };
}

function fixtureGroup() {
  return {
    channel: "email_internal" as const,
    channelLabel: "Email Internal",
    badge: "Concept photo only — no text/logo",
    downloadHref: "/api/download/01HX?channel=email_internal",
    downloadFileName: "01HX-email_internal.zip",
    assets: [fixtureAsset()]
  };
}

function fixtureAsset() {
  return {
    assetId: "email_internal_email-near-square_600x585",
    channel: "email_internal" as const,
    sizeName: "Email near-square",
    sizeLabel: "600x585 (~1.03:1)",
    modelId: imageModel.id,
    model: imageModel,
    seed: 111,
    version: 1,
    prompt: "Clean resort concept",
    negativePrompt: "",
    referenceImageUrls: [],
    imageUrl: "/outputs/spring-villas/01HX/final/email_internal/email_internal_email-near-square_600x585.png",
    downloadHref: "/api/download/01HX?assetId=email_internal_email-near-square_600x585",
    downloadFileName: "email_internal_email-near-square_600x585.png"
  };
}

function jsonResponse(payload: unknown) {
  return Promise.resolve(
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" }
    })
  );
}
