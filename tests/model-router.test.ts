import { suggestDefaultModel } from "../src/models/router";
import type { ModelInfo } from "../src/schemas";

const models: ModelInfo[] = [
  {
    id: "fal-ai/ideogram/v3",
    name: "Ideogram v3",
    kind: "image",
    pricing: { unit: "image", amountUsd: 0.08 },
    capabilities: {
      supportsOnImageText: true,
      textToImage: true,
      supportedAspects: ["1:1", "16:9"]
    },
    tags: ["text-to-image", "supports-on-image-text"]
  },
  {
    id: "fal-ai/flux-pro/v1.1-ultra",
    name: "Flux Pro Ultra",
    kind: "image",
    pricing: { unit: "image", amountUsd: 0.06 },
    capabilities: {
      supportsOnImageText: false,
      textToImage: true,
      supportedAspects: ["1:1", "16:9", "9:16"]
    },
    tags: ["text-to-image", "photorealistic"]
  },
  {
    id: "fal-ai/kling-video/image-to-video",
    name: "Kling Image To Video",
    kind: "video",
    pricing: { unit: "second", amountUsd: 0.04 },
    capabilities: {
      imageToVideo: true,
      supportedAspects: ["16:9", "9:16"]
    },
    tags: ["image-to-video"]
  }
];

describe("suggestDefaultModel", () => {
  it("prefers text-capable image models only when the channel allows text and brief asks for it", () => {
    expect(
      suggestDefaultModel("meta", "image", models, {
        includesOnImageText: true
      })?.id
    ).toBe("fal-ai/ideogram/v3");
  });

  it("prefers photoreal no-text image models for no-text channels", () => {
    expect(suggestDefaultModel("website", "image", models)?.id).toBe(
      "fal-ai/flux-pro/v1.1-ultra"
    );
  });

  it("prefers image-to-video models for video defaults", () => {
    expect(suggestDefaultModel("meta", "video", models)?.id).toBe(
      "fal-ai/kling-video/image-to-video"
    );
  });
});
