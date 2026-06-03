import type { ChannelSize } from "../config/channels";
import {
  defaultGptImage2Quality,
  isGptImage2ModelId,
  type GptImage2Quality
} from "../models/image-options";
import type { ModelInfo } from "../schemas";
import type { BuiltPrompt } from "./prompt-builder";

export type FalCustomImageSize = {
  width: number;
  height: number;
};

export function buildFalImageParams({
  prompt,
  size,
  model,
  quality,
  referenceImageUrls
}: {
  prompt: BuiltPrompt;
  size: ChannelSize;
  model: ModelInfo;
  quality?: GptImage2Quality;
  referenceImageUrls?: readonly string[];
}) {
  const params: Record<string, unknown> = {
    prompt: prompt.prompt,
    negative_prompt: prompt.negativePrompt,
    aspect_ratio: prompt.aspectRatio,
    image_size: customFalImageSizeForTarget(size)
  };
  const normalizedReferenceUrls = normalizeReferenceImageUrls(referenceImageUrls);

  if (normalizedReferenceUrls.length > 0) {
    params.image_urls = normalizedReferenceUrls;
  }

  if (isGptImage2ModelId(model.id)) {
    params.quality = quality ?? defaultGptImage2Quality;
  }

  return params;
}

export function customFalImageSizeForTarget(size: Pick<ChannelSize, "w" | "h">): FalCustomImageSize {
  const override = FAL_IMAGE_SIZE_OVERRIDES[`${size.w}x${size.h}`];

  if (override) {
    return override;
  }

  return {
    width: multipleOf16AtOrAbove(size.w),
    height: multipleOf16AtOrAbove(size.h)
  };
}

const FAL_IMAGE_SIZE_OVERRIDES: Record<string, { width: number; height: number }> = {
  "1080x1350": { width: 1088, height: 1360 },
  "1080x1920": { width: 1088, height: 1920 },
  "1200x1200": { width: 1200, height: 1200 },
  "1920x1080": { width: 1920, height: 1088 },
  "1400x600": { width: 1392, height: 592 },
  "1076x800": { width: 1072, height: 800 },
  "980x305": { width: 3840, height: 1280 },
  "800x310": { width: 1328, height: 512 },
  "800x450": { width: 1088, height: 608 },
  "950x270": { width: 3840, height: 1280 },
  "600x585": { width: 800, height: 832 },
  "420x420": { width: 1088, height: 1088 }
};

function multipleOf16AtOrAbove(value: number) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Image size must be a positive integer: ${value}`);
  }

  return Math.ceil(value / 16) * 16;
}

function normalizeReferenceImageUrls(urls: readonly string[] | undefined) {
  return Array.from(
    new Set((urls ?? []).map((url) => url.trim()).filter((url) => url.length > 0))
  );
}
