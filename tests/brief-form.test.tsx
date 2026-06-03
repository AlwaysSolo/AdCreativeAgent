import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { vi } from "vitest";

import { BriefForm } from "../components/BriefForm";

const completeBrief = {
  resortName: "Westgate Lakes Resort & Spa",
  headline: "Save on Orlando villas",
  subheadline: "Spacious villas near the parks",
  offer: "Save 30%",
  validDates: "May 1 - June 30, 2026",
  ctaText: "Book Now",
  heroImageUrl: "https://example.com/hero.jpg",
  brandColors: ["#004f71"],
  location: "Orlando, FL"
};

describe("BriefForm", () => {
  it("flags empty critical fields and blocks continue", async () => {
    const onSaved = vi.fn();

    render(
      <BriefForm
        runId="01HX0000000000000000000000"
        initialBrief={{
          ...completeBrief,
          resortName: null,
          headline: null,
          offer: null
        }}
        onSaved={onSaved}
      />
    );

    expect(screen.getAllByText("Required before continuing")).toHaveLength(3);

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => {
      expect(screen.getByText("Resort name is required.")).toBeInTheDocument();
      expect(screen.getByText("Headline is required.")).toBeInTheDocument();
      expect(screen.getByText("Offer is required.")).toBeInTheDocument();
    });
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("submits edited brief values when critical fields are complete", async () => {
    const onSaved = vi.fn();

    render(
      <BriefForm
        runId="01HX0000000000000000000000"
        initialBrief={completeBrief}
        onSaved={onSaved}
      />
    );

    fireEvent.change(screen.getByLabelText("Campaign name"), {
      target: { value: "Summer Push" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledWith(
        expect.objectContaining({
          resortName: "Westgate Lakes Resort & Spa",
          campaignName: "Summer Push"
        })
      );
    });
  });
});
