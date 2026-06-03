import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { vi } from "vitest";

import { ChannelSelectionForm } from "../components/ChannelSelectionForm";

describe("ChannelSelectionForm", () => {
  it("renders channel badges and submits selected channels", async () => {
    const onSaved = vi.fn();

    render(
      <ChannelSelectionForm
        runId="01HX0000000000000000000000"
        initialSelectedChannels={["meta"]}
        onSaved={onSaved}
      />
    );

    expect(screen.getAllByText("With overlays")).toHaveLength(2);
    expect(screen.getAllByText("Concept photo only — no text/logo")).toHaveLength(2);

    fireEvent.click(screen.getByLabelText("Website"));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledWith(
        ["meta", "website"],
        expect.objectContaining({
          meta: [
            "Feed portrait",
            "Stories/Reels",
            "Feed square",
            "Feed landscape"
          ],
          website: [
            "Hero wide",
            "Banner short",
            "Feature large",
            "Feature small",
            "Strip banner"
          ]
        })
      );
    });
  });

  it("allows selecting a single size within a selected channel", async () => {
    const onSaved = vi.fn();

    render(
      <ChannelSelectionForm
        runId="01HX0000000000000000000000"
        initialSelectedChannels={["meta"]}
        onSaved={onSaved}
      />
    );

    fireEvent.click(screen.getByLabelText("All sizes"));
    fireEvent.click(screen.getByLabelText("Meta Feed square 1200x1200"));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledWith(["meta"], { meta: ["Feed square"] });
    });
  });
});
