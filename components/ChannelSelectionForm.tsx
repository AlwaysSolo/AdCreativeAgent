"use client";

import { useMemo, useState } from "react";

import {
  allSizeNamesForChannel,
  channels,
  defaultSelectedChannelSizes,
  selectedSizesForChannel,
  type ChannelKey,
  type SelectedChannelSizes
} from "../src/config/channels";
import { Button } from "./ui/button";

type ChannelSelectionFormProps = {
  runId: string;
  initialSelectedChannels?: ChannelKey[];
  initialSelectedChannelSizes?: SelectedChannelSizes;
  onSaved?: (
    selectedChannels: ChannelKey[],
    selectedChannelSizes: SelectedChannelSizes
  ) => void | Promise<void>;
};

const CHANNEL_ORDER = Object.keys(channels) as ChannelKey[];

export function ChannelSelectionForm({
  runId,
  initialSelectedChannels = [],
  initialSelectedChannelSizes,
  onSaved
}: ChannelSelectionFormProps) {
  const [selectedChannels, setSelectedChannels] = useState<ChannelKey[]>(initialSelectedChannels);
  const [selectedChannelSizes, setSelectedChannelSizes] = useState<SelectedChannelSizes>(() =>
    initialSelectedChannelSizes ?? defaultSelectedChannelSizes(initialSelectedChannels)
  );
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const selectedSet = useMemo(() => new Set(selectedChannels), [selectedChannels]);
  const selectedAssetCount = selectedChannels.reduce(
    (total, channel) => total + selectedSizesForChannel(channel, selectedChannelSizes).length,
    0
  );

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (selectedChannels.length === 0) {
      setError("Select at least one channel.");
      return;
    }

    const missingSizes = selectedChannels.filter(
      (channel) => selectedSizesForChannel(channel, selectedChannelSizes).length === 0
    );

    if (missingSizes.length > 0) {
      setError(`Select at least one size for: ${missingSizes.map(labelForChannel).join(", ")}.`);
      return;
    }

    setError(null);
    setIsSubmitting(true);

    if (onSaved) {
      await onSaved(selectedChannels, selectedChannelSizes);
      setIsSubmitting(false);
      return;
    }

    const response = await fetch(`/api/runs/${encodeURIComponent(runId)}/channels`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ selectedChannels, selectedChannelSizes })
    });

    if (!response.ok) {
      setError("Unable to save channel selections.");
      setIsSubmitting(false);
      return;
    }

    window.location.assign(`/models?runId=${encodeURIComponent(runId)}`);
  }

  function toggleChannel(channel: ChannelKey) {
    setSelectedChannels((current) => {
      if (current.includes(channel)) {
        setSelectedChannelSizes((sizes) => {
          const next = { ...sizes };

          delete next[channel];

          return next;
        });

        return current.filter((item) => item !== channel);
      }

      setSelectedChannelSizes((sizes) => ({
        ...sizes,
        [channel]: allSizeNamesForChannel(channel)
      }));

      return [...current, channel];
    });
  }

  function toggleSize(channel: ChannelKey, sizeName: string) {
    setSelectedChannelSizes((current) => {
      const existing = current[channel] ?? allSizeNamesForChannel(channel);
      const next = existing.includes(sizeName)
        ? existing.filter((item) => item !== sizeName)
        : [...existing, sizeName];

      return {
        ...current,
        [channel]: next
      };
    });
  }

  function setAllSizes(channel: ChannelKey, checked: boolean) {
    setSelectedChannelSizes((current) => ({
      ...current,
      [channel]: checked ? allSizeNamesForChannel(channel) : []
    }));
  }

  return (
    <form className="space-y-6" onSubmit={handleSubmit}>
      <div className="grid gap-4 md:grid-cols-2">
        {CHANNEL_ORDER.map((channel) => {
          const config = channels[channel];
          const checked = selectedSet.has(channel);
          const selectedSizes = selectedSizesForChannel(channel, selectedChannelSizes);
          const selectedSizeNames = new Set(selectedSizes.map((size) => size.name));
          const allSelected = selectedSizes.length === config.sizes.length;

          return (
            <article
              key={channel}
              className="rounded-md border bg-background p-4 transition-colors hover:border-primary/60"
            >
              <div className="flex items-start gap-3">
                <input
                  id={`channel-${channel}`}
                  type="checkbox"
                  className="mt-1 h-4 w-4"
                  checked={checked}
                  onChange={() => toggleChannel(channel)}
                  aria-label={labelForChannel(channel)}
                />
                <div className="min-w-0 flex-1 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label className="text-sm font-semibold" htmlFor={`channel-${channel}`}>
                      {labelForChannel(channel)}
                    </label>
                    <span className="rounded-sm border px-2 py-1 text-xs text-muted-foreground">
                      {config.uiBadge}
                    </span>
                  </div>
                  {checked ? (
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <p className="text-xs font-medium text-muted-foreground">
                          {selectedSizes.length} of {config.sizes.length} sizes selected
                        </p>
                        <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                          <input
                            type="checkbox"
                            checked={allSelected}
                            onChange={(event) => setAllSizes(channel, event.target.checked)}
                          />
                          All sizes
                        </label>
                      </div>
                      <div className="grid gap-2">
                        {config.sizes.map((size) => (
                          <label
                            key={`${channel}-${size.name}`}
                            className="flex items-center justify-between gap-3 rounded-sm bg-muted px-3 py-2 text-xs"
                          >
                            <span className="min-w-0">
                              <span className="font-medium text-foreground">{size.name}</span>
                              <span className="ml-2 text-muted-foreground">
                                {size.w}x{size.h} ({size.aspectLabel})
                              </span>
                            </span>
                            <input
                              type="checkbox"
                              checked={selectedSizeNames.has(size.name)}
                              onChange={() => toggleSize(channel, size.name)}
                              aria-label={`${labelForChannel(channel)} ${size.name} ${size.w}x${size.h}`}
                            />
                          </label>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {config.sizes.map((size) => (
                        <span
                          key={`${channel}-${size.name}`}
                          className="rounded-sm bg-muted px-2 py-1 text-xs text-muted-foreground"
                        >
                          {size.w}x{size.h}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </article>
          );
        })}
      </div>

      {error ? <p className="text-sm font-medium text-destructive">{error}</p> : null}

      <div className="flex items-center justify-between border-t pt-5">
        <p className="text-sm text-muted-foreground">
          Step 3 of 8 · {selectedAssetCount}{" "}
          {selectedAssetCount === 1 ? "size" : "sizes"} selected
        </p>
        <Button
          type="submit"
          disabled={isSubmitting || selectedChannels.length === 0 || selectedAssetCount === 0}
        >
          Continue
        </Button>
      </div>
    </form>
  );
}

function labelForChannel(channel: ChannelKey) {
  return channel
    .split("_")
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
}
