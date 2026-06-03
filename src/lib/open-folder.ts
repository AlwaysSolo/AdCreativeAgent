import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import path from "node:path";

import { loadRunResults } from "./results";

export type FolderOpener = (folderPath: string) => Promise<void> | void;

type OpenRunOutputFolderInput = {
  runId: string;
  assetId?: string;
  outputRoot?: string;
  opener?: FolderOpener;
};

const DEFAULT_OUTPUT_ROOT = path.join(process.cwd(), "outputs");

export async function openRunOutputFolder({
  opener = defaultFolderOpener,
  ...input
}: OpenRunOutputFolderInput) {
  const folderPath = await resolveRunOutputFolder(input);

  await opener(folderPath);

  return {
    path: folderPath
  };
}

export async function resolveRunOutputFolder({
  runId,
  assetId,
  outputRoot
}: Pick<OpenRunOutputFolderInput, "runId" | "assetId" | "outputRoot">) {
  const results = await loadRunResults(runId, { outputRoot });
  const root = path.resolve(outputRoot ?? DEFAULT_OUTPUT_ROOT);
  const targetPath = assetId ? folderForAsset(results, assetId) : results.runDir;
  const folderPath = assertInsideDirectory(root, targetPath);
  const folderStats = await stat(folderPath);

  if (!folderStats.isDirectory()) {
    throw new Error(`Output path is not a directory: ${folderPath}`);
  }

  return folderPath;
}

export function isLocalOpenRequest(request: Request) {
  const hostname = new URL(request.url).hostname.toLowerCase();

  return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname);
}

function folderForAsset(results: Awaited<ReturnType<typeof loadRunResults>>, assetId: string) {
  const asset = results.groups
    .flatMap((group) => group.assets)
    .find((candidate) => candidate.assetId === assetId);

  if (!asset) {
    throw new Error(`Asset not found: ${assetId}`);
  }

  return path.dirname(asset.finalPath);
}

function assertInsideDirectory(root: string, targetPath: string) {
  const resolvedTarget = path.resolve(targetPath);
  const relative = path.relative(root, resolvedTarget);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Refusing to open a path outside outputs.");
  }

  return resolvedTarget;
}

function defaultFolderOpener(folderPath: string) {
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
