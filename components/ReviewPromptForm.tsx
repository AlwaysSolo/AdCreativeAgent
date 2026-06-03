"use client";

import { useMemo, useState } from "react";

import type { ChannelKey } from "../src/config/channels";
import { applyPromptAssignments } from "../src/generators/prompt-assignments";
import type { PromptAssignment } from "../src/schemas";
import { ReferenceImageUploader } from "./ReferenceImageUploader";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";

export type ReviewPromptItem = {
  id: string;
  assetId: string;
  channel: ChannelKey;
  channelLabel: string;
  channelBadge: string;
  sizeName: string;
  sizeLabel: string;
  modelId: string;
  modelOptionsLabel?: string;
  costUsd: number | null;
  prompt: string;
  negativePrompt: string;
  referenceImageUrls?: string[];
  seed: number;
  aspectRatio: string;
};

export type ReviewPromptTarget = {
  assetId: string;
  channel: ChannelKey;
  channelLabel: string;
  sizeName: string;
  sizeLabel: string;
};

type ReviewPromptFormProps = {
  runId: string;
  prompts: ReviewPromptItem[];
  promptAssignments?: PromptAssignment[];
  targets?: ReviewPromptTarget[];
  estimatedCostUsd: number;
  requiresCostConfirm: boolean;
  onGenerate?: (
    prompts: ReviewPromptItem[],
    promptAssignments: PromptAssignment[]
  ) => void | Promise<void>;
};

type PromptAgentResponse = {
  text?: unknown;
  error?: unknown;
};

