import { rm } from "node:fs/promises";

import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, vi } from "vitest";

import GeneratePage from "../app/generate/page";
import { LiveGeneratePanel } from "../components/LiveGeneratePanel";
import { getRunPath } from "../src/lib/runs";
import {
  createRun,
  updateRunBrief,
  updateRunChannels,
  updateRunModelSelections
} from "../src/lib/runs";
import type { GenerationEvent } from "../src/lib/generation";
import type { CreativeBrief, ModelInfo } from "../src/schemas";

const brief: CreativeBrief = {
  resortName: "Westgate Lakes Resort & Spa",
  headline: "Spring Villa Escape",
  offer: "Save 30%",
  subheadline: "Spacious Orlando resort villas near the parks",
  ctaText: "Book Now",
  brandColors: ["#005A8B"],
  location: "Orlando, Florida",
  campaignName: "Spring Villas",
  promotionSummary: "Promote spring stays with room to relax.",
  targetAudience: "couples and family travelers",
  tone: "relaxed premium",
  mustIncludeVisualElements: ["poolside cabanas"],
  mustAvoidElements: ["competitor logos"]
};

const imageModel: ModelInfo = {
  id: "fal-ai/flux-pro/v1.1-ultra",
  name: "Flux Pro Ultra",
  kind: "image",
  pricing: { unit: "image", amountUsd: 1 },
  capabilities: {
    textToImage: true,
    supportsOnImageText: false,
    supportedAspects: ["1:1", "16:9"]
  }
};

describe("GeneratePage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders Step 6 with run cost and expected asset count", async () => {
    installEventSourceStub();
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ runId: "01HX", assetCount: 2 })));
    const run = await createRun({
      resortName: brief.resortName,
      headline: brief.headline,
      subheadline: brief.subheadline ?? null,
      offer: brief.offer,
      validDates: brief.validDates ?? null,
      ctaText: brief.ctaText ?? null,
      heroImageUrl: brief.heroImageUrl ?? null,
      brandColors: brief.brandColors,
      location: brief.location ?? null
    });

    try {
      await updateRunBrief(run.runId, brief);
      await updateRunChannels(run.runId, ["email_internal"]);
      await updateRunModelSelections(run.runId, {
        dryRun: true,
        estimatedCostUsd: 2,
        selections: {
          email_internal: {
            imageModelId: imageModel.id,
            imageModel
          }
        }
      });

      render(await GeneratePage({ searchParams: { runId: run.runId } }));

      expect(screen.getByRole("heading", { name: "Generate" })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Start over" })).toHaveAttribute("href", "/");
      expect(screen.getByText("2 assets queued")).toBeInTheDocument();
      expect(screen.getByText("$0.00 / $2.00")).toBeInTheDocument();
    } finally {
      await rm(getRunPath(run.runId), { force: true });
    }
  });
});

describe("LiveGeneratePanel", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("starts generation before opening the event stream", async () => {
    const eventSource = installEventSourceStub();
    const deferredStart = deferred<Response>();
    const fetchSpy = vi.fn(() => deferredStart.promise);
    vi.stubGlobal("fetch", fetchSpy);

    render(
      <LiveGeneratePanel
        runId="01HX"
        expectedAssetCount={1}
        estimatedCostUsd={0}
        onComplete={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalled();
    });
    expect(eventSource.instances).toHaveLength(0);

    await act(async () => {
      deferredStart.resolve(jsonResponse({ runId: "01HX", assetCount: 1 }));
      await deferredStart.promise;
    });

    await waitFor(() => {
      expect(eventSource.instances[0]?.url).toBe("/api/generate/stream?runId=01HX");
    });
  });

  it("posts generation, renders SSE progress cards, ticks cost, and redirects when settled", async () => {
    const eventSource = installEventSourceStub();
    const fetchSpy = vi.fn(async () => jsonResponse({ runId: "01HX", assetCount: 2 }));
    const onComplete = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    render(
      <LiveGeneratePanel
        runId="01HX"
        expectedAssetCount={2}
        estimatedCostUsd={4}
        onComplete={onComplete}
      />
    );

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith("/api/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ runId: "01HX" })
      });
    });
    expect(eventSource.instances[0]?.url).toBe("/api/generate/stream?runId=01HX");

    act(() => {
      eventSource.emit({
        assetId: "meta_feed-square_1200x1200",
        status: "running",
        progress: 35
      });
    });
    expect(screen.getByText("meta_feed-square_1200x1200")).toBeInTheDocument();
    expect(screen.getByText("running")).toBeInTheDocument();
    expect(screen.getByText("35%")).toBeInTheDocument();

    act(() => {
      eventSource.emit({
        assetId: "meta_feed-square_1200x1200",
        status: "done",
        progress: 100,
        thumbnailUrl: "/outputs/meta.jpg"
      });
    });
    expect(screen.getByAltText("meta_feed-square_1200x1200 thumbnail")).toHaveAttribute(
      "src",
      "/outputs/meta.jpg"
    );
    expect(screen.getByText("$2.00 / $4.00")).toBeInTheDocument();
    expect(onComplete).not.toHaveBeenCalled();

    act(() => {
      eventSource.emit({
        assetId: "website_hero_1400x600",
        status: "failed",
        progress: 100,
        error: "OCR text detected"
      });
    });
    expect(screen.getByText("OCR text detected")).toBeInTheDocument();
    expect(screen.getByText("$4.00 / $4.00")).toBeInTheDocument();
    expect(onComplete).toHaveBeenCalledWith("/results/01HX");
  });
});

function installEventSourceStub() {
  type Handler = (event: MessageEvent<string>) => void;
  const instances: Array<{
    url: string;
    listeners: Map<string, Handler[]>;
    close: ReturnType<typeof vi.fn>;
  }> = [];

  class FakeEventSource {
    url: string;
    listeners = new Map<string, Handler[]>();
    close = vi.fn();

    constructor(url: string) {
      this.url = url;
      instances.push(this);
    }

    addEventListener(type: string, handler: Handler) {
      this.listeners.set(type, [...(this.listeners.get(type) ?? []), handler]);
    }

    removeEventListener(type: string, handler: Handler) {
      this.listeners.set(
        type,
        (this.listeners.get(type) ?? []).filter((listener) => listener !== handler)
      );
    }
  }

  vi.stubGlobal("EventSource", FakeEventSource);

  return {
    instances,
    emit(event: GenerationEvent) {
      for (const listener of instances[0]?.listeners.get("message") ?? []) {
        listener(new MessageEvent("message", { data: JSON.stringify(event) }));
      }
    }
  };
}

function jsonResponse(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status: 202,
    headers: { "content-type": "application/json" }
  });
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, resolve, reject };
}
