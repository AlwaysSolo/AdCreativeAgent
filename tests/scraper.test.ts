import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  extractCreativeBriefFromHtml,
  getScrapeCachePath,
  scrapeLandingPage
} from "../src/scraper/landing-page";

const fixturesDir = path.join(process.cwd(), "tests", "fixtures", "scraper");

async function fixture(name: string) {
  return readFile(path.join(fixturesDir, name), "utf8");
}

describe("extractCreativeBriefFromHtml", () => {
  it("extracts resort campaign fields from metadata and body content", async () => {
    const html = await fixture("full-resort.html");

    expect(
      extractCreativeBriefFromHtml(html, "https://example.com/orlando")
    ).toMatchObject({
      resortName: "Westgate Lakes Resort & Spa | Orlando Resort Deals",
      headline: "Save 30% on Orlando Villas",
      subheadline: "Book a spacious villa near the parks.",
      offer: "Save 30%",
      validDates: "May 1 - June 30, 2026",
      ctaText: "Book Now",
      heroImageUrl: "https://example.com/images/orlando-hero.jpg",
      brandColors: ["#0e2545", "#c4a55d", "#d95d31", "#3892dc", "#148dd0"],
      location: "Orlando, FL",
      campaignName: "Orlando Villas",
      targetAudience: "Families and theme-park travelers planning an Orlando vacation",
      tone: "energetic, family-fun"
    });
  });

  it("uses schema.org Place location and resolves relative hero image URLs", async () => {
    const html = await fixture("schema-place.html");

    expect(
      extractCreativeBriefFromHtml(html, "https://example.com/gatlinburg/page")
    ).toMatchObject({
      resortName: "River Terrace Resort",
      headline: "River Terrace Spring Escape",
      offer: "from $149",
      validDates: "July 10 through August 15, 2026",
      ctaText: "Reserve",
      heroImageUrl: "https://example.com/river.jpg",
      location: "Gatlinburg, Tennessee"
    });
  });

  it("uses Westgate embedded app data for specials rendered by Angular templates", async () => {
    const html = await fixture("westgate-special.html");
    const brief = extractCreativeBriefFromHtml(
      html,
      "https://www.westgatereservations.com/specials/universal-epic-universe-tickets-vacation-package/"
    );

    expect(brief).toMatchObject({
      resortName: "Westgate Lakes Resort & Spa",
      headline: "Universal Epic Universe Tickets Vacation Package from $399",
      subheadline:
        "The time is now! Book your Universal Epic Universe Tickets vacation package with Westgate Resorts and save big on your upcoming travels.",
      offer: "from $399",
      validDates: null,
      ctaText: "Book By Phone",
      heroImageUrl:
        "https://www.westgatereservations.com/app/uploads/2025/04/Universal-Four-Parks.jpg",
      location: "Orlando, FL",
      brandColors: ["#0e2545", "#c4a55d", "#d95d31", "#3892dc", "#148dd0"],
      campaignName: "Epic Universe",
      promotionSummary:
        "Promote from $399 for Universal Epic Universe Tickets Vacation Package from $399 at Westgate Lakes Resort & Spa in Orlando, FL. The time is now! Book your Universal Epic Universe Tickets vacation package with Westgate Resorts and save big on your upcoming travels. Package highlights: 2 Universal Epic Universe Tickets, Free Transportation to Universal Orlando, 4 Days at Westgate Resorts.",
      targetAudience: "Families and theme-park travelers planning an Orlando vacation",
      tone: "energetic, family-fun",
      mustIncludeVisualElements: [
        "Orlando, FL vacation setting",
        "Westgate Lakes Resort & Spa resort atmosphere",
        "2 Universal Epic Universe Tickets",
        "Free Transportation to Universal Orlando",
        "4 Days at Westgate Resorts",
        "spacious resort-style accommodations"
      ],
      mustAvoidElements: [
        "competitor resort branding",
        "unapproved third-party logos",
        "readable fine print",
        "using third-party park logos as if they are brand assets"
      ]
    });
  });

  it("uses a compact holiday campaign name for Step 2 defaults", () => {
    const html = [
      "<html>",
      "<head>",
      "<title>Westgate Resorts July 4th Orlando Sale</title>",
      '<meta property="og:title" content="Save Big on Your July 4th Orlando Getaway from $99" />',
      '<meta name="description" content="Book a patriotic holiday vacation near the parks." />',
      "</head>",
      "<body>",
      "<h1>Save Big on Your July 4th Orlando Getaway from $99</h1>",
      "<p>Celebrate July 4th with a family vacation in Orlando, FL.</p>",
      "<a>Book Now</a>",
      "</body>",
      "</html>"
    ].join("");

    expect(extractCreativeBriefFromHtml(html, "https://example.com/july-4th")).toMatchObject({
      campaignName: "July 4th",
      brandColors: ["#0e2545", "#c4a55d", "#d95d31", "#3892dc", "#148dd0"]
    });
  });

  it("returns null for missing critical fields instead of guessing", async () => {
    const html = await fixture("missing-critical.html");

    expect(
      extractCreativeBriefFromHtml(html, "https://example.com/quiet")
    ).toMatchObject({
      resortName: null,
      headline: null,
      offer: null,
      subheadline: "A quiet page without campaign details."
    });
  });
});

describe("scrapeLandingPage", () => {
  it("follows HTTP redirects before extracting and caching the page", async () => {
    const cacheDir = await mkdtemp(path.join(tmpdir(), "scrape-cache-"));
    const html = await fixture("full-resort.html");
    const server = createServer((request, response) => {
      if (request.url === "/redirect") {
        response.writeHead(301, { location: "/final" });
        response.end();
        return;
      }

      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(html);
    });

    try {
      await new Promise<void>((resolve) => {
        server.listen(0, "127.0.0.1", resolve);
      });

      const address = server.address();

      if (!address || typeof address === "string") {
        throw new Error("Expected local test server to bind to a TCP port");
      }

      const brief = await scrapeLandingPage(`http://127.0.0.1:${address.port}/redirect`, {
        cacheDir,
        now: () => new Date("2026-05-20T20:00:00.000Z")
      });

      expect(brief.headline).toBe("Save 30% on Orlando Villas");
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      await rm(cacheDir, { force: true, recursive: true });
    }
  });

  it("fetches and caches scrape results for one hour", async () => {
    const cacheDir = await mkdtemp(path.join(tmpdir(), "scrape-cache-"));
    const html = await fixture("full-resort.html");
    const url = "https://example.com/cached-offer";
    let fetchCount = 0;

    try {
      const first = await scrapeLandingPage(url, {
        cacheDir,
        fetchHtml: async () => {
          fetchCount += 1;
          return html;
        },
        now: () => new Date("2026-05-20T20:00:00.000Z")
      });
      const second = await scrapeLandingPage(url, {
        cacheDir,
        fetchHtml: async () => {
          fetchCount += 1;
          return "<html></html>";
        },
        now: () => new Date("2026-05-20T20:30:00.000Z")
      });

      await stat(getScrapeCachePath(url, cacheDir));

      expect(fetchCount).toBe(1);
      expect(second).toEqual(first);
    } finally {
      await rm(cacheDir, { force: true, recursive: true });
    }
  });
});
