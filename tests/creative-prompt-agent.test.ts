import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  buildCreativePromptAgentRequest,
  callCreativePromptAgent,
  readCreativePromptAgentInstructions
} from "../src/generators/creative-prompt-agent";
import { channels } from "../src/config/channels";
import type { CreativeBrief } from "../src/schemas";

const brief: CreativeBrief = {
  resortName: "Westgate Lakes Resort & Spa",
  headline: "Orlando 4th of July Vacation Package",
  offer: "from $99",
  subheadline: "Four days and three nights close to Orlando attractions",
  ctaText: "Book Now",
  brandColors: ["#0e2545", "#c4a55d"],
  location: "Orlando, FL",
  campaignName: "July 4th",
  promotionSummary: "Promote an Orlando Independence Day getaway.",
  targetAudience: "families",
  tone: "bold and cinematic",
  mustIncludeVisualElements: ["fireworks in the sky"],
  mustAvoidElements: ["parking lots"]
};

describe("creative prompt agent", () => {
  let tempDir: string;
  let instructionsPath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(process.cwd(), "cache", "creative-agent-"));
    instructionsPath = path.join(tempDir, "agent.md");
    await writeFile(
      instructionsPath,
      [
        "# AI Agent Instruction",
        "Concept Approval Step",
        "GOLDEN RULE",
        "Every prompt must be cinematic and photorealistic."
      ].join("\n"),
      "utf8"
    );
  });

  afterEach(async () => {
    await rm(tempDir, { force: true, recursive: true });
  });

  it("loads the markdown instruction file that drives the creative prompt agent", async () => {
    const instructions = await readCreativePromptAgentInstructions(instructionsPath);

    expect(instructions).toContain("Concept Approval Step");
    expect(instructions).toContain("GOLDEN RULE");
  });

  it("builds an OpenAI Responses request with the instruction file, run context, and references", async () => {
    const instructions = await readCreativePromptAgentInstructions(instructionsPath);
    const request = buildCreativePromptAgentRequest(
      {
        brief,
        channel: "meta",
        size: channels.meta.sizes[0],
        modelId: "openai/gpt-image-2",
        basePrompt: "Base reviewed prompt",
        negativePrompt: "no parking lots",
        referenceImageUrls: ["https://fal.media/files/property-reference.png"],
        mode: "prompt"
      },
      {
        instructions,
        model: "gpt-test-model"
      }
    );

    expect(request.model).toBe("gpt-test-model");
    expect(request.instructions).toContain("GOLDEN RULE");
    expect(request.instructions).toContain("Do not include brand marks");
    expect(JSON.stringify(request.input)).toContain("Orlando 4th of July Vacation Package");
    expect(JSON.stringify(request.input)).toContain("Base reviewed prompt");
    expect(JSON.stringify(request.input)).toContain("https://fal.media/files/property-reference.png");
  });

  it("calls OpenAI only through the server-side helper and returns output text", async () => {
    const fetchSpy = vi.fn(async () =>
      new Response(
        JSON.stringify({
          output: [
            {
              type: "message",
              content: [
                {
                  type: "output_text",
                  text: "Creative Director prompt"
                }
              ]
            }
          ]
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" }
        }
      )
    );

    const result = await callCreativePromptAgent(
      {
        brief,
        channel: "website",
        size: channels.website.sizes[0],
        modelId: "openai/gpt-image-2/edit",
        basePrompt: "Base website prompt",
        negativePrompt: "no text",
        referenceImageUrls: [],
        mode: "prompt"
      },
      {
        apiKey: "test-key",
        model: "gpt-test-model",
        instructionsPath,
        fetch: fetchSpy
      }
    );

    expect(result.text).toBe("Creative Director prompt");
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.openai.com/v1/responses",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer test-key"
        })
      })
    );
  });

  it("rejects follow-up blocks in final prompt mode so Review never receives questions", async () => {
    const fetchSpy = vi.fn(async () =>
      new Response(
        JSON.stringify({
          output_text:
            "FOLLOW_UP:\n- No reference image is attached. Please provide one before I write the prompt."
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" }
        }
      )
    );

    await expect(
      callCreativePromptAgent(
        {
          brief,
          channel: "meta",
          size: channels.meta.sizes[0],
          modelId: "openai/gpt-image-2",
          basePrompt: "Fallback Meta prompt",
          negativePrompt: "no brand marks",
          referenceImageUrls: [],
          mode: "prompt"
        },
        {
          apiKey: "test-key",
          model: "gpt-test-model",
          instructionsPath,
          fetch: fetchSpy
        }
      )
    ).rejects.toThrow("follow-up block");
  });
});
