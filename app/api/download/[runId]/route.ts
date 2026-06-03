import { NextResponse } from "next/server";

import { channelKeySchema } from "../../../../src/schemas";
import { createDownloadZip, readResultAsset } from "../../../../src/lib/results";

type RouteContext = {
  params: {
    runId: string;
  };
};

export async function GET(request: Request, { params }: RouteContext) {
  const url = new URL(request.url);
  const assetId = url.searchParams.get("assetId");
  const channelParam = url.searchParams.get("channel");
  const inline = ["1", "true"].includes(url.searchParams.get("inline") ?? "");

  try {
    if (assetId) {
      const result = await readResultAsset({
        runId: params.runId,
        assetId
      });

      return new Response(new Uint8Array(result.bytes), {
        headers: {
          "content-type": "image/png",
          "content-length": String(result.bytes.byteLength),
          "content-disposition": `${inline ? "inline" : "attachment"}; filename="${result.asset.downloadFileName}"`
        }
      });
    }

    const channel = channelParam ? channelKeySchema.parse(channelParam) : undefined;
    const zip = await createDownloadZip({
      runId: params.runId,
      channel
    });
    const suffix = channel ? `${channel}.zip` : "all.zip";

    return new Response(new Uint8Array(zip), {
      headers: {
        "content-type": "application/zip",
        "content-length": String(zip.byteLength),
        "content-disposition": `attachment; filename="${params.runId}-${suffix}"`
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Download failed.";

    return NextResponse.json({ error: message }, { status: 404 });
  }
}
