import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, vi } from "vitest";

import { ModelCombobox } from "../components/ModelCombobox";

describe("ModelCombobox manual fallback", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows manual model id entry when the catalog is unavailable with no cache", async () => {
    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url === "/api/models/validate") {
        return jsonResponse({
          model: {
            id: "fal-ai/private-resort-model",
            name: "fal-ai/private-resort-model",
            kind: "image",
            tags: ["manual-entry"]
          }
        });
      }

      return new Response(
        JSON.stringify({
          error: "Model catalog unavailable and no cache exists.",
          manualEntryAvailable: true
        }),
        {
          status: 503,
          headers: { "content-type": "application/json" }
        }
      );
    });
    const onChange = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    render(<ModelCombobox kind="image" onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: /select model/i }));

    const manualInput = await screen.findByLabelText("Enter model id");
    fireEvent.change(manualInput, { target: { value: "fal-ai/private-resort-model" } });
    fireEvent.click(screen.getByRole("button", { name: "Use model id" }));

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(
        "fal-ai/private-resort-model",
        expect.objectContaining({
          id: "fal-ai/private-resort-model",
          name: "fal-ai/private-resort-model",
          kind: "image"
        })
      );
    });
  });
});

function jsonResponse(payload: unknown) {
  return Promise.resolve(
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" }
    })
  );
}
