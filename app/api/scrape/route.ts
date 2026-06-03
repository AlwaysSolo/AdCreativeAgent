import { NextResponse } from "next/server";
import { z } from "zod";

import { logger } from "@/src/lib/logger";
import { redactPii } from "@/src/lib/pii";
import { scrapeLandingPage } from "@/src/scraper/landing-page";

const scrapeRequestSchema = z.object({
  url: z.string().url()
});

export async function POST(request: Request) {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = scrapeRequestSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid scrape request", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  try {
    const brief = await scrapeLandingPage(parsed.data.url);

    logger.info(
      {
        url: redactPii(parsed.data.url),
        brief: redactPii(brief)
      },
      "Landing page scrape completed"
    );

    return NextResponse.json(brief);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to scrape URL";

    logger.warn(
      {
        url: redactPii(parsed.data.url),
        error: redactPii(message)
      },
      "Landing page scrape failed"
    );

    return NextResponse.json({ error: message }, { status: 502 });
  }
}
