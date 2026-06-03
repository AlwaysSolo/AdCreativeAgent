import { ProjectDashboard } from "../components/ProjectDashboard";
import { listProjects } from "../src/lib/projects";

export default async function Home() {
  const projects = await listProjects();

  return (
    <main className="min-h-screen bg-background">
      <section className="mx-auto w-full max-w-6xl px-6 py-12">
        <div className="space-y-8">
          <div className="space-y-3">
            <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
              Projects
            </p>
            <h1 className="text-4xl font-semibold tracking-normal text-foreground">
              Resort Ad Creative Generator
            </h1>
            <p className="max-w-xl text-base leading-7 text-muted-foreground">
              Create a project or open an existing one before starting a creative run.
            </p>
          </div>
          <ProjectDashboard projects={projects} />
        </div>
      </section>
    </main>
  );
}
