import Link from "next/link";

import { MassEditWorkspace } from "../../../../components/MassEditWorkspace";
import { readProject } from "../../../../src/lib/projects";

type MassEditPageProps = {
  params: {
    projectId: string;
  };
};

export default async function MassEditPage({ params }: MassEditPageProps) {
  const project = await readProject(params.projectId);

  if (!project) {
    return <PageMessage title="Project not found" message="Create or select a project to continue." />;
  }

  return (
    <main className="min-h-screen bg-background">
      <section className="mx-auto w-full max-w-6xl px-6 py-10">
        <div className="mb-8 border-b pb-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Link
              className="text-sm font-medium text-primary underline-offset-4 hover:underline"
              href={`/projects/${encodeURIComponent(project.projectId)}`}
            >
              Back to project
            </Link>
            <Link
              className="text-sm font-medium text-primary underline-offset-4 hover:underline"
              href="/"
            >
              All projects
            </Link>
          </div>
          <p className="mt-6 text-sm font-medium uppercase tracking-wide text-muted-foreground">
            Project tool
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-normal">Mass Edit Images</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            Batch-edit uploaded images with separate prompts, models, qualities, and image groups.
            This tool is independent of the eight-step creative wizard.
          </p>
        </div>
        <MassEditWorkspace projectId={project.projectId} projectName={project.name} />
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
