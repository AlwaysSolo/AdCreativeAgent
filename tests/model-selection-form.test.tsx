import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, vi } from "vitest";

import { ModelSelectionForm } from "../components/ModelSelectionForm";

describe("ModelSelectionForm cost meter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("leaves Dry Run off by default unless it is explicitly enabled", () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ models: [] })));

    render(
      <ModelSelectionForm
        runId="01HX0000000000000000000000"
        selectedChannels={["meta"]}
      />
    );

    expect(screen.getByLabelText("Enabled")).not.toBeChecked();
  });

  it("shows the live cost estimate in the top-right meter", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);

        if (url.startsWith("/api/models")) {
          return jsonResponse({ models: [] });
        }

        if (url === "/api/estimate") {
          return jsonResponse({
            totalUsd: 6,
            requiresCostConfirm: true,
            items: [],
            missingPricingModelIds: []
          });
        }

        return jsonResponse({});
      })
    );

    render(
      <ModelSelectionForm
        runId="01HX0000000000000000000000"
        selectedChannels={["meta"]}
        initialSelections={{
          meta: {
            imageModelId: "fal-ai/flux-pro/v1.1-ultra",
            imageModel: {
              id: "fal-ai/flux-pro/v1.1-ultra",
              name: "Flux Pro Ultra",
              kind: "image",
              pricing: { unit: "image", amountUsd: 1 }
            }
          }
        }}
        brief={{
          resortName: "Westgate Lakes Resort & Spa",
          headline: "Save on Orlando villas",
          offer: "Save 30%",
          brandColors: [],
          mustIncludeVisualElements: [],
          mustAvoidElements: []
        }}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("$6.00")).toBeInTheDocument();
      expect(screen.getByText("Confirm required above $5")).toBeInTheDocument();
    });
  });

  it("routes to the Creative Direction step after saving model selections", async () => {
    const assignSpy = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        assign: assignSpy
      }
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);

        if (url.startsWith("/api/models")) {
          return jsonResponse({ models: [] });
        }

        if (url === "/api/estimate" || url.includes("/api/runs/")) {
          return jsonResponse({});
        }

        return jsonResponse({});
      })
    );

    render(
      <ModelSelectionForm
        runId="01HX0000000000000000000000"
        selectedChannels={["meta"]}
        initialSelections={{
          meta: {
            imageModelId: "fal-ai/flux-pro/v1.1-ultra",
            imageModel: {
              id: "fal-ai/flux-pro/v1.1-ultra",
              name: "Flux Pro Ultra",
              kind: "image"
            }
          }
        }}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => {
      expect(assignSpy).toHaveBeenCalledWith("/creative?runId=01HX0000000000000000000000");
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
