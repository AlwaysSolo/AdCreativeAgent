import { spawn } from "node:child_process";

import { NextResponse } from "next/server";
import { z } from "zod";

import { isLocalOpenRequest } from "../../../../src/lib/open-folder";
import { resolveMassEditOutputFolder } from "../../../../src/lib/mass-edit";

const openMassEditFolderSchema = z.object({
  runId: z.string().trim().min(1)
});

export async function POST(request: Request) {
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

  const parsed = openMassEditFolderSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid open-folder payload", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  try {
    const folderPath = await resolveMassEditOutputFolder({ runId: parsed.data.runId });

    openFolder(folderPath);

    return NextResponse.json({
      opened: true,
      path: folderPath
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to open output folder.";

    return NextResponse.json({ error: message }, { status: 404 });
  }
}

function openFolder(folderPath: string) {
  const opener = openerCommand();
  const child = spawn(opener.command, [...opener.args, folderPath], {
    detached: true,
    stdio: "ignore",
    windowsHide: true
  });

  child.unref();
}

function openerCommand() {
  if (process.platform === "win32") {
    return { command: "explorer.exe", args: [] };
  }

  if (process.platform === "darwin") {
    return { command: "open", args: [] };
  }

  return { command: "xdg-open", args: [] };
}
