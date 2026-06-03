import Link from "next/link";

import {
  ReviewPromptForm,
  type ReviewPromptItem,
  type ReviewPromptTarget
} from "../../components/ReviewPromptForm";
import { StartOverLink } from "../../components/StartOverLink";
import {
  channels,
  selectedSizesForChannel,
  type ChannelKey,
  type ChannelSize,
  type SelectedChannelSizes
} from "../../src/config/channels";
import { buildPrompt } from "../../src/generators/prompt-builder";
import { computeCostEstimate } from "../../src/lib/estimate";
import { readRun, type ModelSelectionState } from "../../src/lib/runs";
import { isGptImage2ModelId } from "../../src/models/image-options";
import type { CreativeBrief, ReviewedPrompt } from "../../src/schemas";

type ReviewPageProps = {
  searchParams?: {
    runId?: string;
  };
};

export default async function ReviewPage({ searchParams }: ReviewPageProps) {
  const runId = searchParams?.runId;

  if (!runId) {
    return <PageMessage title="Missing run" message="Start with a landing page URL." />;
  }

  const run = await readRun(runId);

  if (!run) {
    return <PageMessage title="Run not found" message="Start a new scrape to continue." />;
  }

  if (!run.brief) {
    return (
      <PageMessage
        title="Brief missing"
        message="Complete the campaign brief before reviewing prompts."
        href={`/brief?runId=${encodeURIComponent(run.runId)}`}
        cta="Back to brief"
      />
    );
  }

  if (!run.selectedChannels || run.selectedChannels.length === 0) {
    return (
      <PageMessage
        title="No channels selected"
        message="Choose channels before reviewing prompts."
        href={`/channels?runId=${encodeURIComponent(run.runId)}`}
        cta="Back to channels"
      />
    );
  }

  const missingModelChannel = run.selectedChannels.find(
    (channel) => !run.modelSelections?.[channel]?.imageModel
  );

  if (missingModelChannel) {
    return (
      <PageMessage
        title="Models missing"
        message="Select an image model for every channel before reviewing prompts."
        href={`/models?runId=${encodeURIComponent(run.runId)}`}
        cta="Back to models"
      />
    );
  }

  const estimate = computeCostEstimate({
    brief: run.brief,
    channels: run.selectedChannels,
    selectedChannelSizes: run.selectedChannelSizes,
    models: run.modelSelections ?? {}
  });
  const prompts = await buildReviewPrompts({
    brief: run.brief,
    selectedChannels: run.selectedChannels,
    selectedChannelSizes: run.selectedChannelSizes,
    modelSelections: run.modelSelections ?? {},
    reviewedPrompts: run.reviewedPrompts ?? run.creativeWorkspace?.generatedPrompts
  });

  return (
    <main className="min-h-screen bg-background">
      <section className="mx-auto w-full max-w-6xl px-6 py-10">
        <div className="mb-8 border-b pb-6">
          <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            Step 6 of 8
          </p>
          <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-3xl font-semibold tracking-normal">Review</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
                Review resolved prompts, model choices, channel sizes, and spend before generation.
              </p>
            </div>
            <StartOverLink projectId={run.projectId} />
          </div>
        </div>
        <ReviewPromptForm
          runId={run.runId}
          prompts={prompts}
          promptAssignments={run.promptAssignments ?? []}
          targets={targetsFromPrompts(prompts)}
          estimatedCostUsd={run.estimatedCostUsd ?? estimate.totalUsd}
          requiresCostConfirm={run.requiresCostConfirm ?? estimate.requiresCostConfirm}
        />
      </section>
    </main>
  );
}

async function buildReviewPrompts({
  brief,
  selectedChannels,
  selectedChannelSizes,
  modelSelections,
  reviewedPrompts
}: {
  brief: CreativeBrief;
  selectedChannels: ChannelKey[];
  selectedChannelSizes?: SelectedChannelSizes;
  modelSelections: Partial<Record<ChannelKey, ModelSelectionState>>;
  reviewedPrompts?: ReviewedPrompt[];
}) {
  const prompts: ReviewPromptItem[] = [];

  for (const channel of selectedChannels) {
    const selection = modelSelections[channel];

    if (!selection?.imageModel) {
      continue;
    }

    for (const size of selectedSizesForChannel(channel, selectedChannelSizes)) {
      const assetId = assetIdFor(channel, size);
      const builtPrompt = await buildPrompt({
        brief,
        channel,
        size,
        model: selection.imageModel
      });
      const reviewedPrompt = reviewedPrompts?.find(
        (prompt) =>
          prompt.assetId === assetId ||
          (prompt.channel === channel && prompt.sizeName === size.name)
      );

      prompts.push({
        id: assetId,
        assetId,
        channel,
        channelLabel: labelForChannel(channel),
        channelBadge: channels[channel].uiBadge,
        sizeName: size.name,
        sizeLabel: `${size.w}x${size.h} (${size.aspectLabel})`,
        modelId: selection.imageModel.id,
        modelOptionsLabel: modelOptionsLabel(selection),
        costUsd: selection.imageModel.pricing?.amountUsd ?? null,
        prompt: reviewedPrompt?.prompt ?? builtPrompt.prompt,
        negativePrompt: reviewedPrompt?.negativePrompt ?? builtPrompt.negativePrompt,
        referenceImageUrls: reviewedPrompt?.referenceImageUrls ?? [],
        seed: builtPrompt.seed,
        aspectRatio: builtPrompt.aspectRatio
      });
    }
  }

  return prompts;
}

function modelOptionsLabel(selection: ModelSelectionState) {
  if (!selection.imageModel || !isGptImage2ModelId(selection.imageModel.id)) {
    return undefined;
  }

  return `Quality: ${selection.imageOptions?.quality ?? "high"}`;
}

function targetsFromPrompts(prompts: ReviewPromptItem[]): ReviewPromptTarget[] {
  return prompts.map((prompt) => ({
    assetId: prompt.assetId,
    channel: prompt.channel,
    channelLabel: prompt.channelLabel,
    sizeName: prompt.sizeName,
    sizeLabel: prompt.sizeLabel
  }));
}

function PageMessage({
  title,
  message,
  href = "/",
  cta = "Back to Step 1"
}: {
  title: string;
  message: string;
  href?: string;
  cta?: string;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6">
      <div className="max-w-md space-y-4 text-center">
        <h1 className="text-2xl font-semibold">{title}</h1>
        <p className="text-sm text-muted-foreground">{message}</p>
        <Link className="text-sm font-medium text-primary underline-offset-4 hover:underline" href={href}>
          {cta}
        </Link>
      </div>
    </main>
  );
}

function labelForChannel(channel: ChannelKey) {
  return channel
    .split("_")
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
}

function slugForSize(size: ChannelSize) {
  return `${safeSegment(size.name)}_${size.w}x${size.h}`;
}

function assetIdFor(channel: ChannelKey, size: ChannelSize) {
  return `${channel}_${slugForSize(size)}`;
}

function safeSegment(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}
