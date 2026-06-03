import { NextResponse } from "next/server";

import { loadModelCatalog, searchModelCatalog } from "../../../src/models/catalog";
import { modelInfoSchema } from "../../../src/schemas";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const q = url.searchParams.get("q");
  const rawKind = url.searchParams.get("kind");
  const kind = modelInfoSchema.shape.kind.safeParse(rawKind).success
    ? modelInfoSchema.shape.kind.parse(rawKind)
    : null;
  const tags = url.searchParams.getAll("tag");

  try {
    const catalog = await loadModelCatalog();
    const models = searchModelCatalog(catalog.models, { q, kind, tags });

    return NextResponse.json({
      models,
      fetchedAt: catalog.fetchedAt,
      staleSince: catalog.staleSince
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Model catalog unavailable.";

    return NextResponse.json(
      {
        models: [],
        error: message,
        manualEntryAvailable: true
      },
      { status: 503 }
    );
  }
}
