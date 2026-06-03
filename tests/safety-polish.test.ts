import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { redactPii } from "../src/lib/pii";

describe("PII redaction", () => {
  it("redacts email addresses and phone numbers before scrape data is logged", () => {
    const redacted = redactPii({
      headline: "Call 407-555-1234 for Orlando deals",
      subheadline: "Email jane.doe@example.com to reserve"
    });

    expect(JSON.stringify(redacted)).not.toContain("407-555-1234");
    expect(JSON.stringify(redacted)).not.toContain("jane.doe@example.com");
    expect(redacted).toMatchObject({
      headline: "Call [redacted-phone] for Orlando deals",
      subheadline: "Email [redacted-email] to reserve"
    });
  });
});

describe("dev server host policy", () => {
  it("binds to localhost by default and warns only when HOST=0.0.0.0 is explicit", async () => {
    const moduleUrl = pathToFileURL(path.join(process.cwd(), "scripts", "dev-server.mjs")).href;
    const devServer = (await import(moduleUrl)) as {
      resolveDevServerConfig: (env: Record<string, string | undefined>) => {
        host: string;
        port: string;
        warning: string | null;
      };
    };

    expect(devServer.resolveDevServerConfig({})).toEqual({
      host: "localhost",
      port: "3000",
      warning: null
    });
    expect(devServer.resolveDevServerConfig({ HOST: "0.0.0.0" })).toMatchObject({
      host: "0.0.0.0",
      warning: expect.stringContaining("HOST=0.0.0.0")
    });
  });
});

describe("FAL_KEY bundle inspection", () => {
  it("fails when the sentinel key appears in .next/static client assets", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "fal-key-inspection-"));

    try {
      await mkdir(path.join(tempDir, ".next", "static", "chunks"), { recursive: true });
      await writeFile(
        path.join(tempDir, ".next", "static", "chunks", "app.js"),
        'const leaked = "fal_test_should_not_ship";',
        "utf8"
      );

      const result = runFalKeyInspection(tempDir, "fal_test_should_not_ship");

      expect(result.status).toBe(1);
      expect(`${result.stdout}${result.stderr}`).toContain("FAL_KEY sentinel found");
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  it("passes when the sentinel key is absent from .next/static client assets", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "fal-key-inspection-"));

    try {
      await mkdir(path.join(tempDir, ".next", "static", "chunks"), { recursive: true });
      await writeFile(path.join(tempDir, ".next", "static", "chunks", "app.js"), "const ok = true;", "utf8");

      const result = runFalKeyInspection(tempDir, "fal_test_should_not_ship");

      expect(result.status).toBe(0);
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });
});

function runFalKeyInspection(root: string, sentinel: string) {
  return spawnSync(process.execPath, ["scripts/assert-fal-key-absent.mjs", root, sentinel], {
    cwd: process.cwd(),
    encoding: "utf8"
  });
}