export function ReviewPromptForm({
  runId,
  prompts,
  promptAssignments: initialPromptAssignments = [],
  targets = prompts.map((prompt) => ({
    assetId: prompt.assetId,
    channel: prompt.channel,
    channelLabel: prompt.channelLabel,
    sizeName: prompt.sizeName,
    sizeLabel: prompt.sizeLabel
  })),
  estimatedCostUsd,
  requiresCostConfirm,
  onGenerate
}: ReviewPromptFormProps) {
  const [promptAssignments, setPromptAssignments] = useState(initialPromptAssignments);
  const [manualPromptEdits, setManualPromptEdits] = useState<
    Record<
      string,
      Partial<Pick<ReviewPromptItem, "prompt" | "negativePrompt" | "referenceImageUrls">>
    >
  >({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [agentBusyByPrompt, setAgentBusyByPrompt] = useState<Record<string, boolean>>({});
  const [agentMessagesByPrompt, setAgentMessagesByPrompt] = useState<
    Record<string, { type: "success" | "error" | "followUp"; text: string }>
  >({});
  const activePromptAssignments = useMemo(
    () => normalizeAssignments(promptAssignments),
    [promptAssignments]
  );
  const editablePrompts = useMemo(
    () =>
      applyPromptAssignments(prompts, activePromptAssignments).map((item) => ({
        ...item,
        ...manualPromptEdits[item.id]
      })),
    [activePromptAssignments, manualPromptEdits, prompts]
  );
  const groups = useMemo(() => groupPrompts(editablePrompts), [editablePrompts]);

  function updatePrompt(id: string, field: "prompt" | "negativePrompt", value: string) {
    setManualPromptEdits((current) => ({
      ...current,
      [id]: {
        ...current[id],
        [field]: value
      }
    }));
  }

  function updatePromptReferenceImages(id: string, referenceImageUrls: string[]) {
    setManualPromptEdits((current) => ({
      ...current,
      [id]: {
        ...current[id],
        referenceImageUrls
      }
    }));
  }

  async function runCreativeAgent(item: ReviewPromptItem) {
    setAgentBusyByPrompt((current) => ({ ...current, [item.id]: true }));
    setAgentMessagesByPrompt((current) => {
      const next = { ...current };
      delete next[item.id];
      return next;
    });

    try {
      const response = await fetch("/api/prompt-agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          runId,
          channel: item.channel,
          sizeName: item.sizeName,
          modelId: item.modelId,
          prompt: item.prompt,
          negativePrompt: item.negativePrompt,
          referenceImageUrls: normalizeReferenceImageUrls(item.referenceImageUrls),
          mode: "prompt"
        })
      });
      const payload = (await response.json().catch(() => ({}))) as PromptAgentResponse;

      if (!response.ok) {
        throw new Error(
          typeof payload.error === "string" ? payload.error : "Creative agent failed."
        );
      }

      if (typeof payload.text !== "string" || !payload.text.trim()) {
        throw new Error("Creative agent returned no prompt text.");
      }

      const text = payload.text.trim();

      if (/^FOLLOW_UP:/i.test(text)) {
        setAgentMessagesByPrompt((current) => ({
          ...current,
          [item.id]: {
            type: "followUp",
            text
          }
        }));
        return;
      }

      updatePrompt(item.id, "prompt", text);
      setAgentMessagesByPrompt((current) => ({
        ...current,
        [item.id]: {
          type: "success",
          text: "Creative agent prompt applied."
        }
      }));
    } catch (error) {
      setAgentMessagesByPrompt((current) => ({
        ...current,
        [item.id]: {
          type: "error",
          text: error instanceof Error ? error.message : "Creative agent failed."
        }
      }));
    } finally {
      setAgentBusyByPrompt((current) => ({ ...current, [item.id]: false }));
    }
  }

  function addPromptAssignment() {
    const nextIndex = promptAssignments.length + 1;

    setPromptAssignments((current) => [
      ...current,
      {
        id: `prompt-${nextIndex}`,
        name: `Prompt ${nextIndex}`,
        prompt: "",
        referenceImageUrls: [],
        targets: []
      }
    ]);
  }

  function updateAssignment(
    id: string,
    field: "name" | "prompt" | "negativePrompt",
    value: string
  ) {
    setPromptAssignments((current) =>
      current.map((assignment) =>
        assignment.id === id
          ? {
              ...assignment,
              [field]: value
            }
          : assignment
      )
    );
  }

  function removeAssignment(id: string) {
    setPromptAssignments((current) => current.filter((assignment) => assignment.id !== id));
  }

  function updateAssignmentReferenceImages(id: string, referenceImageUrls: string[]) {
    setPromptAssignments((current) =>
      current.map((assignment) =>
        assignment.id === id
          ? {
              ...assignment,
              referenceImageUrls
            }
          : assignment
      )
    );
  }

  function toggleAssignmentTarget(assignmentId: string, target: ReviewPromptTarget) {
    setPromptAssignments((current) =>
      current.map((assignment) => {
        if (assignment.id !== assignmentId) {
          return assignment;
        }

        return {
          ...assignment,
          targets: toggleTarget(assignment.targets, target)
        };
      })
    );
  }

  async function handleGenerate() {
    if (
      requiresCostConfirm &&
      !window.confirm(
        `Estimated cost is ${formatUsd(estimatedCostUsd)}. Confirm you want to continue to Generate.`
      )
    ) {
      return;
    }

    if (onGenerate) {
      await onGenerate(editablePrompts, activePromptAssignments);
      return;
    }

    setSaveError(null);
    setIsSaving(true);

    try {
      const response = await fetch(`/api/runs/${encodeURIComponent(runId)}/prompts`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          promptAssignments: activePromptAssignments,
          reviewedPrompts: editablePrompts.map(toReviewedPrompt)
        })
      });

      if (!response.ok) {
        throw new Error("Unable to save reviewed prompts.");
      }

      window.location.assign(`/generate?runId=${encodeURIComponent(runId)}`);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Unable to save reviewed prompts.");
      setIsSaving(false);
    }
  }

  return (
    <div className="space-y-8">
      <div className="sticky top-4 z-10 ml-auto w-fit rounded-md border bg-background px-4 py-3 text-right shadow-sm">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Estimated cost
        </p>
        <p className="text-xl font-semibold">{formatUsd(estimatedCostUsd)}</p>
        {requiresCostConfirm ? (
          <p className="text-xs font-medium text-destructive">Cost confirmation required</p>
        ) : (
          <p className="text-xs text-muted-foreground">Dry Run can avoid spend</p>
        )}
      </div>

      <section className="space-y-4 border-t pt-6" aria-label="Prompt assignments">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold">Prompt assignments</h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
              Create creative directions once, then assign them to the channel sizes that should
              share that concept.
            </p>
          </div>
          <Button
            type="button"
            className="border bg-background text-foreground hover:bg-muted"
            onClick={addPromptAssignment}
          >
            Add prompt
          </Button>
        </div>

        {promptAssignments.length === 0 ? (
          <div className="rounded-md border border-dashed p-5 text-sm text-muted-foreground">
            No custom prompt assignments yet. The resolved prompts below will use the campaign
            brief, brand rules, channel rules, and model settings.
          </div>
        ) : (
          <div className="space-y-4">
            {promptAssignments.map((assignment) => (
              <article key={assignment.id} className="rounded-md border bg-background p-4">
                <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                  <label className="min-w-64 flex-1 space-y-2 text-sm font-medium">
                    <span>Prompt name</span>
                    <Input
                      value={assignment.name}
                      onChange={(event) =>
                        updateAssignment(assignment.id, "name", event.target.value)
                      }
                    />
                  </label>
                  <Button
                    type="button"
                    className="border bg-background text-foreground hover:bg-muted"
                    onClick={() => removeAssignment(assignment.id)}
                  >
                    Remove
                  </Button>
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  <label className="space-y-2 text-sm font-medium">
                    <span>Positive prompt</span>
                    <Textarea
                      value={assignment.prompt}
                      onChange={(event) =>
                        updateAssignment(assignment.id, "prompt", event.target.value)
                      }
                      className="min-h-32 font-mono text-xs leading-5"
                    />
                  </label>
                  <label className="space-y-2 text-sm font-medium">
                    <span>Optional negative prompt</span>
                    <Textarea
                      value={assignment.negativePrompt ?? ""}
                      onChange={(event) =>
                        updateAssignment(assignment.id, "negativePrompt", event.target.value)
                      }
                      className="min-h-32 font-mono text-xs leading-5"
                    />
                  </label>
                </div>

                <div className="mt-4">
                  <ReferenceImageUploader
                    runId={runId}
                    label={`Reference images for ${assignment.name || "custom prompt"}`}
                    value={assignment.referenceImageUrls ?? []}
                    onChange={(urls) => updateAssignmentReferenceImages(assignment.id, urls)}
                  />
                </div>

                <fieldset className="mt-4 space-y-3">
                  <legend className="text-sm font-medium">Assign to channel sizes</legend>
                  <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                    {targets.map((target) => (
                      <label
                        key={`${assignment.id}-${target.assetId}`}
                        className="flex items-start gap-3 rounded-md border px-3 py-2 text-sm"
                      >
                        <input
                          type="checkbox"
                          aria-label={`${target.channelLabel} ${target.sizeName}`}
                          checked={hasTarget(assignment, target)}
                          onChange={() => toggleAssignmentTarget(assignment.id, target)}
                          className="mt-1 h-4 w-4"
                        />
                        <span>
                          <span className="block font-medium">
                            {target.channelLabel} {target.sizeName}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {target.sizeLabel}
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              </article>
            ))}
          </div>
        )}
      </section>

      {groups.map((group) => (
        <section
          key={group.channel}
          aria-label={group.channelLabel}
          className="space-y-4 border-t pt-6"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold">{group.channelLabel}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{group.channelBadge}</p>
            </div>
            <p className="text-sm text-muted-foreground">{group.items.length} resolved prompts</p>
          </div>

          <div className="space-y-5">
            {group.items.map((item) => (
              <article key={item.id} className="rounded-md border bg-background p-4">
                <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-base font-semibold">{item.sizeName}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">{item.sizeLabel}</p>
                  </div>
                  <div className="text-right text-sm">
                    <p className="font-medium">{costLabel(item.costUsd)}</p>
                    <p className="mt-1 break-all text-muted-foreground">{item.modelId}</p>
                    {item.modelOptionsLabel ? (
                      <p className="mt-1 text-muted-foreground">{item.modelOptionsLabel}</p>
                    ) : null}
                    <Button
                      type="button"
                      aria-label={`Creative agent for ${item.channelLabel} ${item.sizeName}`}
                      className="mt-3 border bg-background text-foreground hover:bg-muted"
                      disabled={agentBusyByPrompt[item.id] === true}
                      onClick={() => void runCreativeAgent(item)}
                    >
                      {agentBusyByPrompt[item.id] ? "Thinking" : "Creative agent"}
                    </Button>
                  </div>
                </div>
                {agentMessagesByPrompt[item.id] ? (
                  <div
                    className={[
                      "mb-4 rounded-md border px-3 py-2 text-sm",
                      agentMessagesByPrompt[item.id].type === "error"
                        ? "border-destructive/40 text-destructive"
                        : "border-border text-muted-foreground"
                    ].join(" ")}
                  >
                    {agentMessagesByPrompt[item.id].text}
                  </div>
                ) : null}

                <div className="grid gap-4 lg:grid-cols-2">
                  <label className="space-y-2 text-sm font-medium">
                    <span>{`Prompt for ${item.channelLabel} ${item.sizeName}`}</span>
                    <Textarea
                      value={item.prompt}
                      onChange={(event) => updatePrompt(item.id, "prompt", event.target.value)}
                      className="min-h-44 font-mono text-xs leading-5"
                    />
                  </label>
                  <label className="space-y-2 text-sm font-medium">
                    <span>{`Negative prompt for ${item.channelLabel} ${item.sizeName}`}</span>
                    <Textarea
                      value={item.negativePrompt}
                      onChange={(event) =>
                        updatePrompt(item.id, "negativePrompt", event.target.value)
                      }
                      className="min-h-44 font-mono text-xs leading-5"
                    />
                  </label>
                </div>

                <div className="mt-4">
                  <ReferenceImageUploader
                    runId={runId}
                    label={`Reference images for ${item.channelLabel} ${item.sizeName}`}
                    value={item.referenceImageUrls ?? []}
                    onChange={(urls) => updatePromptReferenceImages(item.id, urls)}
                  />
                </div>

                <dl className="mt-4 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
                  <div>
                    <dt className="font-medium text-foreground">Seed</dt>
                    <dd>{item.seed}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-foreground">Aspect ratio</dt>
                    <dd>{item.aspectRatio}</dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>
        </section>
      ))}

      <div className="flex items-center justify-between border-t pt-6">
        <div>
          <p className="text-sm text-muted-foreground">Step 6 of 8</p>
          {saveError ? <p className="mt-1 text-sm font-medium text-destructive">{saveError}</p> : null}
        </div>
        <Button className="h-12 px-8 text-base" onClick={handleGenerate} disabled={isSaving}>
          {isSaving ? "Saving" : "Generate"}
        </Button>
      </div>
    </div>
  );
}

function normalizeAssignments(assignments: readonly PromptAssignment[]) {
  return assignments
    .map((assignment) => ({
      ...assignment,
      name: assignment.name.trim() || "Custom prompt",
      prompt: assignment.prompt.trim(),
      negativePrompt: assignment.negativePrompt?.trim() || undefined,
      referenceImageUrls: normalizeReferenceImageUrls(assignment.referenceImageUrls),
      targets: assignment.targets
        .map((target) => ({
          channel: target.channel,
          sizeNames: Array.from(new Set(target.sizeNames.filter(Boolean)))
        }))
        .filter((target) => target.sizeNames.length > 0)
    }))
    .filter((assignment) => assignment.prompt && assignment.targets.length > 0);
}

function hasTarget(assignment: PromptAssignment, target: ReviewPromptTarget) {
  return assignment.targets.some(
    (assignmentTarget) =>
      assignmentTarget.channel === target.channel &&
      assignmentTarget.sizeNames.includes(target.sizeName)
  );
}

function toggleTarget(
  targets: PromptAssignment["targets"],
  target: ReviewPromptTarget
): PromptAssignment["targets"] {
  const nextTargets = targets.map((assignmentTarget) => ({
    ...assignmentTarget,
    sizeNames: [...assignmentTarget.sizeNames]
  }));
  const channelTarget = nextTargets.find((item) => item.channel === target.channel);

  if (!channelTarget) {
    return [...nextTargets, { channel: target.channel, sizeNames: [target.sizeName] }];
  }

  if (channelTarget.sizeNames.includes(target.sizeName)) {
    channelTarget.sizeNames = channelTarget.sizeNames.filter(
      (sizeName) => sizeName !== target.sizeName
    );
  } else {
    channelTarget.sizeNames.push(target.sizeName);
  }

  return nextTargets.filter((item) => item.sizeNames.length > 0);
}

function toReviewedPrompt(item: ReviewPromptItem) {
  return {
    assetId: item.assetId,
    channel: item.channel,
    sizeName: item.sizeName,
    prompt: item.prompt,
    negativePrompt: item.negativePrompt,
    referenceImageUrls: normalizeReferenceImageUrls(item.referenceImageUrls)
  };
}

function groupPrompts(prompts: ReviewPromptItem[]) {
  const groups = new Map<
    ChannelKey,
    {
      channel: ChannelKey;
      channelLabel: string;
      channelBadge: string;
      items: ReviewPromptItem[];
    }
  >();

  for (const prompt of prompts) {
    const existing =
      groups.get(prompt.channel) ??
      {
        channel: prompt.channel,
        channelLabel: prompt.channelLabel,
        channelBadge: prompt.channelBadge,
        items: []
      };
    existing.items.push(prompt);
    groups.set(prompt.channel, existing);
  }

  return Array.from(groups.values());
}

function formatUsd(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2
  }).format(value);
}

function costLabel(value: number | null) {
  return value === null ? "Pricing unavailable" : formatUsd(value);
}

function normalizeReferenceImageUrls(urls: readonly string[] | undefined) {
  return Array.from(new Set((urls ?? []).map((url) => url.trim()).filter(Boolean)));
}
