#!/usr/bin/env node
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(process.argv[2] ?? process.cwd());
const sentinel = process.argv[3] ?? process.env.FAL_KEY ?? "";
const clientBundleDir = path.join(root, ".next", "static");

if (!sentinel) {
  console.log("FAL_KEY is not set; client bundle inspection skipped.");
  process.exit(0);
}

if (!(await exists(clientBundleDir))) {
  console.error(`Client bundle directory not found: ${clientBundleDir}. Run next build first.`);
  process.exit(1);
}

const files = await collectFiles(clientBundleDir);
const hits = [];

for (const file of files) {
  const content = await readFile(file, "utf8");

  if (content.includes(sentinel)) {
    hits.push(path.relative(root, file));
  }
}

if (hits.length > 0) {
  console.error("FAL_KEY sentinel found in client bundle:");

  for (const hit of hits) {
    console.error(`- ${hit}`);
  }

  process.exit(1);
}

console.log("FAL_KEY sentinel absent from client bundle.");

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await collectFiles(fullPath)));
      continue;
    }

    if (entry.isFile()) {
      files.push(fullPath);
    }
  }

  return files;
}

async function exists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}
