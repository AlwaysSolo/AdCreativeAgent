import Link from "next/link";

import { OpenFolderButton } from "../../../components/OpenFolderButton";
import { ResultsContactSheet } from "../../../components/ResultsContactSheet";
import { StartOverLink } from "../../../components/StartOverLink";
import { loadRunResults } from "../../../src/lib/results";

type ResultsPageProps = {
  params: {
    runId: string;
  };
};

export default async function ResultsPage({ params }: ResultsPageProps) {
  let results: Awaited<ReturnType<typeof loadRunResults>>;

  try {
    results = await loadRunResults(params.runId);
  } catch {
    return <PageMessage title="Run not found" message="Generate assets before opening results." />;
  }

  return (
    <main className="min-h-screen bg-background">
      <section className="mx-auto w-full max-w-7xl px-6 py-10">
        <div className="mb-8 border-b pb-6">
          <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            Step 8 of 8
          </p>
          <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-3xl font-semibold tracking-normal">Results</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
                Review generated assets by channel, then download individual files or ZIP bundles.
              </p>
              {results.run.destinationName ? (
                <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
                  Destination:{" "}
                  <span className="font-medium text-foreground">{results.run.destinationName}</span>
                </p>
              ) : null}
              <p className="mt-2 max-w-3xl break-all text-xs text-muted-foreground">
                Output folder: <code>{results.runDir}</code>
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <StartOverLink projectId={results.run.projectId} />
              <OpenFolderButton
                runId={results.run.runId}
                className="border bg-background text-foreground hover:bg-muted"
              />
              <a
                className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                href={results.allDownloadHref}
                download={results.allDownloadFileName}
              >
                Download all
              </a>
            </div>
          </div>
        </div>
        {results.groups.length > 0 ? (
          <ResultsContactSheet runId={results.run.runId} groups={results.groups} />
        ) : results.failures.length > 0 ? (
          <GenerationFailures failures={results.failures} />
        ) : (
          <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
            No final assets found for this run.
          </div>
        )}
      </section>
    </main>
  );
}

function GenerationFailures({
  failures
}: {
  failures: Awaited<ReturnType<typeof loadRunResults>>["failures"];
}) {
  return (
    <section className="rounded-md border border-destructive/40 bg-destructive/5 p-6">
      <h2 className="text-base font-semibold text-destructive">
        Generation failed before final assets were written.
      </h2>
      <div className="mt-4 space-y-3">
        {failures.map((failure) => (
          <article key={`${failure.assetId}:${failure.error}`} className="rounded-md border bg-background p-4">
            <p className="break-all text-sm font-medium">{failure.assetId}</p>
            <p className="mt-2 text-sm text-destructive">{failure.error}</p>
          </article>
        ))}
      </div>
    </section>
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
