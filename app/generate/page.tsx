import Link from "next/link";

import { LiveGeneratePanel } from "../../components/LiveGeneratePanel";
import { StartOverLink } from "../../components/StartOverLink";
import { selectedSizesForChannel } from "../../src/config/channels";
import { computeCostEstimate } from "../../src/lib/estimate";
import { readRun } from "../../src/lib/runs";

type GeneratePageProps = {
  searchParams?: {
    runId?: string;
  };
};

export default async function GeneratePage({ searchParams }: GeneratePageProps) {
  const runId = searchParams?.runId;

  if (!runId) {
    return <PageMessage title="Missing run" message="Start with a landing page URL." />;
  }

  const run = await readRun(runId);

  if (!run) {
    return <PageMessage title="Run not found" message="Start a new scrape to continue." />;
  }

  if (!run.brief || !run.selectedChannels || run.selectedChannels.length === 0) {
    return (
      <PageMessage
        title="Generation not ready"
        message="Complete the brief, channel selection, and model selection before generating."
        href={`/review?runId=${encodeURIComponent(run.runId)}`}
        cta="Back to review"
      />
    );
  }

  const missingModel = run.selectedChannels.some(
    (channel) => !run.modelSelections?.[channel]?.imageModel
  );

  if (missingModel) {
    return (
      <PageMessage
        title="Models missing"
        message="Select an image model for every channel before generating."
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
  const expectedAssetCount = run.selectedChannels.reduce(
    (total, channel) => total + selectedSizesForChannel(channel, run.selectedChannelSizes).length,
    0
  );

  return (
    <main className="min-h-screen bg-background">
      <section className="mx-auto w-full max-w-6xl px-6 py-10">
        <div className="mb-8 border-b pb-6">
          <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            Step 7 of 8
          </p>
          <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-3xl font-semibold tracking-normal">Generate</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
                Live job progress streams from the local generation runner.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-sm font-medium text-muted-foreground">
                {expectedAssetCount} assets queued
              </p>
              <StartOverLink projectId={run.projectId} />
            </div>
          </div>
        </div>
        <LiveGeneratePanel
          runId={run.runId}
          expectedAssetCount={expectedAssetCount}
          estimatedCostUsd={run.estimatedCostUsd ?? estimate.totalUsd}
        />
      </section>
    </main>
  );
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
