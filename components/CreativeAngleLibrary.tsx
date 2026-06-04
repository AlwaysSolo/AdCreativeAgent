"use client";

import { useState } from "react";

import type { CreativeAngleRecord } from "../src/schemas";
import { Button } from "./ui/button";

type CreativeAngleLibraryProps = {
  projectId: string;
  angleGroups: Array<{
    destinationSlug: string;
    destinationName: string;
    angles: CreativeAngleRecord[];
  }>;
};

export function CreativeAngleLibrary({
  projectId,
  angleGroups
}: CreativeAngleLibraryProps) {
  const [busyAngleId, setBusyAngleId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function generateFromAngle(angle: CreativeAngleRecord) {
    setBusyAngleId(angle.angleId);
    setError(null);

    try {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/angles/${encodeURIComponent(angle.angleId)}/runs`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ destinationSlug: angle.destinationSlug })
        }
      );
      const payload = (await response.json().catch(() => ({}))) as {
        redirectHref?: string;
        error?: string;
      };

      if (!response.ok || !payload.redirectHref) {
        throw new Error(payload.error ?? "Unable to create a run from this angle.");
      }

      window.location.assign(payload.redirectHref);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to create a run from this angle.");
      setBusyAngleId(null);
    }
  }

  return (
    <section className="space-y-4" aria-labelledby="creative-angles-heading">
      <div className="space-y-2">
        <h2 id="creative-angles-heading" className="text-xl font-semibold">
          Creative Angles
        </h2>
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
          Saved directions are grouped by destination. Generate from one to reuse its
          original channels, sizes, models, and quality settings, then adjust or add channels
          before continuing.
        </p>
      </div>

      {angleGroups.length > 0 ? (
        <div className="space-y-6">
          {angleGroups.map((group) => (
            <section
              key={group.destinationSlug}
              className="space-y-3 rounded-md border bg-background p-4"
              aria-labelledby={`angles-${group.destinationSlug}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 id={`angles-${group.destinationSlug}`} className="text-lg font-semibold">
                  {group.destinationName}
                </h3>
                <span className="rounded-sm border px-2 py-1 text-xs text-muted-foreground">
                  {group.angles.length} {group.angles.length === 1 ? "angle" : "angles"}
                </span>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                {group.angles.map((angle) => (
                  <article key={angle.angleId} className="rounded-md border bg-muted/20 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h4 className="text-sm font-semibold">{angle.title}</h4>
                        <p className="mt-2 text-sm leading-6 text-muted-foreground">
                          {angle.description}
                        </p>
                      </div>
                      <span className="rounded-sm border bg-background px-2 py-1 text-xs capitalize text-muted-foreground">
                        {angle.status}
                      </span>
                    </div>
                    {angle.heroVisual ? (
                      <p className="mt-3 text-xs leading-5 text-muted-foreground">
                        <span className="font-semibold text-foreground">Hook:</span>{" "}
                        {angle.heroVisual}
                      </p>
                    ) : null}
                    <p className="mt-3 text-xs text-muted-foreground">
                      Defaults: {defaultSummary(angle)}
                    </p>
                    <Button
                      type="button"
                      className="mt-4 w-full"
                      disabled={busyAngleId !== null}
                      onClick={() => void generateFromAngle(angle)}
                    >
                      {busyAngleId === angle.angleId
                        ? "Creating run"
                        : "Generate from saved angle"}
                    </Button>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="rounded-md border border-dashed bg-background p-5 text-sm text-muted-foreground">
          Saved creative angles will appear here after Step 5 creates concepts for a
          destination.
        </div>
      )}

      {error ? <p className="text-sm font-medium text-destructive">{error}</p> : null}
    </section>
  );
}

function defaultSummary(angle: CreativeAngleRecord) {
  if (angle.defaultSelectedChannels.length === 0) {
    return "no saved channel defaults";
  }

  return angle.defaultSelectedChannels
    .map((channel) => {
      const sizeCount = angle.defaultSelectedChannelSizes?.[channel]?.length ?? 0;

      return `${labelForChannel(channel)} (${sizeCount} ${sizeCount === 1 ? "size" : "sizes"})`;
    })
    .join(", ");
}

function labelForChannel(channel: string) {
  return channel
    .split("_")
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
}
