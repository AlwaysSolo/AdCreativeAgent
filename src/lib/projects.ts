import { randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

export type ProjectState = {
  projectId: string;
  name: string;
  slug: string;
  createdAt: string;
  updatedAt: string;
};

export type ProjectReference = Pick<ProjectState, "projectId" | "name" | "slug">;

type ProjectStoreOptions = {
  cacheDir?: string;
  now?: () => Date;
};

const DEFAULT_PROJECTS_DIR = path.join(process.cwd(), "cache", "projects");
const ULID_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export async function createProject(name: string, options: ProjectStoreOptions = {}) {
  const trimmedName = name.trim();

  if (!trimmedName) {
    throw new Error("Project name is required.");
  }

  const now = options.now?.() ?? new Date();
  const project: ProjectState = {
    projectId: generateUlid(now),
    name: trimmedName,
    slug: safeSegment(trimmedName),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString()
  };

  await writeProject(project, options);

  return project;
}

export async function readProject(projectId: string, options: ProjectStoreOptions = {}) {
  try {
    return JSON.parse(await readFile(getProjectPath(projectId, options), "utf8")) as ProjectState;
  } catch {
    return null;
  }
}

export async function listProjects(options: ProjectStoreOptions = {}) {
  const cacheDir = options.cacheDir ?? DEFAULT_PROJECTS_DIR;

  try {
    const fileNames = await readdir(cacheDir);
    const projects = await Promise.all(
      fileNames
        .filter((fileName) => fileName.endsWith(".json"))
        .map(async (fileName) => {
          try {
            return JSON.parse(await readFile(path.join(cacheDir, fileName), "utf8")) as ProjectState;
          } catch {
            return null;
          }
        })
    );

    return projects
      .filter((project): project is ProjectState => project !== null)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  } catch {
    return [];
  }
}

export function getProjectPath(projectId: string, options: ProjectStoreOptions = {}) {
  if (!/^[0-9A-HJKMNP-TV-Z]{26}$/.test(projectId)) {
    throw new Error("Invalid projectId");
  }

  return path.join(options.cacheDir ?? DEFAULT_PROJECTS_DIR, `${projectId}.json`);
}

async function writeProject(project: ProjectState, options: ProjectStoreOptions) {
  const cacheDir = options.cacheDir ?? DEFAULT_PROJECTS_DIR;

  await mkdir(cacheDir, { recursive: true });
  await writeFile(getProjectPath(project.projectId, options), JSON.stringify(project, null, 2));
}

function generateUlid(now: Date) {
  return `${encodeTime(now.valueOf(), 10)}${encodeRandom(16)}`;
}

function encodeTime(timeMs: number, length: number) {
  let value = Math.floor(timeMs);
  let output = "";

  for (let index = length - 1; index >= 0; index -= 1) {
    output = `${ULID_ALPHABET[value % 32]}${output}`;
    value = Math.floor(value / 32);
  }

  return output;
}

function encodeRandom(length: number) {
  const bytes = randomBytes(length);
  let output = "";

  for (let index = 0; output.length < length; index += 1) {
    output += ULID_ALPHABET[bytes[index % bytes.length] % 32];
  }

  return output;
}

function safeSegment(value: string) {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);

  return slug || "project";
}
