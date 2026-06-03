import { rm } from "node:fs/promises";

import { fireEvent, render, screen, within } from "@testing-library/react";
import { vi } from "vitest";

import ReviewPage from "../app/review/page";
import { ReviewPromptForm, type ReviewPromptItem } from "../components/ReviewPromptForm";
import { getRunPath } from "../src/lib/runs";
import {
  createRun,
  updateRunBrief,
  updateRunChannels,
  updateRunModelSelections,
  updateRunReviewPrompts
} from "../src/lib/runs";
import type { ScrapedCreativeBrief } from "../src/scraper/landing-page";
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

const metaModel: ModelInfo = {
  id: "fal-ai/flux-pro/kontext/text-to-image",
  name: "Flux Kontext",
  kind: "image",
  tags: ["text-to-image", "photorealistic", "supports-on-image-text"],
  pricing: { unit: "image", amountUsd: 1 },
  capabilities: {
    textToImage: true,
    supportsOnImageText: true,
    supportedAspects: ["1:1", "4:5", "16:9", "9:16", "21:9"]
  }
};

const websiteModel: ModelInfo = {
  id: "fal-ai/flux-pro/v1.1-ultra",
  name: "Flux Pro Ultra",
  kind: "image",
  tags: ["text-to-image", "photorealistic"],
  pricing: { unit: "image", amountUsd: 0.2 },
  capabilities: {
    textToImage: true,
    supportsOnImageText: false,
    supportedAspects: ["1:1", "16:9", "21:9"]
  }
};

const gptImage2Model: ModelInfo = {
  id: "openai/gpt-image-2",
  name: "GPT Image 2",
  kind: "image",
  capabilities: {
    supportsOnImageText: true
  }
};

describe("ReviewPage", () => {
  it("shows resolved prompts grouped by channel and size with model ids and estimated cost", async () => {
    const run = await createRun(scrapedBrief);

    try {
      await updateRunBrief(run.runId, brief);
      await updateRunChannels(run.runId, ["meta", "website"]);
      await updateRunModelSelections(run.runId, {
        dryRun: true,
        estimatedCostUsd: 7,
        requiresCostConfirm: true,
        selections: {
          meta: {
            imageModelId: metaModel.id,
            imageModel: metaModel
          },
          website: {
            imageModelId: websiteModel.id,
            imageModel: websiteModel
          }
        }
      });

      render(await ReviewPage({ searchParams: { runId: run.runId } }));

      expect(screen.getByRole("heading", { name: "Review" })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Start over" })).toHaveAttribute("href", "/");
      expect(screen.getByText("Estimated cost")).toBeInTheDocument();
      expect(screen.getByText("$7.00")).toBeInTheDocument();
      expect(screen.getByText("Cost confirmation required")).toBeInTheDocument();

      const metaSection = screen.getByRole("region", { name: "Meta" });
      expect(within(metaSection).getByText("Feed landscape")).toBeInTheDocument();
      expect(within(metaSection).getAllByText(metaModel.id)[0]).toBeInTheDocument();
      expect(
        (
          within(metaSection).getByLabelText(
            "Prompt for Meta Feed landscape"
          ) as HTMLTextAreaElement
        ).value
      ).toContain("central 60% horizontal band");

      const websiteSection = screen.getByRole("region", { name: "Website" });
      expect(within(websiteSection).getByText("Hero wide")).toBeInTheDocument();
      expect(within(websiteSection).getAllByText(websiteModel.id)[0]).toBeInTheDocument();
      expect(
        (
          within(websiteSection).getByLabelText(
            "Negative prompt for Website Hero wide"
          ) as HTMLTextAreaElement
        ).value
      ).toContain("no typography");
    } finally {
      await rm(getRunPath(run.runId), { force: true });
    }
  });

  it("shows GPT Image 2 quality on review", async () => {
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
            imageModelId: gptImage2Model.id,
            imageModel: gptImage2Model,
            imageOptions: {
              quality: "medium"
            }
          }
        }
      });

      render(await ReviewPage({ searchParams: { runId: run.runId } }));

      expect(screen.getByText("Quality: medium")).toBeInTheDocument();
    } finally {
      await rm(getRunPath(run.runId), { force: true });
    }
  });

  it("prefills Review with prompts generated by the Creative Direction step", async () => {
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
            imageModelId: metaModel.id,
            imageModel: metaModel
          }
        }
      });
      await updateRunReviewPrompts(run.runId, {
        promptAssignments: [],
        reviewedPrompts: [
          {
            assetId: "meta_feed-square_1200x1200",
            channel: "meta",
            sizeName: "Feed square",
            prompt: "Approved creative-agent prompt for the square Meta ad.",
            negativePrompt: "no brand marks"
          }
        ]
      });

      render(await ReviewPage({ searchParams: { runId: run.runId } }));

      expect(
        (screen.getByLabelText("Prompt for Meta Feed square") as HTMLTextAreaElement).value
      ).toBe("Approved creative-agent prompt for the square Meta ad.");
      expect(
        (screen.getByLabelText("Negative prompt for Meta Feed square") as HTMLTextAreaElement)
          .value
      ).toBe("no brand marks");
    } finally {
      await rm(getRunPath(run.runId), { force: true });
    }
  });
});

