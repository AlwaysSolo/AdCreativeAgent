import Link from "next/link";

import { CreativeAngleLibrary } from "../../../components/CreativeAngleLibrary";
import { ProjectDocumentUploadForm } from "../../../components/ProjectDocumentUploadForm";
import { UrlScrapeForm } from "../../../components/UrlScrapeForm";
import { listCreativeAngles } from "../../../src/lib/creative-angles";
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

  const angles = await listCreativeAngles({ projectId: project.projectId });
  const angleGroups = groupAnglesByDestination(angles);

  return (
    <main className="min-h-screen bg-background">
      <section className="mx-auto w-full max-w-6xl px-6 py-12">
        <div className="space-y-8">
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
          <div className="grid gap-8 lg:grid-cols-[minmax(420px,0.9fr)_minmax(0,1.1fr)]">
            <div className="space-y-4 rounded-md border bg-background p-5">
              <h2 className="text-xl font-semibold">New destination run</h2>
              <div className="grid gap-5 xl:grid-cols-2">
                <section className="space-y-3 rounded-md border bg-muted/20 p-4">
                  <div>
                    <h3 className="text-sm font-semibold">Landing page</h3>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      Use this when the offer page is already live.
                    </p>
                  </div>
                  <UrlScrapeForm projectId={project.projectId} />
                </section>
                <section className="space-y-3 rounded-md border bg-muted/20 p-4">
                  <div>
                    <h3 className="text-sm font-semibold">Project document</h3>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      Use this when the campaign request arrives before the landing page.
                    </p>
                  </div>
                  <ProjectDocumentUploadForm projectId={project.projectId} />
                </section>
              </div>
            </div>
            <CreativeAngleLibrary
              projectId={project.projectId}
              angleGroups={angleGroups}
            />
          </div>
        </div>
      </section>
    </main>
  );
}

function groupAnglesByDestination(angles: Awaited<ReturnType<typeof listCreativeAngles>>) {
  const groups = new Map<
    string,
    {
      destinationSlug: string;
      destinationName: string;
      angles: typeof angles;
    }
  >();

  for (const angle of angles) {
    const existing = groups.get(angle.destinationSlug);

    if (existing) {
      existing.angles.push(angle);
      continue;
    }

    groups.set(angle.destinationSlug, {
      destinationSlug: angle.destinationSlug,
      destinationName: angle.destinationName ?? titleCase(angle.destinationSlug),
      angles: [angle]
    });
  }

  return [...groups.values()];
}

function titleCase(value: string) {
  return value
    .split("-")
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
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
