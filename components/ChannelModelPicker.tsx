"use client";

import { channels, type ChannelKey } from "../src/config/channels";
import {
  defaultGptImage2Quality,
  gptImage2QualityValues,
  isGptImage2ModelId,
  type GptImage2Quality
} from "../src/models/image-options";
import { suggestDefaultModel } from "../src/models/router";
import type { ModelInfo } from "../src/schemas";
import type { ModelSelectionState } from "../src/lib/runs";
import { Button } from "./ui/button";
import { ModelCombobox } from "./ModelCombobox";

type ChannelModelPickerProps = {
  channel: ChannelKey;
  selectedSizeCount?: number;
  value?: ModelSelectionState;
  onChange: (value: ModelSelectionState) => void;
  catalog?: ModelInfo[];
  includesOnImageText?: boolean;
};

export function ChannelModelPicker({
  channel,
  selectedSizeCount,
  value = {},
  onChange,
  catalog = [],
  includesOnImageText = false
}: ChannelModelPickerProps) {
  const config = channels[channel];
  const conflict =
    !config.allowOnImageText &&
    value.imageModel?.capabilities?.supportsOnImageText === true &&
    value.forceNoTextMode !== true;
  const showGptImage2Quality = isGptImage2ModelId(value.imageModelId ?? value.imageModel?.id);

  function patch(update: Partial<ModelSelectionState>) {
    onChange({ ...value, ...update });
  }

  function suggest(kind: "image" | "video") {
    const model = suggestDefaultModel(channel, kind, catalog, { includesOnImageText });

    if (!model) {
      return;
    }

    if (kind === "image") {
      patch({
        imageModelId: model.id,
        imageModel: model,
        imageOptions: isGptImage2ModelId(model.id)
          ? { quality: value.imageOptions?.quality ?? defaultGptImage2Quality }
          : undefined,
        forceNoTextMode: false
      });
    } else {
      patch({ videoModelId: model.id, videoModel: model, generateVideo: true });
    }
  }

  return (
    <section className="rounded-md border bg-background p-4" data-conflict={conflict}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">{labelForChannel(channel)}</h2>
          <p className="text-sm text-muted-foreground">
            {config.uiBadge}
            {selectedSizeCount !== undefined ? ` · ${selectedSizeCount} selected size${selectedSizeCount === 1 ? "" : "s"}` : ""}
          </p>
        </div>
        <Button type="button" className="h-9" onClick={() => suggest("image")}>
          Suggest default
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <label className="text-sm font-medium">Image model</label>
          <ModelCombobox
            kind="image"
            value={value.imageModelId}
            selectedModel={value.imageModel}
            onChange={(modelId, model) =>
              patch({
                imageModelId: modelId,
                imageModel: model,
                imageOptions: isGptImage2ModelId(modelId)
                  ? { quality: value.imageOptions?.quality ?? defaultGptImage2Quality }
                  : undefined,
                forceNoTextMode: false
              })
            }
          />
          {showGptImage2Quality ? (
            <label className="block space-y-2 text-sm font-medium">
              <span>GPT Image 2 quality</span>
              <select
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={value.imageOptions?.quality ?? defaultGptImage2Quality}
                onChange={(event) =>
                  patch({
                    imageOptions: {
                      ...value.imageOptions,
                      quality: event.target.value as GptImage2Quality
                    }
                  })
                }
              >
                {gptImage2QualityValues.map((quality) => (
                  <option key={quality} value={quality}>
                    {quality}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
        <div className="space-y-3">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={value.generateVideo === true}
              onChange={(event) => patch({ generateVideo: event.target.checked })}
            />
            Generate video for this channel
          </label>
          {value.generateVideo ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <label className="text-sm font-medium">Video model</label>
                <button
                  type="button"
                  className="text-xs font-medium text-primary"
                  onClick={() => suggest("video")}
                >
                  Suggest video
                </button>
              </div>
              <ModelCombobox
                kind="video"
                value={value.videoModelId}
                selectedModel={value.videoModel}
                onChange={(modelId, model) => patch({ videoModelId: modelId, videoModel: model })}
              />
            </div>
          ) : null}
        </div>
      </div>

      {conflict ? (
        <div className="mt-4 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
          <p className="font-medium text-destructive">This model bakes text into images.</p>
          <p className="mt-1 text-muted-foreground">
            The selected channel forbids on-image text. Confirm strict no-text mode before
            continuing.
          </p>
          <label className="mt-3 flex items-center gap-2 font-medium">
            <input
              type="checkbox"
              aria-label="Yes, force no-text mode"
              checked={value.forceNoTextMode === true}
              onChange={(event) => patch({ forceNoTextMode: event.target.checked })}
            />
            Yes, force no-text mode
          </label>
          <p className="mt-2 text-xs font-medium text-destructive">Conflict unresolved</p>
        </div>
      ) : null}
    </section>
  );
}

function labelForChannel(channel: ChannelKey) {
  return channel
    .split("_")
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
}
