import { rm } from "node:fs/promises";
import path from "node:path";

import { render, screen } from "@testing-library/react";

import ProjectPage from "../app/projects/[projectId]/page";
import { POST as createAngleRunPost } from "../app/api/projects/[projectId]/angles/[angleId]/runs/route";
import { saveCreativeAnglesForRun } from "../src/lib/creative-angles";
import { createProject, getProjectPath } from "../src/lib/projects";
import {
  createRun,
  getRunPath,
  readRun,
  updateRunBrief,
  updateRunChannels,
  updateRunModelSelections
} from "../src/lib/runs";
import type { CreativeBrief, CreativeConcept, ModelInfo } from "../src/schemas";

const brief: CreativeBrief = {
  resortName: "Westgate Lakes Resort & Spa",
  headline: "Orlando 4th of July Vacation Package",
  offer: "from $99",
  brandColors: ["#0e2545", "#c4a55d"],
  location: "Orlando, FL",
  campaignName: "July 4th",
  mustIncludeVisualElements: [],
  mustAvoidElements: []
};

const model: ModelInfo = {
  id: "openai/gpt-image-2",
  name: "GPT Image 2",
  kind: "image"
};

const concept: CreativeConcept = {
  id: "concept-1",
  title: "Fireworks Over Pool",
  description: "A patriotic poolside celebration angle with fireworks reflected in water.",
  heroVisual: "Blue-hour resort pool with red, white, and blue light in the sky.",
  adStructure: "Simple offer block and destination-led headline.",
  approvedElementsUsed: ["Destination: Orlando", "Offer / price: from $99"],
  avoid: ["No logo", "No brand name"]
};

describe("project creative angle library", () => {
  it("renders saved creative angles under their project destination", async () => {
    const fixture = await createSavedAngleFixture();

    try {
      render(await ProjectPage({ params: { projectId: fixture.projectId } }));

      expect(screen.getByRole("heading", { name: "Creative Angles" })).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Orlando" })).toBeInTheDocument();
      expect(screen.getByText("Fireworks Over Pool")).toBeInTheDocument();
      expect(screen.getByText("A patriotic poolside celebration angle with fireworks reflected in water."))
        .toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Generate from saved angle" }))
        .toBeInTheDocument();
    } finally {
      await fixture.cleanup();
    }
  });

  it("creates a new default-filled run from a saved creative angle", async () => {
    const fixture = await createSavedAngleFixture();

    try {
      const response = await createAngleRunPost(
        new Request(
          `http://localhost:3000/api/projects/${fixture.projectId}/angles/${fixture.angleId}/runs`,
          {
            method: "POST",
            body: JSON.stringify({ destinationSlug: "orlando" })
          }
        ),
        {
          params: {
            projectId: fixture.projectId,
            angleId: fixture.angleId
          }
        }
      );
      const payload = (await response.json()) as {
        runId: string;
        redirectHref: string;
      };
      const newRun = await readRun(payload.runId);

      expect(response.status).toBe(201);
      expect(payload.redirectHref).toBe(`/channels?runId=${payload.runId}`);
      expect(newRun).toMatchObject({
        creativeAngleId: fixture.angleId,
        creativeAngleTitle: "Fireworks Over Pool",
        selectedChannels: ["meta"],
        selectedChannelSizes: { meta: ["Feed square"] },
        modelSelections: {
          meta: {
            imageModelId: model.id,
            imageOptions: { quality: "medium" }
          }
        }
      });

      await rm(getRunPath(payload.runId), { force: true });
    } finally {
      await fixture.cleanup();
    }
  });
});

async function createSavedAngleFixture() {
  const project = await createProject("July 4th");
  const run = await createRun(
    {
      resortName: brief.resortName,
      headline: brief.headline,
      subheadline: null,
      offer: brief.offer,
      validDates: null,
      ctaText: null,
      heroImageUrl: null,
      brandColors: brief.brandColors,
      location: brief.location ?? null
    },
    {
      project,
      sourceUrl: "https://example.com/orlando-july-4th"
    }
  );

  await updateRunBrief(run.runId, brief);
  await updateRunChannels(run.runId, ["meta"], { meta: ["Feed square"] });
  await updateRunModelSelections(run.runId, {
    dryRun: false,
    estimatedCostUsd: 0.1,
    requiresCostConfirm: false,
    selections: {
      meta: {
        imageModelId: model.id,
        imageModel: model,
        imageOptions: { quality: "medium" }
      }
    }
  });

  const readyRun = await readRun(run.runId);

  if (!readyRun) {
    throw new Error("Expected ready run.");
  }

  const [angle] = await saveCreativeAnglesForRun(readyRun, [concept]);

  return {
    projectId: project.projectId,
    runId: run.runId,
    angleId: angle.angleId,
    cleanup: async () => {
      await rm(getProjectPath(project.projectId), { force: true });
      await rm(getRunPath(run.runId), { force: true });
      await rm(path.join(process.cwd(), "cache", "creative-angles", project.projectId), {
        force: true,
        recursive: true
      });
    }
  };
}
