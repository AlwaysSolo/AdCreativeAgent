import { channels, type ChannelKey } from "../config/channels";
import type { ModelInfo } from "../schemas";

export type SuggestDefaultOptions = {
  includesOnImageText?: boolean;
};

export function suggestDefaultModel(
  channel: ChannelKey,
  kind: "image" | "video",
  catalog: readonly ModelInfo[] = [],
  options: SuggestDefaultOptions = {}
) {
  const channelConfig = channels[channel];
  const candidates = catalog.filter((model) => model.kind === kind);

  if (candidates.length === 0) {
    return null;
  }

  return candidates
    .map((model) => ({
      model,
      score: scoreDefaultModel(model, channel, kind, options)
    }))
    .sort(
      (left, right) =>
        right.score - left.score ||
        price(left.model) - price(right.model) ||
        left.model.id.localeCompare(right.model.id)
    )
    .find(({ model }) => {
      if (kind === "image" && channelConfig.allowOnImageText === false) {
        return model.capabilities?.supportsOnImageText !== true;
      }

      return true;
    })?.model ?? candidates[0];
}

function scoreDefaultModel(
  model: ModelInfo,
  channel: ChannelKey,
  kind: "image" | "video",
  options: SuggestDefaultOptions
) {
  const channelConfig = channels[channel];
  const tags = new Set(model.tags ?? []);
  let score = 0;

  if (kind === "image") {
    if (model.capabilities?.textToImage || tags.has("text-to-image")) {
      score += 20;
    }

    if (channelConfig.allowOnImageText && options.includesOnImageText) {
      score += model.capabilities?.supportsOnImageText ? 60 : 0;
    }

    if (!channelConfig.allowOnImageText) {
      score += model.capabilities?.supportsOnImageText ? -100 : 40;
      score += tags.has("photorealistic") ? 25 : 0;
    }
  }

  if (kind === "video") {
    score += model.capabilities?.imageToVideo || tags.has("image-to-video") ? 60 : 0;
    score += aspectMatchesChannel(model, channel) ? 20 : 0;
  }

  score += tags.has("fast") ? 5 : 0;
  score += tags.has("premium") ? 2 : 0;

  return score;
}

function aspectMatchesChannel(model: ModelInfo, channel: ChannelKey) {
  const supportedAspects = model.capabilities?.supportedAspects;

  if (!supportedAspects || supportedAspects.length === 0) {
    return false;
  }

  const normalized = new Set(supportedAspects.map((aspect) => aspect.replace(/^~/, "")));

  return channels[channel].sizes.some((size) =>
    normalized.has(size.aspectLabel.replace(/^~/, ""))
  );
}

function price(model: ModelInfo) {
  return model.pricing?.amountUsd ?? Number.MAX_SAFE_INTEGER;
}
