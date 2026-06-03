import { buildFalImageParams, customFalImageSizeForTarget } from "../src/generators/image-params";
import type { BuiltPrompt } from "../src/generators/prompt-builder";
import type { ModelInfo } from "../src/schemas";

const prompt: BuiltPrompt = {
  prompt: "Promotional resort creative",
  negativePrompt: "no artifacts",
  seed: 123,
  aspectRatio: "1:1"
};

const gptImage2Model: ModelInfo = {
  id: "openai/gpt-image-2",
  name: "GPT Image 2",
  kind: "image"
};

describe("fal image params", () => {
  it("uses explicit custom fal dimensions for known final target sizes", () => {
    expect(customFalImageSizeForTarget({ w: 1400, h: 600 })).toEqual({
      width: 1392,
      height: 592
    });
    expect(customFalImageSizeForTarget({ w: 1076, h: 800 })).toEqual({
      width: 1072,
      height: 800
    });
    expect(customFalImageSizeForTarget({ w: 980, h: 305 })).toEqual({
      width: 3840,
      height: 1280
    });
    expect(customFalImageSizeForTarget({ w: 800, h: 310 })).toEqual({
      width: 1328,
      height: 512
    });
    expect(customFalImageSizeForTarget({ w: 800, h: 450 })).toEqual({
      width: 1088,
      height: 608
    });
    expect(customFalImageSizeForTarget({ w: 950, h: 270 })).toEqual({
      width: 3840,
      height: 1280
    });
    expect(customFalImageSizeForTarget({ w: 600, h: 585 })).toEqual({
      width: 800,
      height: 832
    });
    expect(customFalImageSizeForTarget({ w: 420, h: 420 })).toEqual({
      width: 1088,
      height: 1088
    });
  });

  it("uses explicit Meta generation dimensions before final resize", () => {
    expect(customFalImageSizeForTarget({ w: 1080, h: 1350 })).toEqual({
      width: 1088,
      height: 1360
    });
    expect(customFalImageSizeForTarget({ w: 1080, h: 1920 })).toEqual({
      width: 1088,
      height: 1920
    });
    expect(customFalImageSizeForTarget({ w: 1200, h: 1200 })).toEqual({
      width: 1200,
      height: 1200
    });
    expect(customFalImageSizeForTarget({ w: 1920, h: 1080 })).toEqual({
      width: 1920,
      height: 1088
    });
  });

  it("uses custom image size with dimensions rounded up to multiples of 16", () => {
    expect(customFalImageSizeForTarget({ w: 1200, h: 628 })).toEqual({
      width: 1200,
      height: 640
    });
  });

  it("builds GPT Image 2 params with custom size and quality", () => {
    expect(
      buildFalImageParams({
        prompt,
        size: { name: "Feed square", w: 1200, h: 1200, aspectLabel: "1:1" },
        model: gptImage2Model,
        quality: "medium"
      })
    ).toMatchObject({
      prompt: prompt.prompt,
      negative_prompt: prompt.negativePrompt,
      aspect_ratio: "1:1",
      image_size: {
        width: 1200,
        height: 1200
      },
      quality: "medium"
    });
  });

  it("does not send legacy top-level custom width and height fields", () => {
    const params = buildFalImageParams({
      prompt,
      size: { name: "Feed square", w: 1200, h: 1200, aspectLabel: "1:1" },
      model: gptImage2Model,
      quality: "medium"
    });

    expect(params).not.toHaveProperty("width");
    expect(params).not.toHaveProperty("height");
  });

  it("passes reference image URLs through as image_urls", () => {
    expect(
      buildFalImageParams({
        prompt,
        size: { name: "Feed square", w: 1200, h: 1200, aspectLabel: "1:1" },
        model: gptImage2Model,
        referenceImageUrls: [
          "https://fal.media/files/reference-one.png",
          "https://fal.media/files/reference-two.png"
        ]
      })
    ).toMatchObject({
      image_urls: [
        "https://fal.media/files/reference-one.png",
        "https://fal.media/files/reference-two.png"
      ]
    });
  });
});
