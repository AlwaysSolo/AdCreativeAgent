import { NextResponse } from "next/server";

import { refreshModelCatalog } from "../../../../src/models/catalog";

export async function POST() {
  const catalog = await refreshModelCatalog();

  return NextResponse.json({
    models: catalog.models,
    fetchedAt: catalog.fetchedAt,
    staleSince: catalog.staleSince
  });
}
