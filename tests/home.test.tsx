import { rm } from "node:fs/promises";

import { render, screen } from "@testing-library/react";
import Home from "../app/page";
import ProjectPage from "../app/projects/[projectId]/page";
import { createProject, getProjectPath } from "../src/lib/projects";

describe("Home", () => {
  it("renders the project dashboard", async () => {
    render(await Home());

    expect(
      screen.getByRole("heading", { name: "Resort Ad Creative Generator" })
    ).toBeInTheDocument();
    expect(screen.getByLabelText("New project name")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create project" })).toBeInTheDocument();
  });

  it("renders the landing page URL input form inside a project", async () => {
    const project = await createProject("Home Test Project");

    try {
      render(await ProjectPage({ params: { projectId: project.projectId } }));

      expect(screen.getByRole("heading", { name: "Home Test Project" })).toBeInTheDocument();
      expect(screen.getByLabelText("Landing page URL")).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Scrape landing page" })
      ).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Mass edit images" })).toHaveAttribute(
        "href",
        `/projects/${project.projectId}/mass-edit`
      );
    } finally {
      await rm(getProjectPath(project.projectId), { force: true });
    }
  });
});
