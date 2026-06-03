import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  loadModelCatalog,
  refreshModelCatalog,
  searchModelCatalog
} from "../src/models/catalog";

const livePayload = {
  models: [
    {
      id: "fal-ai/flux-pro/v1.1-ultra",
      name: "FLUX Pro Ultra",
      description: "Photoreal text-to-image generation model with 16:9 output.",
      tags: ["text-to-image", "photorealistic", "premium"],
      thumbnailUrl: "https://example.com/flux.jpg",
      pricing: {
        unit: "image",
        amountUsd: 0.06
      },
      maxResolution: {
        w: 1920,
        h: 1080
      },
      supportedAspects: ["1:1", "16:9", "9:16"]
    },
    {
      endpointId: "fal-ai/kling-video/v2/master/image-to-video",
      title: "Kling Video v2",
      description: "Image to video generation for cinematic motion.",
      tags: ["image-to-video", "video"]
    },
    {
      id: "fal-ai/ideogram/v3",
      name: "Ideogram v3",
      description: "Text rendering image model for typography and posters.",
      tags: ["text-to-image", "text-rendering"]
    }
  ]
};

describe("model catalog", () => {
  it("fetches, normalizes, applies heuristics, and writes the cache", async () => {
    const cacheDir = await mkdtemp(path.join(tmpdir(), "model-catalog-"));

    try {
      const result = await loadModelCatalog({
        cachePath: path.join(cacheDir, "models-catalog.json"),
        now: () => new Date("2026-05-20T20:00:00.000Z"),
        fetchImpl: async () => response(JSON.stringify(livePayload))
      });

      expect(result.source).toBe("live");
      expect(result.models).toHaveLength(3);
      expect(result.models[0]).toMatchObject({
        id: "fal-ai/flux-pro/v1.1-ultra",
        kind: "image",
        capabilities: {
          textToImage: true,
          supportsOnImageText: false,
          maxResolution: { w: 1920, h: 1080 },
          supportedAspects: ["1:1", "16:9", "9:16"]
        }
      });
      expect(result.models[1]).toMatchObject({
        id: "fal-ai/kling-video/v2/master/image-to-video",
        kind: "video",
        capabilities: {
          imageToVideo: true
        }
      });
      expect(result.models[2].capabilities?.supportsOnImageText).toBe(true);

      const cached = JSON.parse(
        await readFile(path.join(cacheDir, "models-catalog.json"), "utf8")
      ) as { models: unknown[] };
      expect(cached.models).toHaveLength(3);
    } finally {
      await rm(cacheDir, { force: true, recursive: true });
    }
  });

  it("uses fresh cache without fetching and falls back to stale cache if fetch fails", async () => {
    const cacheDir = await mkdtemp(path.join(tmpdir(), "model-catalog-"));
    const cachePath = path.join(cacheDir, "models-catalog.json");
    let fetchCount = 0;

    try {
      await loadModelCatalog({
        cachePath,
        now: () => new Date("2026-05-20T20:00:00.000Z"),
        fetchImpl: async () => {
          fetchCount += 1;
          return response(JSON.stringify(livePayload));
        }
      });

      const fresh = await loadModelCatalog({
        cachePath,
        now: () => new Date("2026-05-20T21:00:00.000Z"),
        fetchImpl: async () => {
          fetchCount += 1;
          throw new Error("should not fetch");
        }
      });

      const stale = await loadModelCatalog({
        cachePath,
        now: () => new Date("2026-05-22T21:00:00.000Z"),
        fetchImpl: async () => {
          fetchCount += 1;
          throw new Error("network down");
        }
      });

      expect(fetchCount).toBe(2);
      expect(fresh.source).toBe("cache");
      expect(stale.source).toBe("cache");
      expect(stale.staleSince).toBe("2026-05-20T20:00:00.000Z");
    } finally {
      await rm(cacheDir, { force: true, recursive: true });
    }
  });

  it("refreshes by bypassing fresh cache", async () => {
    const cacheDir = await mkdtemp(path.join(tmpdir(), "model-catalog-"));
    const cachePath = path.join(cacheDir, "models-catalog.json");
    let fetchCount = 0;

    try {
      await loadModelCatalog({
        cachePath,
        fetchImpl: async () => {
          fetchCount += 1;
          return response(JSON.stringify(livePayload));
        }
      });
      await refreshModelCatalog({
        cachePath,
        fetchImpl: async () => {
          fetchCount += 1;
          return response(JSON.stringify({ models: [livePayload.models[0]] }));
        }
      });

      expect(fetchCount).toBe(2);
    } finally {
      await rm(cacheDir, { force: true, recursive: true });
    }
  });

  it("searches by query, kind, and tags with exact id matches ranked first", () => {
    const results = searchModelCatalog(
      [
        normalizeFixtureModel("fal-ai/flux/dev", "Flux Dev", "image", ["text-to-image"]),
        normalizeFixtureModel("fal-ai/flux-pro/v1.1-ultra", "Flux Pro Ultra", "image", [
          "premium",
          "photorealistic"
        ]),
        normalizeFixtureModel("fal-ai/kling-video", "Kling Video", "video", [
          "image-to-video"
        ])
      ],
      {
        q: "flux pro",
        kind: "image",
        tags: ["premium"]
      }
    );

    expect(results.map((model) => model.id)).toEqual(["fal-ai/flux-pro/v1.1-ultra"]);
  });
});

function normalizeFixtureModel(
  id: string,
  name: string,
  kind: "image" | "video",
  tags: string[]
) {
  return {
    id,
    name,
    kind,
    tags,
    capabilities: {}
  };
}

function response(body: string) {
  return {
    ok: true,
    status: 200,
    text: async () => body
  } as Response;
}
