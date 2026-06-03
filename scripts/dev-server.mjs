#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function resolveDevServerConfig(env) {
  const host = env.HOST?.trim() || "localhost";
  const port = env.PORT?.trim() || "3000";
  const warning =
    host === "0.0.0.0"
      ? "Warning: HOST=0.0.0.0 exposes the app beyond localhost. Use this only on trusted networks."
      : null;

  return { host, port, warning };
}

if (isMainModule()) {
  const { host, port, warning } = resolveDevServerConfig(process.env);

  if (warning) {
    console.warn(warning);
  }

  const nextBin = path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next");
  const child = spawn(process.execPath, [nextBin, "dev", "-H", host, "-p", port], {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit"
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }

    process.exit(code ?? 0);
  });
}

function isMainModule() {
  return process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
}
