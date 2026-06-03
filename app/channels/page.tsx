import Link from "next/link";

import { ChannelSelectionForm } from "../../components/ChannelSelectionForm";
import { readRun } from "../../src/lib/runs";

type ChannelsPageProps = {
  searchParams?: {
    runId?: string;
  };
};

export default async function ChannelsPage({ searchParams }: ChannelsPageProps) {
  const runId = searchParams?.runId;

  if (!runId) {
    return <PageMessage title="Missing run" message="Start with a landing page URL." />;
  }

  const run = await readRun(runId);

  if (!run) {
    return <PageMessage title="Run not found" message="Start a new scrape to continue." />;
  }

  return (
    <main className="min-h-screen bg-background">
      <section className="mx-auto w-full max-w-6xl px-6 py-10">
        <div className="mb-8 border-b pb-6">
          <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            Step 3 of 8
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-normal">Channel Selection</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            Select the output channels for this campaign. Badges reflect whether overlays are
            allowed for that channel.
          </p>
        </div>
        <ChannelSelectionForm
          runId={run.runId}
          initialSelectedChannels={run.selectedChannels ?? []}
          initialSelectedChannelSizes={run.selectedChannelSizes}
        />
      </section>
    </main>
  );
}

function PageMessage({ title, message }: { title: string; message: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6">
      <div className="max-w-md space-y-4 text-center">
        <h1 className="text-2xl font-semibold">{title}</h1>
        <p className="text-sm text-muted-foreground">{message}</p>
        <Link className="text-sm font-medium text-primary underline-offset-4 hover:underline" href="/">
          Back to Step 1
        </Link>
      </div>
    </main>
  );
}
