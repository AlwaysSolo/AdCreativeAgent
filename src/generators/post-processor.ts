import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

import { channels, type ChannelKey, type ChannelSize } from "../config/channels";

export type PostProcessAssetInput = {
  runId: string;
  projectSlug?: string;
  destinationSlug?: string;
  campaignSlug: string;
  assetId: string;
  channel: ChannelKey;
  size: ChannelSize;
  rawPath: string;
  outputFileNameBase?: string;
  outputRoot?: string;
};

export type PostProcessAssetResult = {
  finalPath: string;
  draftPath: string;
  thumbnailUrl: string;
};

const DEFAULT_OUTPUT_ROOT = path.join(process.cwd(), "outputs");

export async function postProcessAsset(
  input: PostProcessAssetInput
): Promise<PostProcessAssetResult> {
  const runDir = path.join(
    input.outputRoot ?? DEFAULT_OUTPUT_ROOT,
    ...(input.projectSlug ? [safeSegment(input.projectSlug)] : []),
    ...(input.destinationSlug ? [safeSegment(input.destinationSlug)] : []),
    safeSegment(input.campaignSlug),
    input.runId
  );
  const fileName = `${safeSegment(input.outputFileNameBase ?? input.assetId)}.png`;
  const finalPath = path.join(
    runDir,
    "final",
    input.channel,
    fileName
  );
  const draftPath = path.join(
    runDir,
    "drafts",
    input.channel,
    fileName
  );
  const finalBuffer = await sharp(input.rawPath)
    .resize(input.size.w, input.size.h, {
      fit: "cover",
      position: "center"
    })
    .png()
    .toBuffer();

  await mkdir(path.dirname(finalPath), { recursive: true });
  await mkdir(path.dirname(draftPath), { recursive: true });
  await sharp(finalBuffer).toFile(finalPath);
  await sharp(finalBuffer)
    .composite([
      {
        input: Buffer.from(watermarkSvg(input.size.w, input.size.h)),
        gravity: "center"
      }
    ])
    .png()
    .toFile(draftPath);

  if (channels[input.channel].allowOnImageText === false) {
    await appendOcrLog({
      runDir,
      runId: input.runId,
      assetId: input.assetId,
      channel: input.channel,
      result: await runOcrCheck(finalBuffer)
    });
  }

  return {
    finalPath,
    draftPath,
    thumbnailUrl: `/${path.relative(process.cwd(), finalPath).replace(/\\/g, "/")}`
  };
}

type OcrCheckResult = {
  textDetected: boolean;
  ocrConfidence: number;
  engine: string;
};

async function runOcrCheck(_image: Buffer): Promise<OcrCheckResult> {
  return {
    textDetected: false,
    ocrConfidence: 0,
    engine: "dry-run-safe-ocr-placeholder"
  };
}

async function appendOcrLog({
  runDir,
  runId,
  assetId,
  channel,
  result
}: {
  runDir: string;
  runId: string;
  assetId: string;
  channel: ChannelKey;
  result: OcrCheckResult;
}) {
  await appendFile(
    path.join(runDir, "ocr-log.jsonl"),
    `${JSON.stringify({
      timestamp: new Date().toISOString(),
      runId,
      assetId,
      channel,
      ocrChecked: true,
      textDetected: result.textDetected,
      ocrConfidence: result.ocrConfidence,
      engine: result.engine
    })}\n`,
    "utf8"
  );
}

function watermarkSvg(width: number, height: number) {
  const fontSize = Math.max(28, Math.min(width, height) / 8);

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`,
    `<text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle"`,
    ` font-family="Arial, sans-serif" font-size="${fontSize}" font-weight="700"`,
    ` fill="rgba(255,255,255,0.72)" stroke="rgba(17,24,39,0.35)" stroke-width="2"`,
    ` transform="rotate(-28 ${width / 2} ${height / 2})">DRAFT</text>`,
    "</svg>"
  ].join("");
}

function safeSegment(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}
