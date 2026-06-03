import Link from "next/link";

import { CreativeDirectionChat } from "../../components/CreativeDirectionChat";
import { StartOverLink } from "../../components/StartOverLink";
import { deriveAdElementsFromRun } from "../../src/lib/creative-elements";
import { readRun } from "../../src/lib/runs";
import type { CreativeWorkspace } from "../../src/schemas";

type CreativePageProps = {
  searchParams?: {
    runId?: string;
  };
};

export default async function CreativePage({ searchParams }: CreativePageProps) {
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
        message="Complete the campaign brief before creative direction."
        href={`/brief?runId=${encodeURIComponent(run.runId)}`}
        cta="Back to brief"
      />
    );
  }

  if (!run.selectedChannels?.length) {
    return (
      <PageMessage
        title="No channels selected"
        message="Choose channels before creative direction."
        href={`/channels?runId=${encodeURIComponent(run.runId)}`}
        cta="Back to channels"
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
        message="Select an image model for every channel before creative direction."
        href={`/models?runId=${encodeURIComponent(run.runId)}`}
        cta="Back to models"
      />
    );
  }

  const suggestedAdElements = deriveAdElementsFromRun(run);
  const initialWorkspace: CreativeWorkspace = run.creativeWorkspace
    ? {
        ...run.creativeWorkspace,
        status:
          run.creativeWorkspace.adElements?.length || run.creativeWorkspace.status !== "not_started"
            ? run.creativeWorkspace.status
            : "elements_ready",
        adElements: run.creativeWorkspace.adElements ?? suggestedAdElements,
        elementsApproved: run.creativeWorkspace.elementsApproved ?? false
      }
    : {
        status: "elements_ready",
        messages: [],
        adElements: suggestedAdElements,
        elementsApproved: false
      };

  return (
    <main className="min-h-screen bg-background">
      <section className="mx-auto w-full max-w-6xl px-6 py-10">
        <div className="mb-8 border-b pb-6">
          <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            Step 5 of 8
          </p>
          <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-3xl font-semibold tracking-normal">Creative Direction</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
                Chat with the Creative Director agent, approve a campaign angle, then send the
                generated prompts into Review.
              </p>
            </div>
            <StartOverLink projectId={run.projectId} />
          </div>
        </div>
        <CreativeDirectionChat
          runId={run.runId}
          initialWorkspace={initialWorkspace}
          suggestedAdElements={suggestedAdElements}
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
