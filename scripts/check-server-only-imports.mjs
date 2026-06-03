import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(process.argv[2] ?? process.cwd());
const excludedDirs = new Set([
  ".git",
  ".next",
  "cache",
  "node_modules",
  "outputs",
  "coverage",
  "dist",
  "build"
]);
const sourceExtensions = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
const forbiddenRelativeSuffix = normalizePath(path.join("src", "generators", "fal-client.ts"));
const sourceFiles = await collectSourceFiles(root);
const contents = new Map();
const clientRoots = [];
const violations = [];

for (const file of sourceFiles) {
  const content = await readFile(file, "utf8");
  contents.set(file, content);

  if (hasUseClientDirective(content)) {
    clientRoots.push(file);
  }
}

for (const clientRoot of clientRoots) {
  traceClientImports(clientRoot, [clientRoot], new Set());
}

if (violations.length > 0) {
  console.error("Server-only import check failed:");

  for (const violation of violations) {
    console.error(`- ${violation}`);
  }

  process.exit(1);
}

function traceClientImports(file, chain, visited) {
  if (visited.has(file)) {
    return;
  }

  visited.add(file);

  for (const specifier of importSpecifiers(contents.get(file) ?? "")) {
    if (specifier === "@fal-ai/client" || specifier.startsWith("@fal-ai/client/")) {
      violations.push(`${formatChain(chain)} imports @fal-ai/client`);
      continue;
    }

    const resolved = resolveLocalImport(file, specifier);

    if (!resolved) {
      continue;
    }

    if (isFalClientFile(resolved)) {
      violations.push(`${formatChain([...chain, resolved])} reaches fal-client`);
      continue;
    }

    traceClientImports(resolved, [...chain, resolved], visited);
  }
}

async function collectSourceFiles(directory) {
  const files = [];
  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory() && excludedDirs.has(entry.name)) {
      continue;
    }

    const fullPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await collectSourceFiles(fullPath)));
      continue;
    }

    if (entry.isFile() && sourceExtensions.includes(path.extname(entry.name))) {
      files.push(fullPath);
    }
  }

  return files;
}

function hasUseClientDirective(content) {
  const trimmed = content.replace(/^\uFEFF/, "").trimStart();

  return /^["']use client["'];?/.test(trimmed);
}

function importSpecifiers(content) {
  const specifiers = [];
  const patterns = [
    /import\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g,
    /export\s+(?:type\s+)?[\s\S]*?\s+from\s+["']([^"']+)["']/g,
    /require\(\s*["']([^"']+)["']\s*\)/g
  ];

  for (const pattern of patterns) {
    let match = pattern.exec(content);

    while (match) {
      specifiers.push(match[1]);
      match = pattern.exec(content);
    }
  }

  return specifiers;
}

function resolveLocalImport(fromFile, specifier) {
  if (!specifier.startsWith(".") && !specifier.startsWith("@/")) {
    return null;
  }

  const base = specifier.startsWith("@/")
    ? path.resolve(root, specifier.slice(2))
    : path.resolve(path.dirname(fromFile), specifier);
  const candidates = [
    base,
    ...sourceExtensions.map((extension) => `${base}${extension}`),
    ...sourceExtensions.map((extension) => path.join(base, `index${extension}`))
  ];

  return candidates.find((candidate) => contents.has(candidate)) ?? null;
}

function isFalClientFile(file) {
  const relative = normalizePath(path.relative(root, file));

  return relative === forbiddenRelativeSuffix;
}

function normalizePath(value) {
  return value.split(path.sep).join("/");
}

function formatChain(chain) {
  return chain
    .map((file) => path.relative(root, file) || pathToFileURL(file).href)
    .join(" -> ");
}
