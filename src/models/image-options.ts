export const gptImage2QualityValues = ["auto", "low", "medium", "high"] as const;

export type GptImage2Quality = (typeof gptImage2QualityValues)[number];

export const defaultGptImage2Quality: GptImage2Quality = "high";

export function isGptImage2ModelId(modelId: string | undefined) {
  return /(?:^|\/)gpt-image-2(?:$|\/)/.test(modelId ?? "");
}

