import {
  assetResultSchema,
  channelSelectionSchema,
  costLogEntrySchema,
  creativeAdElementSchema,
  creativeBriefSchema,
  creativeWorkspaceSchema,
  massEditRunRequestSchema,
  modelInfoSchema,
  promptAssignmentSchema,
  reviewedPromptSchema,
  creativeConceptSchema,
  runRequestSchema
} from "../src/schemas";

const validBrief = {
  resortName: "Westgate Lakes Resort & Spa",
  headline: "Save on an Orlando escape",
  offer: "Save 25%",
  subheadline: "Spacious villas near the parks",
  validDates: "May 1 - June 30",
  ctaText: "Book Now",
  heroImageUrl: "https://example.com/hero.jpg",
  brandColors: ["#004f71", "#f6c343"],
  location: "Orlando, Florida",
  campaignName: "Summer Orlando",
  promotionSummary: "Seasonal resort offer for family travel.",
  targetAudience: "families",
  tone: "family-fun",
  mustIncludeVisualElements: ["pool", "villa balcony"],
  mustAvoidElements: ["competitor logos"]
};

const validModel = {
  id: "fal-ai/flux-pro/v1.1-ultra",
  name: "Flux Pro Ultra",
  kind: "image",
  description: "Photoreal image model",
  tags: ["text-to-image", "photorealistic"],
  thumbnailUrl: "https://example.com/model.jpg",
  pricing: {
    unit: "image",
    amountUsd: 0.06
  },
    capabilities: {
      textToImage: true,
      imageToImage: false,
      imageToVideo: false,
      supportsOnImageText: false,
      supportsNegativePrompt: true,
      maxResolution: { w: 1920, h: 1080 },
      supportedAspects: ["1:1", "16:9", "9:16"]
    }
};

describe("creativeBriefSchema", () => {
  it("accepts a complete creative brief", () => {
    expect(creativeBriefSchema.safeParse(validBrief).success).toBe(true);
  });

  it("rejects a missing critical offer", () => {
    const { offer: _offer, ...missingOffer } = validBrief;

    expect(creativeBriefSchema.safeParse(missingOffer).success).toBe(false);
  });
});

describe("promptAssignmentSchema", () => {
  it("accepts a prompt assigned to multiple channel size groups", () => {
    expect(
      promptAssignmentSchema.safeParse({
        id: "prompt-meta-seo",
        name: "Orlando social and SEO",
        prompt: "Bright Orlando family arrival with resort energy.",
        negativePrompt: "no generic skyline",
        targets: [
          { channel: "meta", sizeNames: ["Feed square"] },
          { channel: "seo", sizeNames: ["Horizontal hero"] }
        ]
      }).success
    ).toBe(true);
  });

  it("rejects assignments with no target sizes", () => {
    expect(
      promptAssignmentSchema.safeParse({
        id: "prompt-empty",
        name: "Empty",
        prompt: "No targets",
        targets: [{ channel: "email_internal", sizeNames: [] }]
      }).success
    ).toBe(false);
  });
});

describe("reviewedPromptSchema", () => {
  it("accepts a final reviewed prompt for a specific asset", () => {
    expect(
      reviewedPromptSchema.safeParse({
        assetId: "meta_feed-square_1200x1200",
        channel: "meta",
        sizeName: "Feed square",
        prompt: "Final positive prompt",
        negativePrompt: "Final negatives",
        referenceImageUrls: ["https://fal.media/files/meta-reference.png"]
      }).success
    ).toBe(true);
  });
});

describe("creativeAdElementSchema", () => {
  it("accepts a selected ad element for creative-agent approval", () => {
    expect(
      creativeAdElementSchema.safeParse({
        id: "offer",
        label: "Offer / price",
        value: "from $99",
        source: "scrape",
        selected: true
      }).success
    ).toBe(true);
  });

  it("rejects an empty element value", () => {
    expect(
      creativeAdElementSchema.safeParse({
        id: "offer",
        label: "Offer / price",
        value: "",
        source: "scrape",
        selected: true
      }).success
    ).toBe(false);
  });
});

describe("creativeWorkspaceSchema", () => {
  it("accepts approved ad elements before creative concepts are generated", () => {
    expect(
      creativeWorkspaceSchema.safeParse({
        status: "elements_approved",
        messages: [],
        elementsApproved: true,
        referenceImageUrls: ["https://fal.media/files/property-reference.png"],
        adElements: [
          {
            id: "destination",
            label: "Destination",
            value: "Orlando",
            source: "scrape",
            selected: true
          }
        ]
      }).success
    ).toBe(true);
  });
});

describe("creativeConceptSchema", () => {
  it("accepts structured angle sections for display cards", () => {
    expect(
      creativeConceptSchema.safeParse({
        id: "concept-1",
        title: "Firework Price Stage",
        description: "A direct-response ad angle built around the offer.",
        heroVisual: "A patriotic sky glow above an Orlando pool scene.",
        adStructure: "Large price hierarchy with a concise headline.",
        approvedElementsUsed: ["Destination: Orlando", "Offer / price: from $99"],
        avoid: ["No logo", "No unapproved CTA"]
      }).success
    ).toBe(true);
  });
});

