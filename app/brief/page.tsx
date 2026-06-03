import Link from "next/link";

import { BriefForm } from "../../components/BriefForm";
import { readRun } from "../../src/lib/runs";

type BriefPageProps = {
  searchParams?: {
    runId?: string;
  };
};

export default async function BriefPage({ searchParams }: BriefPageProps) {
  const runId = searchParams?.runId;

  if (!runId) {
    return <BriefPageMessage title="Missing run" message="Start with a landing page URL." />;
  }

  const run = await readRun(runId);

  if (!run) {
    return <BriefPageMessage title="Run not found" message="Start a new scrape to continue." />;
  }

  return (
    <main className="min-h-screen bg-background">
      <section className="mx-auto w-full max-w-6xl px-6 py-10">
        <div className="mb-8 flex flex-col gap-3 border-b pb-6">
          <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            Step 2 of 8
          </p>
          <h1 className="text-3xl font-semibold tracking-normal">Campaign Brief</h1>
          <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
            Review the scraped fields, fill any missing critical items, and edit the brief before
            choosing channels.
          </p>
          {run.destinationName ? (
            <p className="text-sm text-muted-foreground">
              Destination folder: <span className="font-medium text-foreground">{run.destinationName}</span>
            </p>
          ) : null}
        </div>
        <BriefForm runId={run.runId} initialBrief={run.brief ?? run.scrapedBrief} />
      </section>
    </main>
  );
}

function BriefPageMessage({ title, message }: { title: string; message: string }) {
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
