import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import sharp from "sharp";

import { postProcessAsset } from "../src/generators/post-processor";

describe("postProcessAsset drafts", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "post-processor-"));
  });

  afterEach(async () => {
    await rm(tempDir, { force: true, recursive: true });
  });

  it("writes a watermarked draft while keeping the final asset clean", async () => {
    const rawPath = path.join(tempDir, "raw.png");
    await sharp({
      create: {
        width: 420,
        height: 420,
        channels: 3,
        background: "#005a8b"
      }
    })
      .png()
      .toFile(rawPath);

    const result = await postProcessAsset({
      runId: "01HX0000000000000000000000",
      campaignSlug: "Spring Villas",
      assetId: "email_internal_email-square_420x420",
      channel: "email_internal",
      size: {
        name: "Email square",
        w: 420,
        h: 420,
        aspectLabel: "1:1"
      },
      rawPath,
      outputRoot: tempDir
    });
    const cleanFinal = await sharp(rawPath).resize(420, 420, { fit: "cover", position: "center" }).png().toBuffer();
    const finalBytes = await readFile(result.finalPath);
    const draftBytes = await readFile(result.draftPath);

    expect(result.finalPath).toContain(`${path.sep}final${path.sep}email_internal${path.sep}`);
    expect(result.draftPath).toContain(`${path.sep}drafts${path.sep}email_internal${path.sep}`);
    expect(hash(finalBytes)).toBe(hash(cleanFinal));
    expect(hash(draftBytes)).not.toBe(hash(finalBytes));
  });

  it("crops custom multiple-of-16 raw outputs down to the exact Meta target size", async () => {
    const rawPath = path.join(tempDir, "raw-1920x1088.png");
    await sharp({
      create: {
        width: 1920,
        height: 1088,
        channels: 3,
        background: "#c4a55d"
      }
    })
      .png()
      .toFile(rawPath);

    const result = await postProcessAsset({
      runId: "01HX0000000000000000000000",
      campaignSlug: "July 4th",
      assetId: "meta_feed-landscape_1920x1080",
      channel: "meta",
      size: {
        name: "Feed landscape",
        w: 1920,
        h: 1080,
        aspectLabel: "16:9"
      },
      rawPath,
      outputRoot: tempDir
    });
    const metadata = await sharp(result.finalPath).metadata();

    expect(metadata.width).toBe(1920);
    expect(metadata.height).toBe(1080);
  });

  it("forces exact target dimensions when the requested fal override is slightly smaller", async () => {
    const rawPath = path.join(tempDir, "raw-1392x593.png");
    await sharp({
      create: {
        width: 1392,
        height: 593,
        channels: 3,
        background: "#148dd0"
      }
    })
      .png()
      .toFile(rawPath);

    const result = await postProcessAsset({
      runId: "01HX0000000000000000000000",
      campaignSlug: "Website Hero",
      assetId: "website_hero-wide_1400x600",
      channel: "website",
      size: {
        name: "Hero wide",
        w: 1400,
        h: 600,
        aspectLabel: "~2.33:1"
      },
      rawPath,
      outputRoot: tempDir
    });
    const metadata = await sharp(result.finalPath).metadata();

    expect(metadata.width).toBe(1400);
    expect(metadata.height).toBe(600);
  });
});

function hash(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}
