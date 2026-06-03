"use client";

import { useEffect, useId, useMemo, useState } from "react";

import type { ModelInfo } from "../src/schemas";
import { Button } from "./ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from "./ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";

type ModelComboboxProps = {
  kind: "image" | "video";
  value?: string;
  selectedModel?: ModelInfo;
  onChange: (modelId: string, model: ModelInfo) => void;
  placeholder?: string;
};

const FILTER_TAGS = [
  "text-to-image",
  "image-to-image",
  "image-to-video",
  "photorealistic",
  "illustration",
  "supports-on-image-text",
  "fast",
  "premium"
];

export function ModelCombobox({
  kind,
  value,
  selectedModel,
  onChange,
  placeholder = "Select model"
}: ModelComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState<string | null>(null);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [manualEntryAvailable, setManualEntryAvailable] = useState(false);
  const [manualModelId, setManualModelId] = useState("");
  const [manualError, setManualError] = useState<string | null>(null);
  const [isValidatingManualModel, setIsValidatingManualModel] = useState(false);
  const manualInputId = useId();
  const selectedLabel = selectedModel?.name ?? value ?? placeholder;
  const requestUrl = useMemo(() => {
    const params = new URLSearchParams();

    params.set("kind", kind);
    if (query) {
      params.set("q", query);
    }
    if (tag) {
      params.append("tag", tag);
    }

    return `/api/models?${params.toString()}`;
  }, [kind, query, tag]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setIsLoading(true);
      try {
        const response = await fetch(requestUrl, { signal: controller.signal });
        const payload = (await response.json()) as {
          models?: ModelInfo[];
          manualEntryAvailable?: boolean;
          error?: string;
        };

        if (!response.ok) {
          setModels([]);
          setManualEntryAvailable(Boolean(payload.manualEntryAvailable));
          setManualError(payload.manualEntryAvailable ? null : payload.error ?? "Unable to load models.");
          return;
        }

        setModels(payload.models ?? []);
        setManualEntryAvailable(Boolean(payload.manualEntryAvailable));
        setManualError(null);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setModels([]);
          setManualEntryAvailable(true);
          setManualError(null);
        }
      } finally {
        setIsLoading(false);
      }
    }, 150);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [open, requestUrl]);

  async function handleManualModelSubmit() {
    setManualError(null);
    setIsValidatingManualModel(true);

    try {
      const response = await fetch("/api/models/validate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          modelId: manualModelId.trim(),
          kind,
          dryRun: true
        })
      });
      const payload = (await response.json()) as { model?: ModelInfo; error?: string };

      if (!response.ok || !payload.model) {
        throw new Error(payload.error ?? "Unable to validate model id.");
      }

      onChange(payload.model.id, payload.model);
      setOpen(false);
    } catch (error) {
      setManualError(error instanceof Error ? error.message : "Unable to validate model id.");
    } finally {
      setIsValidatingManualModel(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button className="w-full justify-between bg-secondary text-secondary-foreground hover:bg-secondary/80">
          <span className="truncate">{selectedLabel}</span>
          <span aria-hidden="true">⌄</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(42rem,calc(100vw-2rem))]">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder={`Search ${kind} models...`}
            value={query}
            onValueChange={setQuery}
          />
          <div className="flex flex-wrap gap-2 border-b p-2">
            <TagButton active={tag === null} onClick={() => setTag(null)}>
              All
            </TagButton>
            {FILTER_TAGS.map((filterTag) => (
              <TagButton
                key={filterTag}
                active={tag === filterTag}
                onClick={() => setTag(filterTag)}
              >
                {filterTag}
              </TagButton>
            ))}
          </div>
          <CommandList>
            <CommandEmpty>{isLoading ? "Loading models..." : "No models found."}</CommandEmpty>
            <CommandGroup heading="fal.ai models">
              {models.map((model) => (
                <CommandItem
                  key={model.id}
                  value={model.id}
                  onSelect={() => {
                    onChange(model.id, model);
                    setOpen(false);
                  }}
                >
                  <div className="flex w-full items-start gap-3">
                    {model.thumbnailUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={model.thumbnailUrl}
                        alt=""
                        className="h-12 w-16 rounded-sm object-cover"
                      />
                    ) : (
                      <div className="h-12 w-16 rounded-sm bg-muted" />
                    )}
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center justify-between gap-3">
                        <span className="truncate font-medium">{model.name}</span>
                        {model.pricing ? (
                          <span className="shrink-0 rounded-sm bg-muted px-2 py-1 text-xs">
                            ${model.pricing.amountUsd}/{model.pricing.unit}
                          </span>
                        ) : null}
                      </div>
                      <p className="truncate text-xs text-muted-foreground">{model.id}</p>
                      <div className="flex flex-wrap gap-1">
                        {(model.tags ?? []).slice(0, 5).map((modelTag) => (
                          <span key={modelTag} className="rounded-sm border px-1.5 py-0.5 text-[11px]">
                            {modelTag}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
        {manualEntryAvailable ? (
          <div className="mt-3 space-y-3 border-t pt-3">
            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor={manualInputId}>
                Enter model id
              </label>
              <input
                id={manualInputId}
                className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                placeholder="fal-ai/flux-pro/v1.1-ultra"
                value={manualModelId}
                onChange={(event) => setManualModelId(event.target.value)}
              />
            </div>
            {manualError ? <p className="text-sm font-medium text-destructive">{manualError}</p> : null}
            <Button
              className="w-full"
              disabled={!manualModelId.trim() || isValidatingManualModel}
              onClick={handleManualModelSubmit}
              type="button"
            >
              Use model id
            </Button>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

function TagButton({
  active,
  onClick,
  children
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={
        active
          ? "rounded-sm bg-primary px-2 py-1 text-xs text-primary-foreground"
          : "rounded-sm border px-2 py-1 text-xs text-muted-foreground"
      }
      onClick={onClick}
    >
      {children}
    </button>
  );
}
