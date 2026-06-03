import { selectedSizesForChannel, type SelectedChannelSizes } from "../config/channels";
import type { ChannelKey, CreativeBrief, ModelInfo } from "../schemas";

export type EstimateModelSelection = {
  imageModel?: ModelInfo;
  videoModel?: ModelInfo;
  generateVideo?: boolean;
};

export type CostEstimateRequest = {
  brief: CreativeBrief;
  channels: ChannelKey[];
  selectedChannelSizes?: SelectedChannelSizes;
  models: Partial<Record<ChannelKey, EstimateModelSelection>>;
};

export type CostEstimateItem = {
  channel: ChannelKey;
  sizeCount: number;
  imageModelId?: string;
  videoModelId?: string;
  imageCostUsd: number;
  videoCostUsd: number;
  costUsd: number;
};

export type CostEstimate = {
  totalUsd: number;
  requiresCostConfirm: boolean;
  items: CostEstimateItem[];
  missingPricingModelIds: string[];
};

const COST_CONFIRM_THRESHOLD_USD = 5;

export function computeCostEstimate(request: CostEstimateRequest): CostEstimate {
  void request.brief;

  const missingPricingModelIds = new Set<string>();
  const items = request.channels.map((channel) => {
    const selection = request.models[channel] ?? {};
    const sizeCount = selectedSizesForChannel(channel, request.selectedChannelSizes).length;
    const imageCostUsd = costForModel(selection.imageModel, sizeCount, missingPricingModelIds);
    const videoCostUsd =
      selection.generateVideo === true
        ? costForModel(selection.videoModel, sizeCount, missingPricingModelIds)
        : 0;
    const costUsd = roundUsd(imageCostUsd + videoCostUsd);

    return {
      channel,
      sizeCount,
      imageModelId: selection.imageModel?.id,
      videoModelId: selection.generateVideo ? selection.videoModel?.id : undefined,
      imageCostUsd,
      videoCostUsd,
      costUsd
    };
  });
  const totalUsd = roundUsd(items.reduce((total, item) => total + item.costUsd, 0));

  return {
    totalUsd,
    requiresCostConfirm: totalUsd > COST_CONFIRM_THRESHOLD_USD,
    items,
    missingPricingModelIds: Array.from(missingPricingModelIds)
  };
}

function costForModel(
  model: ModelInfo | undefined,
  sizeCount: number,
  missingPricingModelIds: Set<string>
) {
  if (!model) {
    return 0;
  }

  if (!model.pricing) {
    missingPricingModelIds.add(model.id);
    return 0;
  }

  return roundUsd(model.pricing.amountUsd * sizeCount);
}

function roundUsd(value: number) {
  return Math.round(value * 100) / 100;
}
