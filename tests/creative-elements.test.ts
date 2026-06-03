import {
  deriveAdElementsFromRun,
  selectedAdElementsText
} from "../src/lib/creative-elements";
import type { RunState } from "../src/lib/runs";

describe("creative ad element derivation", () => {
  it("suggests selectable ad elements from the scraped and edited brief", () => {
    const run = {
      runId: "01HX0000000000000000000000",
      createdAt: "2026-05-28T12:00:00.000Z",
      updatedAt: "2026-05-28T12:00:00.000Z",
      destinationName: "Orlando",
      scrapedBrief: {
        resortName: "Westgate Lakes Resort & Spa",
        headline: "Orlando 4th of July Vacation Packages",
        subheadline: "Starting at $99, enjoy a 4-Day/3-Night stay near the parks.",
        offer: "from $99",
        validDates: null,
        ctaText: "Book Now",
        heroImageUrl: null,
        brandColors: ["#0e2545", "#c4a55d"],
        location: "Orlando, FL"
      },
      brief: {
        resortName: "Westgate Lakes Resort & Spa",
        headline: "Orlando 4th of July Vacation Packages",
        offer: "from $99",
        subheadline: "Starting at $99, enjoy a 4-Day/3-Night stay near the parks.",
        ctaText: "Book Now",
        brandColors: ["#0e2545", "#c4a55d"],
        location: "Orlando, FL",
        campaignName: "July 4th",
        promotionSummary: "Promote an Orlando Independence Day getaway for families.",
        targetAudience: "families",
        tone: "bold and cinematic",
        mustIncludeVisualElements: ["fireworks in the sky"],
        mustAvoidElements: ["parking lots"]
      }
    } satisfies RunState;

    const elements = deriveAdElementsFromRun(run);

    expect(elements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "destination", label: "Destination", value: "Orlando" }),
        expect.objectContaining({ id: "promotion", label: "Promotion / theme", value: "July 4th" }),
        expect.objectContaining({ id: "offer", label: "Offer / price", value: "from $99" }),
        expect.objectContaining({ id: "stay_length", label: "Stay length", value: "4 Days / 3 Nights" }),
        expect.objectContaining({ id: "cta", label: "CTA", value: "Book Now" })
      ])
    );
    expect(elements.every((element) => element.selected)).toBe(true);
  });

  it("summarizes only selected ad elements for the creative agent", () => {
    const summary = selectedAdElementsText([
      {
        id: "destination",
        label: "Destination",
        value: "Orlando",
        source: "scrape",
        selected: true
      },
      {
        id: "headline",
        label: "Headline",
        value: "Long scraped headline",
        source: "scrape",
        selected: false
      }
    ]);

    expect(summary).toContain("- Destination: Orlando");
    expect(summary).not.toContain("Long scraped headline");
  });
});
