import { rm } from "node:fs/promises";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, vi } from "vitest";

import CreativePage from "../app/creative/page";
import { CreativeDirectionChat } from "../components/CreativeDirectionChat";
import {
  createRun,
  getRunPath,
  updateRunBrief,
  updateRunChannels,
  updateRunCreativeWorkspace,
  updateRunModelSelections
} from "../src/lib/runs";
import type { ScrapedCreativeBrief } from "../src/scraper/landing-page";
import type { CreativeBrief, ModelInfo } from "../src/schemas";

const brief: CreativeBrief = {
  resortName: "Westgate Lakes Resort & Spa",
  headline: "Orlando 4th of July Vacation Package",
  offer: "from $99",
  subheadline: "Four days and three nights near the parks",
  ctaText: "Book Now",
  brandColors: ["#0e2545", "#c4a55d"],
  location: "Orlando, FL",
  campaignName: "July 4th",
  promotionSummary: "Promote an Orlando Independence Day getaway.",
  targetAudience: "families",
  tone: "bold and cinematic",
  mustIncludeVisualElements: ["fireworks in the sky"],
  mustAvoidElements: ["parking lots"]
};

const scrapedBrief: ScrapedCreativeBrief = {
  resortName: brief.resortName,
  headline: brief.headline,
  subheadline: brief.subheadline ?? null,
  offer: brief.offer,
  validDates: brief.validDates ?? null,
  ctaText: brief.ctaText ?? null,
  heroImageUrl: brief.heroImageUrl ?? null,
  brandColors: brief.brandColors,
  location: brief.location ?? null
};

const model: ModelInfo = {
  id: "openai/gpt-image-2",
  name: "GPT Image 2",
  kind: "image",
  capabilities: {
    supportsOnImageText: true
  }
};

