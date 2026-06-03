"use client";

import { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";

import { gptImage2QualityValues, type GptImage2Quality } from "../src/models/image-options";
import type { MassEditBatch, MassEditInputImage, ModelInfo } from "../src/schemas";
import { ModelCombobox } from "./ModelCombobox";
import { OpenFolderButton } from "./OpenFolderButton";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";

type MassEditWorkspaceProps = {
  projectId: string;
  projectName: string;
};

type EditableBatch = {
  id: string;
  name: string;
  prompt: string;
  modelId: string;
  model?: ModelInfo;
  quality: GptImage2Quality;
  images: MassEditInputImage[];
  manualImageUrl: string;
  manualImageWidth: string;
  manualImageHeight: string;
  isUploading: boolean;
};

type MassEditEvent = {
  assetId: string;
  batchId: string;
  imageId: string;
  status: "queued" | "running" | "done" | "failed";
  progress: number;
  thumbnailUrl?: string;
  error?: string;
};

type StartMassEditPayload = {
  runId?: string;
  assetCount?: number;
  error?: string;
};

export function MassEditWorkspace({ projectId, projectName }: MassEditWorkspaceProps) {
  const [dryRun, setDryRun] = useState(true);
  const [batches, setBatches] = useState<EditableBatch[]>([createBatch(1)]);
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [assetCount, setAssetCount] = useState(0);
  const [eventsByAsset, setEventsByAsset] = useState<Record<string, MassEditEvent>>({});
  const events = useMemo(() => Object.values(eventsByAsset), [eventsByAsset]);
  const completedCount = events.filter(
    (event) => event.status === "done" || event.status === "failed"
  ).length;
  const isComplete = assetCount > 0 && completedCount >= assetCount;

  function addBatch() {
    setBatches((current) => [...current, createBatch(current.length + 1)]);
  }

  function removeBatch(id: string) {
    setBatches((current) => (current.length === 1 ? current : current.filter((batch) => batch.id !== id)));
  }

  function updateBatch(id: string, update: Partial<EditableBatch>) {
    setBatches((current) =>
      current.map((batch) =>
        batch.id === id
          ? {
              ...batch,
              ...update
            }
          : batch
      )
    );
  }

  function addManualImage(batchId: string) {
    setError(null);
    setBatches((current) =>
      current.map((batch) => {
        if (batch.id !== batchId) {
          return batch;
        }

        const width = Number.parseInt(batch.manualImageWidth, 10);
        const height = Number.parseInt(batch.manualImageHeight, 10);

        if (!batch.manualImageUrl.trim() || !Number.isInteger(width) || !Number.isInteger(height)) {
          setError("Add an image URL, width, and height before adding the image.");
          return batch;
        }

        return {
          ...batch,
          manualImageUrl: "",
          manualImageWidth: "",
          manualImageHeight: "",
          images: [
            ...batch.images,
            {
              id: uniqueId("image"),
              name: fileNameFromUrl(batch.manualImageUrl),
              sourceUrl: batch.manualImageUrl.trim(),
              width,
              height
            }
          ]
        };
      })
    );
  }

  function removeImage(batchId: string, imageId: string) {
    setBatches((current) =>
      current.map((batch) =>
        batch.id === batchId
          ? {
              ...batch,
              images: batch.images.filter((image) => image.id !== imageId)
            }
          : batch
      )
    );
  }

  async function uploadImages(batchId: string, files: FileList | null) {
    const selectedFiles = Array.from(files ?? []);

    if (selectedFiles.length === 0) {
      return;
    }

    updateBatch(batchId, { isUploading: true });
    setError(null);

    try {
      const uploadedImages: MassEditInputImage[] = [];

      for (const file of selectedFiles) {
        const dimensions = await imageDimensions(file);
        const formData = new FormData();
        formData.append("runId", projectId);
        formData.append("file", file);

        const response = await fetch("/api/reference-images", {
          method: "POST",
          body: formData
        });
        const payload = (await response.json().catch(() => ({}))) as {
          url?: string;
          error?: string;
        };

        if (!response.ok || !payload.url) {
          throw new Error(payload.error ?? "Unable to upload image.");
        }

        uploadedImages.push({
          id: uniqueId("image"),
          name: file.name,
          sourceUrl: payload.url,
          width: dimensions.width,
          height: dimensions.height
        });
      }

      setBatches((current) =>
        current.map((batch) =>
          batch.id === batchId
            ? {
                ...batch,
                images: [...batch.images, ...uploadedImages]
              }
            : batch
        )
      );
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Unable to upload images.");
    } finally {
      updateBatch(batchId, { isUploading: false });
    }
  }

  async function runMassEdit() {
    setError(null);
    setIsStarting(true);
    setEventsByAsset({});
    setActiveRunId(null);
    setAssetCount(0);

    try {
      const payloadBatches = normalizeBatches(batches);

      if (payloadBatches.length === 0) {
        throw new Error("Add at least one complete edit section with a prompt, model, and images.");
      }

      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/mass-edit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          dryRun,
          batches: payloadBatches
        })
      });
      const payload = (await response.json().catch(() => ({}))) as StartMassEditPayload;

      if (!response.ok || !payload.runId) {
        throw new Error(payload.error ?? "Unable to start mass edit.");
      }

      setActiveRunId(payload.runId);
      setAssetCount(payload.assetCount ?? 0);
      subscribeToRun(payload.runId);
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : "Unable to start mass edit.");
    } finally {
      setIsStarting(false);
    }
  }

  function subscribeToRun(runId: string) {
    const source = new EventSource(`/api/mass-edit/stream?runId=${encodeURIComponent(runId)}`);

    source.onmessage = (message) => {
      const event = JSON.parse(message.data) as MassEditEvent;

      setEventsByAsset((current) => ({
        ...current,
        [event.assetId]: event
      }));
    };
    source.onerror = () => {
      source.close();
    };
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-md border bg-muted/30 p-4">
        <div>
          <h2 className="text-base font-semibold">Mass edit workspace</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Upload images into independent edit sections, choose a model and quality, and run each
            section as its own batch inside {projectName}.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            checked={dryRun}
            onChange={(event) => setDryRun(event.target.checked)}
          />
          Dry Run
        </label>
      </div>

      <div className="space-y-5">
        {batches.map((batch, index) => (
          <section key={batch.id} className="rounded-md border bg-background p-5">
            <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">Edit section {index + 1}</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Images in this section share the same prompt, model, and quality.
                </p>
              </div>
              <Button
                type="button"
                className="border bg-background text-foreground hover:bg-muted"
                disabled={batches.length === 1}
                onClick={() => removeBatch(batch.id)}
              >
                <Trash2 aria-hidden="true" className="mr-2 h-4 w-4" />
                Remove section
              </Button>
            </div>

            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.7fr)]">
              <div className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="space-y-2 text-sm font-medium">
                    <span>Section name</span>
                    <Input
                      aria-label="Section name"
                      value={batch.name}
                      onChange={(event) => updateBatch(batch.id, { name: event.target.value })}
                    />
                  </label>
                  <label className="space-y-2 text-sm font-medium">
                    <span>Quality</span>
                    <select
                      aria-label="Quality"
                      className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                      value={batch.quality}
                      onChange={(event) =>
                        updateBatch(batch.id, { quality: event.target.value as GptImage2Quality })
                      }
                    >
                      {gptImage2QualityValues.map((quality) => (
                        <option key={quality} value={quality}>
                          {quality}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <label className="space-y-2 text-sm font-medium">
                  <span>Edit prompt</span>
                  <Textarea
                    aria-label="Edit prompt"
                    className="min-h-36 font-mono text-xs leading-5"
                    placeholder="Remove all visible logos while preserving the original image style, lighting, dimensions, and composition."
                    value={batch.prompt}
                    onChange={(event) => updateBatch(batch.id, { prompt: event.target.value })}
                  />
                </label>

                <div className="space-y-2">
                  <Label>Model</Label>
                  <ModelCombobox
                    kind="image"
                    value={batch.modelId}
                    selectedModel={batch.model}
                    placeholder="Select image edit model"
                    onChange={(modelId, model) => updateBatch(batch.id, { modelId, model })}
                  />
                  <div className="flex gap-2">
                    <Input
                      aria-label="Model id"
                      placeholder="openai/gpt-image-2/edit"
                      value={batch.modelId}
                      onChange={(event) => updateBatch(batch.id, { modelId: event.target.value })}
                    />
                    <Button
                      type="button"
                      className="shrink-0 border bg-background text-foreground hover:bg-muted"
                      onClick={() =>
                        updateBatch(batch.id, {
                          model: {
                            id: batch.modelId.trim(),
                            name: batch.modelId.trim(),
                            kind: "image",
                            capabilities: {
                              imageToImage: true
                            }
                          }
                        })
                      }
                      disabled={!batch.modelId.trim()}
                    >
                      Use manual model
                    </Button>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <label className="block space-y-2 text-sm font-medium">
                  <span>Upload images</span>
                  <Input
                    type="file"
                    accept="image/*"
                    multiple
                    disabled={batch.isUploading}
                    onChange={(event) => {
                      void uploadImages(batch.id, event.currentTarget.files);
                      event.currentTarget.value = "";
                    }}
                  />
                </label>
                <div className="rounded-md border p-3">
                  <p className="text-sm font-medium">Add image URL</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Use this for already-hosted fal storage URLs or tests. Width and height define
                    the final preserved dimensions.
                  </p>
                  <div className="mt-3 grid gap-2">
                    <Input
                      aria-label="Uploaded image URL"
                      placeholder="https://fal.media/files/example.png"
                      value={batch.manualImageUrl}
                      onChange={(event) =>
                        updateBatch(batch.id, { manualImageUrl: event.target.value })
                      }
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <Input
                        aria-label="Source width"
                        inputMode="numeric"
                        placeholder="1080"
                        value={batch.manualImageWidth}
                        onChange={(event) =>
                          updateBatch(batch.id, { manualImageWidth: event.target.value })
                        }
                      />
                      <Input
                        aria-label="Source height"
                        inputMode="numeric"
                        placeholder="1350"
                        value={batch.manualImageHeight}
                        onChange={(event) =>
                          updateBatch(batch.id, { manualImageHeight: event.target.value })
                        }
                      />
                    </div>
                    <Button
                      type="button"
                      className="border bg-background text-foreground hover:bg-muted"
                      onClick={() => addManualImage(batch.id)}
                    >
                      Add image URL
                    </Button>
                  </div>
                </div>

                {batch.images.length > 0 ? (
                  <ul className="space-y-2">
                    {batch.images.map((image) => (
                      <li
                        key={image.id}
                        className="flex items-start justify-between gap-3 rounded-md border px-3 py-2 text-xs"
                      >
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{image.name}</span>
                          <span className="block text-muted-foreground">
                            {image.width}x{image.height}
                          </span>
                          <span className="block break-all text-muted-foreground">
                            {image.sourceUrl}
                          </span>
                        </span>
                        <Button
                          type="button"
                          className="h-8 border bg-background px-2 text-xs text-foreground hover:bg-muted"
                          onClick={() => removeImage(batch.id, image.id)}
                        >
                          Remove
                        </Button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                    No images in this edit section yet.
                  </div>
                )}
                {batch.isUploading ? (
                  <p className="text-xs text-muted-foreground">Uploading images</p>
                ) : null}
              </div>
            </div>
          </section>
        ))}
      </div>

      <button
        type="button"
        className="flex min-h-24 w-full items-center justify-center rounded-md border border-dashed bg-background text-sm font-semibold text-primary hover:bg-muted/40"
        onClick={addBatch}
      >
        <Plus aria-hidden="true" className="mr-2 h-5 w-5" />
        Add edit section
      </button>

      {error ? <p className="text-sm font-medium text-destructive">{error}</p> : null}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-6">
        <div className="text-sm text-muted-foreground">
          {activeRunId ? (
            <span>
              Run {activeRunId}: {completedCount}/{assetCount} settled
            </span>
          ) : (
            <span>Mass edit is separate from the campaign wizard.</span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {activeRunId && isComplete ? (
            <OpenFolderButton
              runId={activeRunId}
              endpoint="/api/mass-edit/open-folder"
              label="Open mass edit folder"
              className="border bg-background text-foreground hover:bg-muted"
            />
          ) : null}
          <Button type="button" disabled={isStarting} onClick={runMassEdit}>
            {isStarting ? "Starting" : "Run mass edit"}
          </Button>
        </div>
      </div>

      {events.length > 0 ? (
        <section className="space-y-3 border-t pt-6" aria-label="Mass edit progress">
          <h2 className="text-lg font-semibold">Progress</h2>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {events.map((event) => (
              <article key={event.assetId} className="rounded-md border bg-background p-3">
                {event.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    alt={event.assetId}
                    className="mb-3 aspect-[4/3] w-full rounded-md object-cover"
                    src={event.thumbnailUrl}
                  />
                ) : null}
                <h3 className="break-all text-sm font-semibold">{event.assetId}</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  {event.status} · {event.progress}%
                </p>
                {event.error ? <p className="mt-2 text-xs font-medium text-destructive">{event.error}</p> : null}
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function normalizeBatches(batches: EditableBatch[]): MassEditBatch[] {
  const normalized: MassEditBatch[] = [];

  for (const batch of batches) {
    const model =
      batch.model ??
      (batch.modelId.trim()
        ? {
            id: batch.modelId.trim(),
            name: batch.modelId.trim(),
            kind: "image" as const,
            capabilities: {
              imageToImage: true
            }
          }
        : undefined);
    const prompt = batch.prompt.trim();

    if (!model || !prompt || batch.images.length === 0) {
      continue;
    }

    normalized.push({
      id: batch.id,
      name: batch.name.trim() || "Edit section",
      prompt,
      modelId: model.id,
      model,
      quality: batch.quality,
      images: batch.images
    });
  }

  return normalized;
}

function createBatch(index: number): EditableBatch {
  return {
    id: uniqueId("batch"),
    name: `Edit section ${index}`,
    prompt: "",
    modelId: "",
    quality: "high",
    images: [],
    manualImageUrl: "",
    manualImageWidth: "",
    manualImageHeight: "",
    isUploading: false
  };
}

async function imageDimensions(file: File) {
  if ("createImageBitmap" in window) {
    const bitmap = await createImageBitmap(file);
    const dimensions = {
      width: bitmap.width,
      height: bitmap.height
    };
    bitmap.close();

    return dimensions;
  }

  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve({
        width: image.naturalWidth,
        height: image.naturalHeight
      });
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Unable to read image dimensions."));
    };
    image.src = objectUrl;
  });
}

function fileNameFromUrl(url: string) {
  try {
    const parsed = new URL(url);
    const fileName = parsed.pathname.split("/").filter(Boolean).at(-1);

    return fileName || "uploaded-image.png";
  } catch {
    return "uploaded-image.png";
  }
}

function uniqueId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
