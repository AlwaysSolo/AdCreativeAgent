import { NextResponse } from "next/server";
import { z } from "zod";

import {
  isLocalOpenRequest,
  openRunOutputFolder,
  type FolderOpener
} from "./open-folder";

type OpenFolderHandlerOptions = {
  opener?: FolderOpener;
  outputRoot?: string;
};

const openFolderRequestSchema = z.object({
  runId: z.string().trim().min(1),
  assetId: z.string().trim().min(1).optional()
});

export async function handleOpenFolderRequest(
  request: Request,
  options: OpenFolderHandlerOptions = {}
) {
  if (!isLocalOpenRequest(request)) {
    return NextResponse.json(
      { error: "Opening local folders is only available from localhost." },
      { status: 403 }
    );
  }

  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = openFolderRequestSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid open-folder payload", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  try {
    const opened = await openRunOutputFolder({
      runId: parsed.data.runId,
      assetId: parsed.data.assetId,
      opener: options.opener,
      outputRoot: options.outputRoot
    });

    return NextResponse.json({
      opened: true,
      path: opened.path
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to open output folder.";

    return NextResponse.json({ error: message }, { status: 404 });
  }
}
