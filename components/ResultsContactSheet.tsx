"use client";

import { useState } from "react";

import { ModelCombobox } from "./ModelCombobox";
import { OpenFolderButton } from "./OpenFolderButton";
import { ReferenceImageUploader } from "./ReferenceImageUploader";
import { Button } from "./ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { Textarea } from "./ui/textarea";
import type { ChannelKey } from "../src/config/channels";
import type { ModelInfo } from "../src/schemas";

export type ResultsAsset = {
  assetId: string;
  channel: ChannelKey;
  sizeName: string;
  sizeLabel: string;
  modelId: string;
  model?: ModelInfo;
  seed: number;
  version: number;
  prompt: string;
  negativePrompt: string;
  referenceImageUrls: string[];
  imageUrl: string;
  downloadHref: string;
  downloadFileName: string;
};

export type ResultsGroup = {
  channel: ChannelKey;
  channelLabel: string;
  badge: string;
  downloadHref: string;
  downloadFileName: string;
  assets: ResultsAsset[];
};

type ResultsContactSheetProps = {
  runId: string;
  groups: ResultsGroup[];
};

export function ResultsContactSheet({ runId, groups }: ResultsContactSheetProps) {
  const [stateGroups, setStateGroups] = useState(groups);

  function updateAsset(updated: ResultsAsset) {
    setStateGroups((current) =>
      current.map((group) => ({
        ...group,
        assets: group.assets.map((asset) =>
          asset.assetId === updated.assetId ? { ...asset, ...updated } : asset
        )
      }))
    );
  }

  return (
    <div className="space-y-10">
      {stateGroups.map((group) => (
        <section key={group.channel} aria-label={group.channelLabel} className="space-y-5 border-t pt-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold">{group.channelLabel}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{group.badge}</p>
            </div>
            <a
              className="rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted"
              href={group.downloadHref}
              download={group.downloadFileName}
            >
              Download {group.channelLabel} ZIP
            </a>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {group.assets.map((asset) => (
              <article key={asset.assetId} className="rounded-md border bg-background p-4">
                <div className="aspect-[4/3] overflow-hidden rounded-md bg-muted">
                  <img
                    alt={asset.assetId}
                    className="h-full w-full object-cover"
                    src={asset.imageUrl}
                  />
                </div>
                <div className="mt-4 space-y-2">
                  <h3 className="text-sm font-semibold">{asset.sizeName}</h3>
                  <p className="text-xs text-muted-foreground">{asset.sizeLabel}</p>
                  <p className="break-all text-xs text-muted-foreground">{asset.modelId}</p>
                  <p className="text-xs font-medium">Seed {asset.seed}</p>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <RerollPopover runId={runId} asset={asset} onRerolled={updateAsset} />
                  <OpenFolderButton
                    runId={runId}
                    assetId={asset.assetId}
                    label="Open folder"
                    className="border bg-background px-3 text-foreground hover:bg-muted"
                  />
                  <a
                    className="inline-flex h-10 items-center justify-center rounded-md border px-3 text-sm font-medium hover:bg-muted"
                    href={asset.downloadHref}
                    download={asset.downloadFileName}
                  >
                    Download asset
                  </a>
                </div>
              </article>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function RerollPopover({
  runId,
  asset,
  onRerolled
}: {
  runId: string;
  asset: ResultsAsset;
  onRerolled: (asset: ResultsAsset) => void;
}) {
  const [modelId, setModelId] = useState(asset.modelId);
  const [model, setModel] = useState<ModelInfo | undefined>(asset.model);
  const [prompt, setPrompt] = useState(asset.prompt);
  const [negativePrompt, setNegativePrompt] = useState(asset.negativePrompt ?? "");
  const [referenceImageUrls, setReferenceImageUrls] = useState(asset.referenceImageUrls ?? []);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleReroll() {
    setIsRunning(true);
    setError(null);

    try {
      const response = await fetch("/api/reroll", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          runId,
          assetId: asset.assetId,
          modelId,
          prompt,
          negativePrompt,
          referenceImageUrls
        })
      });

      if (!response.ok) {
        throw new Error("Unable to re-roll asset.");
      }

      const payload = (await response.json()) as { asset: ResultsAsset };
      onRerolled(payload.asset);
    } catch (rerollError) {
      setError(rerollError instanceof Error ? rerollError.message : "Unable to re-roll asset.");
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button>Re-roll</Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(42rem,calc(100vw-2rem))] space-y-4">
        <label className="space-y-2 text-sm font-medium">
          <span>Re-roll prompt</span>
          <Textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            className="min-h-32 font-mono text-xs leading-5"
          />
        </label>
        <label className="space-y-2 text-sm font-medium">
          <span>Re-roll negative prompt</span>
          <Textarea
            value={negativePrompt}
            onChange={(event) => setNegativePrompt(event.target.value)}
            className="min-h-24 font-mono text-xs leading-5"
          />
        </label>
        <ReferenceImageUploader
          runId={runId}
          label="Reference images for re-roll"
          value={referenceImageUrls}
          onChange={setReferenceImageUrls}
        />
        <ModelCombobox
          kind="image"
          value={modelId}
          selectedModel={model}
          onChange={(nextModelId, nextModel) => {
            setModelId(nextModelId);
            setModel(nextModel);
          }}
        />
        {error ? <p className="text-sm font-medium text-destructive">{error}</p> : null}
        <Button disabled={isRunning} onClick={handleReroll}>
          Run re-roll
        </Button>
      </PopoverContent>
    </Popover>
  );
}
