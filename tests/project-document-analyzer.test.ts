import { analyzeProjectDocument } from "../src/project-documents/analyzer";
import { createDocxFixtureBuffer } from "./utils/docx-fixture";

describe("project document analyzer", () => {
  it("extracts Step 2 brief fields from a Westgate project request DOCX", async () => {
    const buffer = await createDocxFixtureBuffer();

    const analysis = await analyzeProjectDocument(buffer, {
      fileName: "AquaGlow Campaign.docx"
    });

    expect(analysis.mediaCount).toBe(2);
    expect(analysis.brief).toMatchObject({
      resortName: "Westgate Resorts Orlando",
      headline: "AquaGlow Orlando Vacation Package",
      offer: "3 Nights + 4 AquaGlow tickets for $199",
      validDates: "May 15 to September",
      location: "Orlando",
      campaignName: "AquaGlow",
      targetAudience: expect.stringContaining("Parents (Ages 28–55) with children ages 3–15"),
      tone: "fun, family-friendly, energetic, neon",
      brandColors: ["#0e2545", "#c4a55d", "#d95d31", "#3892dc", "#148dd0"]
    });
    expect(analysis.brief.promotionSummary).toContain("Stay 4/3 + 4 Tickets to AquaGlow for $199");
    expect(analysis.brief.mustIncludeVisualElements).toEqual(
      expect.arrayContaining([
        "AquaGlow neon lights",
        "families enjoying the event",
        "resort relaxation by day and AquaGlow excitement by night"
      ])
    );
    expect(analysis.brief.mustAvoidElements).toEqual(
      expect.arrayContaining([
        "text or logos on Website concept-photo assets",
        "Westgate logo on Email Internal assets"
      ])
    );
  });
});
