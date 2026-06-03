import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { createProject, listProjects, readProject } from "../src/lib/projects";

describe("project persistence", () => {
  it("creates a project with a stable local slug and reads it back", async () => {
    const cacheDir = await mkdtemp(path.join(tmpdir(), "projects-"));

    try {
      const project = await createProject("Westgate Summer Campaigns", { cacheDir });
      const persisted = await readProject(project.projectId, { cacheDir });

      expect(project.projectId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
      expect(project.name).toBe("Westgate Summer Campaigns");
      expect(project.slug).toBe("westgate-summer-campaigns");
      expect(persisted).toEqual(project);
    } finally {
      await rm(cacheDir, { force: true, recursive: true });
    }
  });

  it("lists projects newest first", async () => {
    const cacheDir = await mkdtemp(path.join(tmpdir(), "projects-"));
    const firstDate = new Date("2026-05-21T12:00:00.000Z");
    const secondDate = new Date("2026-05-22T12:00:00.000Z");

    try {
      await createProject("First Project", { cacheDir, now: () => firstDate });
      await createProject("Second Project", { cacheDir, now: () => secondDate });

      expect((await listProjects({ cacheDir })).map((project) => project.name)).toEqual([
        "Second Project",
        "First Project"
      ]);
    } finally {
      await rm(cacheDir, { force: true, recursive: true });
    }
  });
});