describe("CreativePage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the new chat step after model selection and before review", async () => {
    const run = await createRun(scrapedBrief);

    try {
      await updateRunBrief(run.runId, brief);
      await updateRunChannels(run.runId, ["meta"], {
        meta: ["Feed square"]
      });
      await updateRunModelSelections(run.runId, {
        dryRun: true,
        selections: {
          meta: {
            imageModelId: model.id,
            imageModel: model
          }
        }
      });

      render(await CreativePage({ searchParams: { runId: run.runId } }));

      expect(screen.getByRole("heading", { name: "Creative Direction" })).toBeInTheDocument();
      expect(screen.getByText("Step 5 of 8")).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Ad creative elements" })).toBeInTheDocument();
      expect(screen.getByRole("checkbox", { name: /Destination/i })).toBeChecked();
      expect(screen.getByRole("checkbox", { name: /Offer \/ price/i })).toBeChecked();
      expect(screen.getByRole("checkbox", { name: /CTA/i })).toBeChecked();
      expect(screen.getByRole("button", { name: "Ask the agent" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Generate creative angles" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Continue to Review" })).toBeDisabled();
    } finally {
      await rm(getRunPath(run.runId), { force: true });
    }
  });

  it("enables Review when prompts are ready", async () => {
    const run = await createRun(scrapedBrief);

    try {
      await updateRunBrief(run.runId, brief);
      await updateRunChannels(run.runId, ["meta"], {
        meta: ["Feed square"]
      });
      await updateRunModelSelections(run.runId, {
        dryRun: true,
        selections: {
          meta: {
            imageModelId: model.id,
            imageModel: model
          }
        }
      });
      await updateRunCreativeWorkspace(run.runId, {
        status: "prompts_ready",
        messages: [
          {
            role: "assistant",
            content: "Concept approved and prompts generated.",
            createdAt: "2026-05-28T12:00:00.000Z"
          }
        ],
        concepts: [
          {
            id: "concept-1",
            title: "Firework Flag Sky",
            description: "A translucent patriotic flag made from fireworks above the resort.",
            heroVisual: "Firework flag over a pool scene.",
            adStructure: "Huge offer block with a simple holiday badge.",
            approvedElementsUsed: ["Destination: Orlando", "Offer / price: from $99"],
            avoid: ["No logo"]
          }
        ],
        approvedConceptId: "concept-1",
        generatedPrompts: [
          {
            assetId: "meta_feed-square_1200x1200",
            channel: "meta",
            sizeName: "Feed square",
            prompt: "Approved creative-agent prompt.",
            negativePrompt: "no brand marks"
          }
        ]
      });

      render(await CreativePage({ searchParams: { runId: run.runId } }));

      expect(screen.getByRole("link", { name: "Continue to Review" })).toHaveAttribute(
        "href",
        `/review?runId=${run.runId}`
      );
      expect(screen.getAllByText("Firework Flag Sky").length).toBeGreaterThan(0);
      expect(screen.getByText("Hero visual")).toBeInTheDocument();
      expect(screen.getByText("Firework flag over a pool scene.")).toBeInTheDocument();
      expect(screen.getByText("Approved elements used")).toBeInTheDocument();
    } finally {
      await rm(getRunPath(run.runId), { force: true });
    }
  });

  it("sends the selected ad elements before the agent creates angles", async () => {
    const fetchSpy = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        adElements: Array<{ id: string; selected: boolean }>;
      };

      return new Response(
        JSON.stringify({
          workspace: {
            status: "elements_approved",
            messages: [],
            elementsApproved: true,
            adElements: body.adElements
          }
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" }
        }
      );
    });
    vi.stubGlobal("fetch", fetchSpy);

    render(
      <CreativeDirectionChat
        runId="01HX0000000000000000000000"
        initialWorkspace={{
          status: "elements_ready",
          messages: [],
          elementsApproved: false,
          adElements: [
            {
              id: "destination",
              label: "Destination",
              value: "Orlando",
              source: "scrape",
              selected: true
            },
            {
              id: "headline",
              label: "Headline",
              value: "Long scraped headline",
              source: "scrape",
              selected: true
            }
          ]
        }}
      />
    );

    fireEvent.click(screen.getByRole("checkbox", { name: /Headline/i }));
    fireEvent.click(screen.getByRole("button", { name: "Approve selected elements" }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const requestBody = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body ?? "{}")) as {
      action: string;
      adElements: Array<{ id: string; selected: boolean }>;
    };

    expect(requestBody.action).toBe("elements");
    expect(requestBody.adElements.find((element) => element.id === "headline")).toMatchObject({
      selected: false
    });
    expect(screen.getByText("Ad elements approved")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Generate creative angles" })).not.toBeDisabled();
  });

  it("uploads creative-agent reference images and sends them with chat actions", async () => {
    const fetchSpy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url === "/api/reference-images") {
        return new Response(
          JSON.stringify({ url: "https://fal.media/files/property-reference.png" }),
          {
            status: 200,
            headers: { "content-type": "application/json" }
          }
        );
      }

      const body = JSON.parse(String(init?.body ?? "{}")) as {
        referenceImageUrls?: string[];
      };

      return new Response(
        JSON.stringify({
          workspace: {
            status: "questioning",
            messages: [
              {
                role: "assistant",
                content: "I can use the attached image to suggest visual hooks.",
                createdAt: "2026-05-28T12:00:00.000Z"
              }
            ],
            elementsApproved: true,
            referenceImageUrls: body.referenceImageUrls,
            adElements: []
          }
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" }
        }
      );
    });
    vi.stubGlobal("fetch", fetchSpy);

    render(
      <CreativeDirectionChat
        runId="01HX0000000000000000000000"
        initialWorkspace={{
          status: "elements_approved",
          messages: [],
          elementsApproved: true,
          adElements: [],
          referenceImageUrls: []
        }}
      />
    );

    fireEvent.change(screen.getByLabelText("Reference images for creative agent"), {
      target: {
        files: [new File(["image"], "property.png", { type: "image/png" })]
      }
    });

    await screen.findByText("https://fal.media/files/property-reference.png");
    fireEvent.click(screen.getByRole("button", { name: "Ask the agent" }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
    const chatBody = JSON.parse(String(fetchSpy.mock.calls[1][1]?.body ?? "{}")) as {
      action: string;
      referenceImageUrls?: string[];
    };

    expect(chatBody).toMatchObject({
      action: "ask",
      referenceImageUrls: ["https://fal.media/files/property-reference.png"]
    });
    expect(screen.getByText("I can use the attached image to suggest visual hooks."))
      .toBeInTheDocument();
  });
});
