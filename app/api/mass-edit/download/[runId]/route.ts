import { NextResponse } from "next/server";

import { readMassEditAsset } from "../../../../../src/lib/mass-edit";

type RouteContext = {
  params: {
    runId: string;
  };
};

export async function GET(request: Request, { params }: RouteContext) {
  const url = new URL(request.url);
  const assetId = url.searchParams.get("assetId");
  const inline = ["1", "true"].includes(url.searchParams.get("inline") ?? "");

  if (!assetId) {
    return NextResponse.json({ error: "Missing assetId" }, { status: 400 });
  }

  try {
    const result = await readMassEditAsset({
      runId: params.runId,
      assetId
    });

    return new Response(new Uint8Array(result.bytes), {
      headers: {
        "content-type": "image/png",
        "content-length": String(result.bytes.byteLength),
        "content-disposition": `${inline ? "inline" : "attachment"}; filename="${result.asset.assetId}.png"`
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Download failed.";

    return NextResponse.json({ error: message }, { status: 404 });
  }
}
