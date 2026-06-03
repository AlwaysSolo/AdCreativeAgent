"use client";

import { useState } from "react";

import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

type UrlScrapeFormProps = {
  projectId?: string;
};

export function UrlScrapeForm({ projectId }: UrlScrapeFormProps) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const scrapeResponse = await fetch("/api/scrape", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url })
      });

      if (!scrapeResponse.ok) {
        throw new Error(await readError(scrapeResponse, "Unable to scrape URL."));
      }

      const scrapedBrief: unknown = await scrapeResponse.json();
      const runResponse = await fetch("/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId, sourceUrl: url, scrapedBrief })
      });

      if (!runResponse.ok) {
        throw new Error(await readError(runResponse, "Unable to create run."));
      }

      const { runId } = (await runResponse.json()) as { runId: string };
      window.location.assign(`/brief?runId=${encodeURIComponent(runId)}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong.");
      setIsSubmitting(false);
    }
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <div className="space-y-2">
        <Label htmlFor="landing-page-url">Landing page URL</Label>
        <Input
          id="landing-page-url"
          name="url"
          type="url"
          placeholder="https://www.example.com/resort-offer"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          required
        />
      </div>
      {error ? <p className="text-sm font-medium text-destructive">{error}</p> : null}
      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Scraping..." : "Scrape landing page"}
      </Button>
    </form>
  );
}

async function readError(response: Response, fallback: string) {
  try {
    const payload = (await response.json()) as { error?: string };

    return payload.error ?? fallback;
  } catch {
    return fallback;
  }
}
