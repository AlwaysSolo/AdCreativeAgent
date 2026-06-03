"use client";

import { useState } from "react";
import { FolderOpen } from "lucide-react";

import { cn } from "../src/lib/utils";
import { Button } from "./ui/button";

type OpenFolderButtonProps = {
  runId: string;
  assetId?: string;
  label?: string;
  className?: string;
  endpoint?: string;
};

export function OpenFolderButton({
  runId,
  assetId,
  label = "Open output folder",
  className,
  endpoint = "/api/open-folder"
}: OpenFolderButtonProps) {
  const [isOpening, setIsOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleOpenFolder() {
    setIsOpening(true);
    setError(null);

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          runId,
          ...(assetId ? { assetId } : {})
        })
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;

        throw new Error(payload?.error ?? "Unable to open output folder.");
      }
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : "Unable to open output folder.");
    } finally {
      setIsOpening(false);
    }
  }

  return (
    <span className="inline-flex flex-col gap-1">
      <Button
        aria-label={label}
        className={cn("gap-2", className)}
        disabled={isOpening}
        onClick={handleOpenFolder}
      >
        <FolderOpen aria-hidden="true" className="h-4 w-4" />
        {isOpening ? "Opening..." : label}
      </Button>
      {error ? <span className="text-xs font-medium text-destructive">{error}</span> : null}
    </span>
  );
}
