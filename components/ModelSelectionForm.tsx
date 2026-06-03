"use client";

import { useEffect, useMemo, useState } from "react";

import {
  channels,
  selectedSizesForChannel,
  type ChannelKey,
  type SelectedChannelSizes
} from "../src/config/channels";
import type { ModelSelectionState } from "../src/lib/runs";
import type { CreativeBrief, ModelInfo } from "../src/schemas";
import { Button } from "./ui/button";
import { ChannelModelPicker } from "./ChannelModelPicker";

type ModelSelectionFormProps = {
  runId: string;
  selectedChannels: ChannelKey[];
  selectedChannelSizes?: SelectedChannelSizes;
  initialSelections?: Partial<Record<ChannelKey, ModelSelectionState>>;
  initialDryRun?: boolean;
  brief?: CreativeBrief;
};

export function ModelSelectionForm({
  runId,
  selectedChannels,
  selectedChannelSizes,
  initialSelections = {},
  initialDryRun = false,
  brief
}: ModelSelectionFormProps) {
  const [dryRun, setDryRun] = useState(initialDryRun);
  const [selections, setSelections] =
    useState<Partial<Record<ChannelKey, ModelSelectionState>>>(initialSelections);
  const [catalog, setCatalog] = useState<ModelInfo[]>([]);
  const [estimate, setEstimate] = useState<{
    totalUsd: number;
    requiresCostConfirm: boolean;
    missingPricingModelIds: string[];
  }>({
    totalUsd: 0,
    requiresCostConfirm: false,
    missingPricingModelIds: []
  });
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const includesOnImageText = Boolean(brief?.headline || brief?.offer || brief?.ctaText);
  const conflicts = useMemo(() => unresolvedConflicts(selectedChannels, selections), [
    selectedChannels,
    selections
  ]);
  const missingImages = selectedChannels.filter((channel) => !selections[channel]?.imageModelId);
  const canContinue = missingImages.length === 0 && conflicts.length === 0;

  useEffect(() => {
    let mounted = true;

    async function loadCatalog() {
      try {
        const [imageResponse, videoResponse] = await Promise.all([
          fetch("/api/models?kind=image"),
          fetch("/api/models?kind=video")
        ]);
        const [imagePayload, videoPayload] = (await Promise.all([
          imageResponse.json(),
          videoResponse.json()
        ])) as Array<{ models?: ModelInfo[] }>;

        if (mounted) {
          setCatalog([...(imagePayload.models ?? []), ...(videoPayload.models ?? [])]);
        }
      } catch {
        if (mounted) {
          setCatalog([]);
        }
      }
    }

    void loadCatalog();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;

    async function estimateCost() {
      if (!brief || selectedChannels.length === 0) {
        if (mounted) {
          setEstimate({
            totalUsd: 0,
            requiresCostConfirm: false,
            missingPricingModelIds: []
          });
        }
        return;
      }

      try {
        const response = await fetch("/api/estimate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            brief,
            channels: selectedChannels,
            selectedChannelSizes,
            models: selections
          })
        });
        const payload = (await response.json()) as {
          totalUsd?: number;
          requiresCostConfirm?: boolean;
          missingPricingModelIds?: string[];
        };

        if (mounted) {
          setEstimate({
            totalUsd: payload.totalUsd ?? 0,
            requiresCostConfirm: payload.requiresCostConfirm ?? false,
            missingPricingModelIds: payload.missingPricingModelIds ?? []
          });
        }
      } catch {
        if (mounted) {
          setEstimate({
            totalUsd: 0,
            requiresCostConfirm: false,
            missingPricingModelIds: []
          });
        }
      }
    }

    void estimateCost();

    return () => {
      mounted = false;
    };
  }, [brief, selectedChannels, selectedChannelSizes, selections]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!canContinue) {
      setError("Resolve required models and channel conflicts before continuing.");
      return;
    }

    setError(null);
    setIsSubmitting(true);

    const response = await fetch(`/api/runs/${encodeURIComponent(runId)}/models`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        dryRun,
        selections,
        estimatedCostUsd: estimate.totalUsd,
        requiresCostConfirm: estimate.requiresCostConfirm
      })
    });

    if (!response.ok) {
      setError("Unable to save model selections.");
      setIsSubmitting(false);
      return;
    }

    window.location.assign(`/creative?runId=${encodeURIComponent(runId)}`);
  }

  return (
    <form className="space-y-6" onSubmit={handleSubmit}>
      <div className="sticky top-4 z-10 ml-auto w-fit rounded-md border bg-background px-4 py-3 text-right shadow-sm">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Estimated Cost
        </p>
        <p className="text-xl font-semibold">{formatUsd(estimate.totalUsd)}</p>
        {estimate.requiresCostConfirm ? (
          <p className="text-xs font-medium text-destructive">Confirm required above $5</p>
        ) : (
          <p className="text-xs text-muted-foreground">Dry Run can avoid spend</p>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-md border bg-muted/30 p-4">
        <div>
          <h2 className="text-sm font-semibold">Dry Run</h2>
          <p className="text-sm text-muted-foreground">Simulate generation without fal.ai calls.</p>
        </div>
        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            checked={dryRun}
            onChange={(event) => setDryRun(event.target.checked)}
          />
          Enabled
        </label>
      </div>

      <div className="space-y-4">
        {selectedChannels.map((channel) => (
          <ChannelModelPicker
            key={channel}
            channel={channel}
            selectedSizeCount={selectedSizesForChannel(channel, selectedChannelSizes).length}
            value={selections[channel]}
            catalog={catalog}
            includesOnImageText={includesOnImageText}
            onChange={(selection) =>
              setSelections((current) => ({ ...current, [channel]: selection }))
            }
          />
        ))}
      </div>

      {missingImages.length > 0 ? (
        <p className="text-sm font-medium text-destructive">
          Image model required for: {missingImages.map(labelForChannel).join(", ")}.
        </p>
      ) : null}
      {estimate.missingPricingModelIds.length > 0 ? (
        <p className="text-sm text-muted-foreground">
          Pricing unavailable for: {estimate.missingPricingModelIds.join(", ")}.
        </p>
      ) : null}
      {error ? <p className="text-sm font-medium text-destructive">{error}</p> : null}

      <div className="flex items-center justify-between border-t pt-5">
        <p className="text-sm text-muted-foreground">Step 4 of 8</p>
        <Button type="submit" disabled={!canContinue || isSubmitting}>
          Continue
        </Button>
      </div>
    </form>
  );
}

function formatUsd(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2
  }).format(value);
}

function unresolvedConflicts(
  selectedChannels: readonly ChannelKey[],
  selections: Partial<Record<ChannelKey, ModelSelectionState>>
) {
  return selectedChannels.filter((channel) => {
    const selection = selections[channel];

    return (
      channels[channel].allowOnImageText === false &&
      selection?.imageModel?.capabilities?.supportsOnImageText === true &&
      selection.forceNoTextMode !== true
    );
  });
}

function labelForChannel(channel: ChannelKey) {
  return channel
    .split("_")
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
}