describe("channelSelectionSchema", () => {
  it("accepts a selected channel with explicit sizes", () => {
    expect(
      channelSelectionSchema.safeParse({
        channel: "meta",
        enabled: true,
        sizes: [
          {
            name: "Feed landscape",
            w: 1920,
            h: 1080,
            aspectLabel: "16:9"
          }
        ]
      }).success
    ).toBe(true);
  });

  it("rejects an unknown channel key", () => {
    expect(
      channelSelectionSchema.safeParse({
        channel: "print",
        enabled: true
      }).success
    ).toBe(false);
  });
});

describe("modelInfoSchema", () => {
  it("accepts fal.ai model metadata", () => {
    expect(modelInfoSchema.safeParse(validModel).success).toBe(true);
  });

  it("rejects an unsupported model kind", () => {
    expect(
      modelInfoSchema.safeParse({
        ...validModel,
        kind: "document"
      }).success
    ).toBe(false);
  });
});

describe("massEditRunRequestSchema", () => {
  it("accepts multiple independent mass-edit batches with quality and source dimensions", () => {
    expect(
      massEditRunRequestSchema.safeParse({
        projectId: "01HX0000000000000000000001",
        dryRun: true,
        batches: [
          {
            id: "remove-logo",
            name: "Remove logo",
            prompt: "Remove the logo and keep the resort photo natural.",
            modelId: "openai/gpt-image-2/edit",
            model: {
              id: "openai/gpt-image-2/edit",
              name: "GPT Image 2 Edit",
              kind: "image"
            },
            quality: "high",
            images: [
              {
                id: "image-1",
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
            prompt: "Add the supplied logo in the lower right corner.",
            modelId: "fal-ai/image-edit",
            model: {
              id: "fal-ai/image-edit",
              name: "Image Edit",
              kind: "image"
            },
            images: [
              {
                id: "image-2",
                name: "lobby.png",
                sourceUrl: "https://fal.media/files/lobby.png",
                width: 1920,
                height: 1080
              }
            ]
          }
        ]
      }).success
    ).toBe(true);
  });

  it("rejects a mass-edit batch without images", () => {
    expect(
      massEditRunRequestSchema.safeParse({
        projectId: "01HX0000000000000000000001",
        dryRun: true,
        batches: [
          {
            id: "empty-batch",
            name: "Empty batch",
            prompt: "Remove logos.",
            modelId: "openai/gpt-image-2/edit",
            model: {
              id: "openai/gpt-image-2/edit",
              name: "GPT Image 2 Edit",
              kind: "image"
            },
            images: []
          }
        ]
      }).success
    ).toBe(false);
  });
});

describe("runRequestSchema", () => {
  it("accepts a generation request and defaults dryRun to false", () => {
    const result = runRequestSchema.safeParse({
      brief: validBrief,
      channels: [{ channel: "meta", enabled: true }],
      models: {
        meta: {
          imageModelId: "fal-ai/flux-pro/v1.1-ultra"
        }
      }
    });

    expect(result.success).toBe(true);
    expect(result.success ? result.data.dryRun : undefined).toBe(false);
  });

  it("rejects a selected channel without an image model", () => {
    expect(
      runRequestSchema.safeParse({
        brief: validBrief,
        channels: [{ channel: "website", enabled: true }],
        models: {}
      }).success
    ).toBe(false);
  });
});

describe("assetResultSchema", () => {
  it("accepts an asset result with generation metadata", () => {
    expect(
      assetResultSchema.safeParse({
        assetId: "asset_01",
        runId: "01HX0000000000000000000000",
        channel: "seo",
        size: {
          name: "Horizontal hero",
          w: 800,
          h: 450,
          aspectLabel: "16:9"
        },
        status: "done",
        progress: 100,
        modelId: "fal-ai/flux-pro/v1.1-ultra",
        prompt: "Clean editorial resort photograph",
        seed: 12345,
        outputPath: "outputs/summer/01HX/final/seo/seo_hero_800x450_v1.jpg",
        thumbnailUrl: "/outputs/summer/01HX/final/seo/seo_hero_800x450_v1.jpg",
        costUsd: 0,
        textDetected: false,
        ocrConfidence: 0
      }).success
    ).toBe(true);
  });

  it("rejects impossible progress values", () => {
    expect(
      assetResultSchema.safeParse({
        assetId: "asset_01",
        runId: "01HX0000000000000000000000",
        channel: "seo",
        size: {
          name: "Horizontal hero",
          w: 800,
          h: 450,
          aspectLabel: "16:9"
        },
        status: "running",
        progress: 101,
        modelId: "fal-ai/flux-pro/v1.1-ultra",
        prompt: "Clean editorial resort photograph",
        seed: 12345
      }).success
    ).toBe(false);
  });
});

describe("costLogEntrySchema", () => {
  it("accepts a fal.ai cost log entry", () => {
    expect(
      costLogEntrySchema.safeParse({
        timestamp: "2026-05-20T20:00:00.000Z",
        runId: "01HX0000000000000000000000",
        assetId: "asset_01",
        channel: "meta",
        modelId: "fal-ai/flux-pro/v1.1-ultra",
        params: {
          image_size: "landscape_16_9",
          seed: 12345
        },
        reportedCostUsd: 0.06,
        dryRun: false,
        error: "fal.ai rejected the request"
      }).success
    ).toBe(true);
  });

  it("rejects negative reported cost", () => {
    expect(
      costLogEntrySchema.safeParse({
        timestamp: "2026-05-20T20:00:00.000Z",
        runId: "01HX0000000000000000000000",
        modelId: "fal-ai/flux-pro/v1.1-ultra",
        params: {},
        reportedCostUsd: -0.01
      }).success
    ).toBe(false);
  });
});
