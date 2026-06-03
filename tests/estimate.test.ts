import { POST } from "../app/api/estimate/route";
import { computeCostEstimate } from "../src/lib/estimate";
import type { ModelInfo } from "../src/schemas";

const brief = {
  resortName: "Westgate Lakes Resort & Spa",
  headline: "Save on Orlando villas",
  offer: "Save 30%",
  brandColors: [],
  mustIncludeVisualElements: [],
  mustAvoidElements: []
};

const imageModel: ModelInfo = {
  id: "fal-ai/flux-pro/v1.1-ultra",
  name: "Flux Pro Ultra",
  kind: "image",
  pricing: { unit: "image", amountUsd: 0.1 }
};

const videoModel: ModelInfo = {
  id: "fal-ai/kling-video/image-to-video",
  name: "Kling Video",
  kind: "video",
  pricing: { unit: "second", amountUsd: 0.2 }
};

describe("computeCostEstimate", () => {
  it("multiplies image pricing by number of sizes per selected channel", () => {
    const estimate = computeCostEstimate({
      brief,
      channels: ["meta", "email_internal"],
      models: {
        meta: { imageModel },
        email_internal: { imageModel }
      }
    });

    expect(estimate.totalUsd).toBeCloseTo(0.6);
    expect(estimate.requiresCostConfirm).toBe(false);
    expect(estimate.items).toEqual([
      expect.objectContaining({ channel: "meta", sizeCount: 4, costUsd: 0.4 }),
      expect.objectContaining({ channel: "email_internal", sizeCount: 2, costUsd: 0.2 })
    ]);
  });

  it("counts optional video model pricing once per selected channel size", () => {
    const estimate = computeCostEstimate({
      brief,
      channels: ["website"],
      models: {
        website: {
          imageModel,
          videoModel,
          generateVideo: true
        }
      }
    });

    expect(estimate.totalUsd).toBeCloseTo(1.5);
  });

  it("uses the selected size count when specific sizes are chosen", () => {
    const estimate = computeCostEstimate({
      brief,
      channels: ["meta"],
      selectedChannelSizes: {
        meta: ["Feed square"]
      },
      models: {
        meta: { imageModel }
      }
    });

    expect(estimate.totalUsd).toBeCloseTo(0.1);
    expect(estimate.items).toEqual([
      expect.objectContaining({ channel: "meta", sizeCount: 1, costUsd: 0.1 })
    ]);
  });

  it("treats missing pricing as zero and reports missing pricing model ids", () => {
    const estimate = computeCostEstimate({
      brief,
      channels: ["seo"],
      models: {
        seo: {
          imageModel: {
            id: "fal-ai/unknown",
            name: "Unknown",
            kind: "image"
          }
        }
      }
    });

    expect(estimate.totalUsd).toBe(0);
    expect(estimate.missingPricingModelIds).toEqual(["fal-ai/unknown"]);
  });

  it("flags estimates over five dollars", () => {
    const expensiveModel: ModelInfo = {
      ...imageModel,
      pricing: { unit: "image", amountUsd: 1.5 }
    };

    const estimate = computeCostEstimate({
      brief,
      channels: ["meta"],
      models: {
        meta: { imageModel: expensiveModel }
      }
    });

    expect(estimate.totalUsd).toBe(6);
    expect(estimate.requiresCostConfirm).toBe(true);
  });
});

describe("POST /api/estimate", () => {
  it("returns a cost estimate response", async () => {
    const response = await POST(
      new Request("http://localhost:3000/api/estimate", {
        method: "POST",
        body: JSON.stringify({
          brief,
          channels: ["meta"],
          selectedChannelSizes: {
            meta: ["Feed square"]
          },
          models: {
            meta: { imageModel }
          }
        })
      })
    );
    const payload = (await response.json()) as { totalUsd: number; requiresCostConfirm: boolean };

    expect(response.status).toBe(200);
    expect(payload.totalUsd).toBeCloseTo(0.1);
    expect(payload.requiresCostConfirm).toBe(false);
  });
});
