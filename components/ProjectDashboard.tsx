"use client";

import Link from "next/link";
import { useState } from "react";

import type { ProjectState } from "../src/lib/projects";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

type ProjectDashboardProps = {
  projects: ProjectState[];
};

export function ProjectDashboard({ projects }: ProjectDashboardProps) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name })
      });

      if (!response.ok) {
        throw new Error(await readError(response, "Unable to create project."));
      }

      const payload = (await response.json()) as { project: ProjectState };
      window.location.assign(`/projects/${encodeURIComponent(payload.project.projectId)}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to create project.");
      setIsSubmitting(false);
    }
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(360px,0.7fr)]">
      <section className="space-y-4">
        <h2 className="text-xl font-semibold tracking-normal">Projects</h2>
        {projects.length > 0 ? (
          <div className="grid gap-3">
            {projects.map((project) => (
              <Link
                key={project.projectId}
                className="rounded-md border bg-background p-4 transition-colors hover:border-primary/60 hover:bg-muted/40"
                href={`/projects/${encodeURIComponent(project.projectId)}`}
              >
                <span className="block text-sm font-semibold">{project.name}</span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  {project.slug}
                </span>
              </Link>
            ))}
          </div>
        ) : (
          <div className="rounded-md border border-dashed p-8 text-sm text-muted-foreground">
            Create your first project to begin a creative run.
          </div>
        )}
      </section>

      <form className="space-y-4 rounded-md border bg-background p-5" onSubmit={handleSubmit}>
        <div className="space-y-2">
          <Label htmlFor="project-name">New project name</Label>
          <Input
            id="project-name"
            name="name"
            placeholder="July 4th Campaigns"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
          />
        </div>
        {error ? <p className="text-sm font-medium text-destructive">{error}</p> : null}
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Creating..." : "Create project"}
        </Button>
      </form>
    </div>
  );
}

async function readError(response: Response, fallback: string) {
  try {
    const payload = (await response.json()) as { error?: string };

    return payload.error ?? fallback;
  } catch {
    return fallback;
  }
}
