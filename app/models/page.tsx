import Link from "next/link";

import { ModelSelectionForm } from "../../components/ModelSelectionForm";
import { readRun } from "../../src/lib/runs";

type ModelsPageProps = {
  searchParams?: {
    runId?: string;
  };
};

export default async function ModelsPage({ searchParams }: ModelsPageProps) {
  const runId = searchParams?.runId;

  if (!runId) {
    return <PageMessage title="Missing run" message="Start with a landing page URL." />;
  }

  const run = await readRun(runId);

  if (!run) {
    return <PageMessage title="Run not found" message="Start a new scrape to continue." />;
  }

  if (!run.selectedChannels || run.selectedChannels.length === 0) {
    return (
      <PageMessage
        title="No channels selected"
        message="Choose at least one channel before selecting models."
        href={`/channels?runId=${encodeURIComponent(run.runId)}`}
        cta="Back to channels"
      />
    );
  }

  return (
    <main className="min-h-screen bg-background">
      <section className="mx-auto w-full max-w-6xl px-6 py-10">
        <div className="mb-8 border-b pb-6">
          <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            Step 4 of 8
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-normal">Model Selection</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            Pick image models for every selected channel. Turn on Dry Run when you want to test without fal.ai calls.
          </p>
        </div>
        <ModelSelectionForm
          runId={run.runId}
          selectedChannels={run.selectedChannels}
          selectedChannelSizes={run.selectedChannelSizes}
          initialSelections={run.modelSelections}
          initialDryRun={run.dryRun ?? false}
          brief={run.brief}
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
