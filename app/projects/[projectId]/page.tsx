import Link from "next/link";

import { UrlScrapeForm } from "../../../components/UrlScrapeForm";
import { readProject } from "../../../src/lib/projects";

type ProjectPageProps = {
  params: {
    projectId: string;
  };
};

export default async function ProjectPage({ params }: ProjectPageProps) {
  const project = await readProject(params.projectId);

  if (!project) {
    return <PageMessage title="Project not found" message="Create or select a project to continue." />;
  }

  return (
    <main className="min-h-screen bg-background">
      <section className="mx-auto flex min-h-screen w-full max-w-5xl flex-col justify-center px-6 py-16">
        <div className="max-w-2xl space-y-8">
          <div className="space-y-3">
            <Link
              className="text-sm font-medium text-primary underline-offset-4 hover:underline"
              href="/"
            >
              Back to projects
            </Link>
            <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
              Step 1 of 8
            </p>
            <h1 className="text-4xl font-semibold tracking-normal text-foreground">
              {project.name}
            </h1>
            <p className="max-w-xl text-base leading-7 text-muted-foreground">
              Paste a resort landing page URL to extract the campaign brief fields before
              creative generation. Assets from this run will be saved under this project.
            </p>
            <Link
              className="inline-flex h-10 items-center justify-center rounded-md border px-4 text-sm font-medium hover:bg-muted"
              href={`/projects/${encodeURIComponent(project.projectId)}/mass-edit`}
            >
              Mass edit images
            </Link>
          </div>
          <UrlScrapeForm projectId={project.projectId} />
        </div>
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
          Back to projects
        </Link>
      </div>
    </main>
  );
}