describe("ReviewPromptForm", () => {
  it("can replace a reviewed prompt with a Creative Director agent response", async () => {
    const onGenerate = vi.fn();
    const fetchSpy = vi.fn(async () =>
      new Response(
        JSON.stringify({
          text:
            "# Meta Ad Creative\n\n**Opening Statement:** Design a cinematic Orlando holiday ad. The image must look believable and photorealistic."
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" }
        }
      )
    );
    vi.stubGlobal("fetch", fetchSpy);

    try {
      render(
        <ReviewPromptForm
          runId="01HX0000000000000000000000"
          estimatedCostUsd={0}
          requiresCostConfirm={false}
          prompts={[
            reviewPrompt({
              id: "meta-feed-landscape",
              prompt: "Original prompt"
            })
          ]}
          onGenerate={onGenerate}
        />
      );

      fireEvent.click(screen.getByRole("button", { name: "Creative agent for Meta Feed landscape" }));

      expect(await screen.findByText("Creative agent prompt applied.")).toBeInTheDocument();
      expect(
        (screen.getByLabelText("Prompt for Meta Feed landscape") as HTMLTextAreaElement).value
      ).toContain("Design a cinematic Orlando holiday ad");
      expect(fetchSpy).toHaveBeenCalledWith(
        "/api/prompt-agent",
        expect.objectContaining({
          method: "POST"
        })
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("uploads reference images and includes their URLs in reviewed prompts", async () => {
    const onGenerate = vi.fn();
    const fetchSpy = vi.fn(async () =>
      new Response(
        JSON.stringify({
          url: "https://fal.media/files/orlando-reference.png"
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" }
        }
      )
    );
    vi.stubGlobal("fetch", fetchSpy);

    try {
      render(
        <ReviewPromptForm
          runId="01HX0000000000000000000000"
          estimatedCostUsd={0}
          requiresCostConfirm={false}
          prompts={[
            reviewPrompt({
              id: "meta-feed-landscape",
              prompt: "Original prompt"
            })
          ]}
          onGenerate={onGenerate}
        />
      );

      const file = new File(["reference"], "orlando-reference.png", { type: "image/png" });
      fireEvent.change(screen.getByLabelText("Reference images for Meta Feed landscape"), {
        target: { files: [file] }
      });

      expect(await screen.findByText("https://fal.media/files/orlando-reference.png")).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Generate" }));

      expect(onGenerate).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            id: "meta-feed-landscape",
            referenceImageUrls: ["https://fal.media/files/orlando-reference.png"]
          })
        ]),
        []
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("allows inline prompt edits and requires confirmation before generating over five dollars", () => {
    const onGenerate = vi.fn();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);

    try {
      render(
        <ReviewPromptForm
          runId="01HX0000000000000000000000"
          estimatedCostUsd={6}
          requiresCostConfirm={true}
          prompts={[
            reviewPrompt({
              id: "meta-feed-landscape",
              prompt: "Original prompt"
            })
          ]}
          onGenerate={onGenerate}
        />
      );

      fireEvent.change(screen.getByLabelText("Prompt for Meta Feed landscape"), {
        target: { value: "Edited prompt" }
      });
      expect(screen.getByLabelText("Prompt for Meta Feed landscape")).toHaveValue("Edited prompt");

      fireEvent.click(screen.getByRole("button", { name: "Generate" }));
      expect(confirmSpy).toHaveBeenCalledWith(
        "Estimated cost is $6.00. Confirm you want to continue to Generate."
      );
      expect(onGenerate).not.toHaveBeenCalled();

      confirmSpy.mockReturnValue(true);
      fireEvent.click(screen.getByRole("button", { name: "Generate" }));
      expect(onGenerate).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            id: "meta-feed-landscape",
            prompt: "Edited prompt"
          })
        ]),
        []
      );
    } finally {
      confirmSpy.mockRestore();
    }
  });

  it("applies one custom prompt assignment to multiple channel sizes before generate", () => {
    const onGenerate = vi.fn();

    render(
      <ReviewPromptForm
        runId="01HX0000000000000000000000"
        estimatedCostUsd={0}
        requiresCostConfirm={false}
        prompts={[
          reviewPrompt({
            id: "meta-feed-square",
            assetId: "meta_feed-square_1200x1200",
            sizeName: "Feed square",
            sizeLabel: "1200x1200 (1:1)",
            prompt: "Base meta prompt"
          }),
          reviewPrompt({
            id: "seo-horizontal-hero",
            assetId: "seo_horizontal-hero_800x450",
            channel: "seo",
            channelLabel: "Seo",
            channelBadge: "Concept as is — no overlays",
            sizeName: "Horizontal hero",
            sizeLabel: "800x450 (16:9)",
            prompt: "Base SEO prompt"
          })
        ]}
        promptAssignments={[]}
        targets={[
          {
            assetId: "meta_feed-square_1200x1200",
            channel: "meta",
            channelLabel: "Meta",
            sizeName: "Feed square",
            sizeLabel: "1200x1200 (1:1)"
          },
          {
            assetId: "seo_horizontal-hero_800x450",
            channel: "seo",
            channelLabel: "Seo",
            sizeName: "Horizontal hero",
            sizeLabel: "800x450 (16:9)"
          }
        ]}
        onGenerate={onGenerate}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Add prompt" }));
    fireEvent.change(screen.getByLabelText("Prompt name"), {
      target: { value: "Orlando offer split" }
    });
    fireEvent.change(screen.getByLabelText("Positive prompt"), {
      target: { value: "Orlando family checking into a sunny resort before a theme park day." }
    });
    fireEvent.click(screen.getByLabelText("Meta Feed square"));
    fireEvent.click(screen.getByLabelText("Seo Horizontal hero"));
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));

    expect(onGenerate).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          assetId: "meta_feed-square_1200x1200",
          prompt: expect.stringContaining("Orlando family checking into a sunny resort")
        }),
        expect.objectContaining({
          assetId: "seo_horizontal-hero_800x450",
          prompt: expect.stringContaining("Orlando family checking into a sunny resort")
        })
      ]),
      expect.arrayContaining([
        expect.objectContaining({
          name: "Orlando offer split",
          targets: expect.arrayContaining([
            { channel: "meta", sizeNames: ["Feed square"] },
            { channel: "seo", sizeNames: ["Horizontal hero"] }
          ])
        })
      ])
    );
  });
});

function reviewPrompt(overrides: Partial<ReviewPromptItem> = {}): ReviewPromptItem {
  return {
    id: "meta-feed-landscape",
    assetId: "meta_feed-landscape_1920x1080",
    channel: "meta",
    channelLabel: "Meta",
    channelBadge: "With overlays",
    sizeName: "Feed landscape",
    sizeLabel: "1920x1080 (16:9)",
    modelId: metaModel.id,
    costUsd: 1,
    prompt: "Original prompt",
    negativePrompt: "no other brand logos, no text artifacts",
    seed: 1234,
    aspectRatio: "16:9",
    ...overrides
  };
}
