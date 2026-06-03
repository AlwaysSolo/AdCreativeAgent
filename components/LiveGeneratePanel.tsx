"use client";

import { useEffect, useMemo, useState } from "react";

type LiveGeneratePanelProps = {
  runId: string;
  expectedAssetCount: number;
  estimatedCostUsd: number;
  onComplete?: (href: string) => void;
};

type GenerationEvent = {
  assetId: string;
  status: "queued" | "running" | "done" | "failed";
  progress: number;
  thumbnailUrl?: string;
  error?: string;
};

type AssetProgress = GenerationEvent & {
  updatedAt: number;
};

const TERMINAL_STATUSES = new Set<GenerationEvent["status"]>(["done", "failed"]);

export function LiveGeneratePanel({
  runId,
  expectedAssetCount,
  estimatedCostUsd,
  onComplete
}: LiveGeneratePanelProps) {
  const [assets, setAssets] = useState<Record<string, AssetProgress>>({});
  const [startError, setStartError] = useState<string | null>(null);
  const [started, setStarted] = useState(false);

  const assetList = useMemo(
    () => Object.values(assets).sort((a, b) => a.assetId.localeCompare(b.assetId)),
    [assets]
  );
  const settledCount = assetList.filter((asset) => TERMINAL_STATUSES.has(asset.status)).length;
  const completedCount = assetList.filter((asset) => asset.status === "done").length;
  const failedCount = assetList.filter((asset) => asset.status === "failed").length;
  const liveCost = expectedAssetCount > 0
    ? estimatedCostUsd * Math.min(settledCount, expectedAssetCount) / expectedAssetCount
    : 0;

  useEffect(() => {
    let active = true;
    let eventSource: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let receivedEvent = false;

    function handleMessage(event: MessageEvent<string>) {
      receivedEvent = true;
      const parsed = JSON.parse(event.data) as GenerationEvent;

      setAssets((current) => ({
        ...current,
        [parsed.assetId]: {
          ...current[parsed.assetId],
          ...parsed,
          updatedAt: Date.now()
        }
      }));
    }

    function clearReconnectTimer() {
      if (!reconnectTimer) {
        return;
      }

      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    function closeEventSource() {
      if (!eventSource) {
        return;
      }

      eventSource.removeEventListener("message", handleMessage);
      eventSource.close();
      eventSource = null;
    }

    function openEventStream() {
      closeEventSource();
      eventSource = new EventSource(
        `/api/generate/stream?runId=${encodeURIComponent(runId)}`
      );
      eventSource.addEventListener("message", handleMessage);
    }

    function scheduleEmptyStreamRecovery() {
      clearReconnectTimer();
      reconnectTimer = setTimeout(() => {
        if (!active || receivedEvent) {
          return;
        }

        openEventStream();
      }, 1500);
    }

    async function startGeneration() {
      try {
        const response = await fetch("/api/generate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ runId })
        });

        if (!response.ok) {
          throw new Error("Unable to start generation.");
        }

        if (active) {
          setStarted(true);
          openEventStream();
          scheduleEmptyStreamRecovery();
        }
      } catch (error) {
        if (active) {
          setStartError(error instanceof Error ? error.message : "Unable to start generation.");
        }
      }
    }

    void startGeneration();

    return () => {
      active = false;
      clearReconnectTimer();
      closeEventSource();
    };
  }, [runId]);

  useEffect(() => {
    if (expectedAssetCount <= 0 || settledCount < expectedAssetCount) {
      return;
    }

    const href = `/results/${encodeURIComponent(runId)}`;

    if (onComplete) {
      onComplete(href);
      return;
    }

    window.location.assign(href);
  }, [expectedAssetCount, onComplete, runId, settledCount]);

  return (
    <div className="space-y-6">
      <div className="sticky top-4 z-10 ml-auto w-fit rounded-md border bg-background px-4 py-3 text-right shadow-sm">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Live cost
        </p>
        <p className="text-xl font-semibold">
          {formatUsd(liveCost)} / {formatUsd(estimatedCostUsd)}
        </p>
        <p className="text-xs text-muted-foreground">
          {settledCount} of {expectedAssetCount} settled
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Metric label="Started" value={started ? "Yes" : "Starting"} />
        <Metric label="Done" value={String(completedCount)} />
        <Metric label="Failed" value={String(failedCount)} />
      </div>

      {startError ? <p className="text-sm font-medium text-destructive">{startError}</p> : null}

      {assetList.length === 0 ? (
        <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
          Waiting for generation events.
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {assetList.map((asset) => (
            <article key={asset.assetId} className="rounded-md border bg-background p-4">
              <div className="flex gap-4">
                <div className="flex h-24 w-32 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted text-xs text-muted-foreground">
                  {asset.thumbnailUrl ? (
                    <img
                      alt={`${asset.assetId} thumbnail`}
                      className="h-full w-full object-cover"
                      src={asset.thumbnailUrl}
                    />
                  ) : (
                    "No preview"
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="break-all text-sm font-semibold">{asset.assetId}</h2>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                    <span className="rounded-md border px-2 py-1 font-medium">{asset.status}</span>
                    <span className="text-muted-foreground">{asset.progress}%</span>
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full bg-primary transition-all"
                      style={{ width: `${Math.min(Math.max(asset.progress, 0), 100)}%` }}
                    />
                  </div>
                  {asset.error ? (
                    <p className="mt-3 text-sm font-medium text-destructive">{asset.error}</p>
                  ) : null}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-background p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
    </div>
  );
}

function formatUsd(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2
  }).format(value);
}
