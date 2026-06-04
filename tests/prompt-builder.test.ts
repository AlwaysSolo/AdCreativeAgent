import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { buildPrompt } from "../src/generators/prompt-builder";
import { channels, type ChannelKey, type ChannelSize } from "../src/config/channels";
import type { CreativeBrief, ModelInfo } from "../src/schemas";

const brief: CreativeBrief = {
  resortName: "Westgate Lakes Resort & Spa",
  headline: "Spring Villa Escape",
  offer: "Save 30%",
  subheadline: "Spacious Orlando resort villas near the parks",
  ctaText: "Book Now",
  brandColors: ["#005A8B", "#F6B44B"],
  location: "Orlando, Florida",
  campaignName: "Spring Villas",
  promotionSummary: "Promote spring stays with room to relax.",
  targetAudience: "couples and family travelers",
  tone: "relaxed premium",
  mustIncludeVisualElements: ["poolside cabanas", "warm evening light"],
  mustAvoidElements: ["competitor logos", "crowded lobby"]
};

const photorealTextModel: ModelInfo = {
  id: "fal-ai/flux-pro/kontext/text-to-image",
  name: "Flux Kontext",
  kind: "image",
  tags: ["text-to-image", "photorealistic", "supports-on-image-text"],
  capabilities: {
    textToImage: true,
    supportsOnImageText: true,
    supportedAspects: ["1:1", "4:5", "16:9", "9:16", "21:9"]
  }
};

const photorealModel: ModelInfo = {
  id: "fal-ai/flux-pro/v1.1-ultra",
  name: "Flux Pro Ultra",
  kind: "image",
  tags: ["text-to-image", "photorealistic"],
  capabilities: {
    textToImage: true,
    supportsOnImageText: false,
    supportedAspects: ["1:1", "4:5", "16:9", "9:16", "21:9"]
  }
};

const illustrationModel: ModelInfo = {
  id: "fal-ai/illustration-suite",
  name: "Illustration Suite",
  kind: "image",
  tags: ["illustration", "vector"],
  capabilities: {
    textToImage: true,
    supportsOnImageText: false,
    supportedAspects: ["1:1", "16:9"]
  }
};

const geminiPreviewModel: ModelInfo = {
  id: "fal-ai/gemini-3-pro-image-preview",
  name: "Gemini 3 Pro Image Preview",
  kind: "image",
  tags: [],
  capabilities: {
    textToImage: true,
    supportsOnImageText: false,
    supportedAspects: ["1:1", "16:9", "9:16"]
  }
};

const memorialDayOfferBrief: CreativeBrief = {
  resortName: "Westgate Branson Woods Resort",
  headline: "Branson Memorial Day Family Getaway",
  offer: "Memorial Day deal from $99",
  subheadline: "Three nights near the best of Branson",
  ctaText: "Book Now",
  brandColors: ["#005A8B", "#E21D38"],
  location: "Branson, MO",
  campaignName: "Memorial Day Family Getaway",
  promotionSummary: "Promote a Memorial Day family getaway for 3 nights.",
  targetAudience: "families looking for an active holiday weekend",
  tone: "fun, family-friendly, active, vacation-ready",
  mustIncludeVisualElements: ["3 Nights", "Memorial Day color accents"],
  mustAvoidElements: ["generic family fun tagline"]
};

const julyFourthOfferBrief: CreativeBrief = {
  resortName: "Westgate Lakes Resort & Spa",
  headline: "Orlando 4th of July Vacation Package",
  offer: "Limited offer from $149",
  subheadline: "Four days and three nights close to Orlando attractions",
  ctaText: "Reserve",
  brandColors: ["#005A8B", "#E21D38"],
  location: "Orlando, FL",
  campaignName: "4th of July Orlando Getaway",
  promotionSummary: "Create an Independence Day offer ad for a 4 days / 3 nights Orlando trip.",
  targetAudience: "families and theme park travelers",
  tone: "bold, patriotic, energetic",
  mustIncludeVisualElements: ["4 Days / 3 Nights", "fireworks-inspired color contrast"],
  mustAvoidElements: []
};

const lasVegasJulyFourthBrief: CreativeBrief = {
  resortName: "Westgate Las Vegas Resort & Casino",
  headline: "Las Vegas 4th of July Vacation Packages | Westgate Reservations",
  offer: "from $99",
  subheadline:
    "Experience Independence Day like never before with Las Vegas 4th of July packages for $99!",
  ctaText: "Book By Phone",
  brandColors: ["#0e2545", "#c4a55d", "#d95d31", "#3892dc", "#148dd0"],
  location: "Las Vegas, NV",
  campaignName: "July 4th",
  promotionSummary:
    "Promote from $99 for Las Vegas 4th of July Vacation Packages | Westgate Reservations at Westgate Las Vegas Resort & Casino in Las Vegas, NV. Package highlights: Act Fast - Seasonal Offer, 4 Days / 3 Nights, Pet Friendly, Monorail Pick-up & Drop-off.",
  targetAudience: "Families and theme-park travelers planning an Orlando vacation",
  tone: "energetic, family-fun",
  mustIncludeVisualElements: [
    "Las Vegas, NV vacation setting",
    "Westgate Las Vegas Resort & Casino resort atmosphere",
    "Act Fast - Seasonal Offer",
    "4 Days / 3 Nights",
    "Pet Friendly",
    "Monorail Pick-up & Drop-off"
  ],
  mustAvoidElements: []
};

const orlandoJulyFourthBrief: CreativeBrief = {
  resortName: "Westgate Lakes Resort & Spa",
  headline: "Orlando 4th of July Vacation Packages | Independence Day Deals | Westgate Reservations",
  offer: "from $99",
  subheadline:
    "Looking for the best Orlando 4th of July vacation packages and deals for the entire family?",
  ctaText: "Book By Phone",
  brandColors: ["#0e2545", "#c4a55d", "#d95d31", "#3892dc", "#148dd0"],
  location: "Orlando, FL",
  campaignName: "July 4th",
  promotionSummary:
    "Promote from $99 for Orlando 4th of July Vacation Packages | Independence Day Deals | Westgate Reservations at Westgate Lakes Resort & Spa in Orlando, FL. Package highlights: Act Fast - Seasonal Offer, 4 Days / 3 Nights, Pet-Friendly, Near Universal & Other Attractions.",
  targetAudience: "Families and theme-park travelers planning an Orlando vacation",
  tone: "energetic, family-fun",
  mustIncludeVisualElements: [
    "Orlando, FL vacation setting",
    "Westgate Lakes Resort & Spa resort atmosphere",
    "Act Fast - Seasonal Offer",
    "4 Days / 3 Nights",
    "Pet-Friendly",
    "Near Universal & Other Attractions"
  ],
  mustAvoidElements: []
};

let tempDir: string;
let brandGuidelinesPath: string;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(process.cwd(), "cache", "prompt-builder-"));
  brandGuidelinesPath = path.join(tempDir, "brand-guidelines.md");
  await writeFile(
    brandGuidelinesPath,
    [
      "# Brand Guidelines",
      "Voice: welcoming, polished, easygoing.",
      "Required visuals: Westgate blue palette, sunlit hospitality photography.",
      "Forbidden: competitor names, unsafe pool behavior."
    ].join("\n"),
    "utf8"
  );
});

afterEach(async () => {
  await rm(tempDir, { force: true, recursive: true });
});

describe("buildPrompt", () => {
  it("builds concise Meta landscape offer prompts with central 60% crop guidance", async () => {
    const result = await buildPrompt({
      brief,
      channel: "meta",
      size: size("meta", "Feed landscape"),
      model: photorealTextModel,
      seed: 1234,
      brandGuidelinesPath
    });

    expect(result.seed).toBe(1234);
    expect(result.aspectRatio).toBe("16:9");
    expect(result.prompt).toContain("Save 30%");
    expect(result.prompt).toContain("Design a landscape direct-response travel ad");
    expect(result.prompt).toContain('Main headline: "Spring Family Getaway"');
    expect(result.prompt).toContain("central 60% horizontal band");
    expect(result.prompt).toContain("avoid the outer left and right thirds");
    expect(result.prompt).not.toContain("Use the reference image");
    expect(result.prompt).not.toContain("Creative direction:");
    expect(result.prompt).not.toContain("Brand guidelines:");
    expect(result.prompt).not.toContain("Style modifiers");
    expectNoBrandOrLogoText(result.prompt);
    expectNoBrandOrLogoText(result.negativePrompt);
    expect(result.negativePrompt).toContain("no brand marks");
    expect(result.negativePrompt).toContain("no text artifacts");
    expect(result.negativePrompt).toContain("competitor branding");
    expect(result.negativePrompt).not.toContain("no typography");
  });

  it("builds Meta Stories prompts with vertical safe-zone guidance", async () => {
    const result = await buildPrompt({
      brief,
      channel: "meta",
      size: size("meta", "Stories/Reels"),
      model: photorealModel,
      seed: 2222,
      brandGuidelinesPath
    });

    expect(result.aspectRatio).toBe("9:16");
    expect(result.prompt).toContain("vertical");
    expect(result.prompt).toContain("subject centered");
    expect(result.prompt).toContain("top and bottom safe zones");
    expectNoBrandOrLogoText(result.prompt);
  });

  it("builds Google Display narrow-unit prompts with center 60% guidance", async () => {
    const result = await buildPrompt({
      brief,
      channel: "google_display",
      size: size("google_display", "Leaderboard"),
      model: photorealModel,
      seed: 3333,
      brandGuidelinesPath
    });

    expect(result.aspectRatio).toBe("21:9");
    expect(result.prompt).toContain("Design a landscape direct-response travel ad");
    expect(result.prompt).toContain("offer hierarchy in the center 60% of the frame");
    expectNoBrandOrLogoText(result.prompt);
  });

  it("builds Website prompts as no-text concept photography with HTML overlay negative space", async () => {
    const result = await buildPrompt({
      brief,
      channel: "website",
      size: size("website", "Hero wide"),
      model: photorealModel,
      seed: 4444,
      brandGuidelinesPath
    });

    expect(result.prompt).toContain("creative direction only");
    expect(result.prompt).toContain("strong negative space left or right for HTML overlay");
    expect(result.prompt).toContain("brand-informed color palette");
    expect(result.prompt).not.toContain("files are never overlaid");
    expect(result.prompt).not.toContain("structured on-image text");
    expect(result.negativePrompt).toContain("no text");
    expect(result.negativePrompt).toContain("no typography");
    expect(result.negativePrompt).toContain("no letters");
    expect(result.negativePrompt).toContain("no words");
    expect(result.negativePrompt).toContain("no brand marks");
    expect(result.negativePrompt).toContain("no watermarks");
    expect(result.negativePrompt).toContain("no captions");
    expect(result.negativePrompt).toContain("no readable signage");
    expect(result.negativePrompt).toContain("no UI elements");
    expect(result.negativePrompt).toContain("no graphic overlays");
    expectNoBrandOrLogoText(result.prompt);
    expectNoBrandOrLogoText(result.negativePrompt);
  });

  it("builds Email Internal prompts with balanced near-square composition", async () => {
    const result = await buildPrompt({
      brief,
      channel: "email_internal",
      size: size("email_internal", "Email near-square"),
      model: photorealModel,
      seed: 5555,
      brandGuidelinesPath
    });

    expect(result.aspectRatio).toBe("1:1");
    expect(result.prompt).toContain("Email Internal");
    expect(result.prompt).toContain("balanced central composition");
    expect(result.prompt).toContain("near-square framing");
    expect(result.negativePrompt).toContain("no typography");
  });

  it("builds SEO prompts with editorial magazine composition and strict no-overlay negatives", async () => {
    const result = await buildPrompt({
      brief,
      channel: "seo",
      size: size("seo", "Horizontal article"),
      model: photorealModel,
      seed: 6666,
      brandGuidelinesPath
    });

    expect(result.aspectRatio).toBe("21:9");
    expect(result.prompt).toContain("SEO");
    expect(result.prompt).toContain("editorial, clean, magazine-feature aesthetic");
    expect(result.negativePrompt).toContain("no graphic overlays");
  });

  it("uses illustration style modifiers for illustration and vector models", async () => {
    const result = await buildPrompt({
      brief,
      channel: "seo",
      size: size("seo", "Horizontal hero"),
      model: illustrationModel,
      seed: 7777,
      brandGuidelinesPath
    });

    expect(result.prompt).toContain("flat illustration, brand palette, editorial style");
    expect(result.prompt).not.toContain("cinematic, 35mm");
  });

  it("builds a Westgate direct-response offer template for text-capable Meta square prompts", async () => {
    const result = await buildPrompt({
      brief: memorialDayOfferBrief,
      channel: "meta",
      size: size("meta", "Feed square"),
      model: photorealTextModel,
      seed: 8888,
      brandGuidelinesPath
    });

    expect(result.prompt).toContain("Design a square direct-response travel ad");
    expect(result.prompt).toContain("layered text blocks");
    expect(result.prompt).toContain("huge central price");
    expect(result.prompt).toContain("graphic should only occupy 40%");
    expect(result.prompt).toContain('Main headline: "Memorial Day Family Getaway"');
    expect(result.prompt).toContain('price: "$99"');
    expect(result.prompt).toContain('banner under price: "3 NIGHTS"');
    expect(result.prompt).toContain('Small promotional badge: "MEMORIAL DAY"');
    expect(result.prompt).toContain("simple bright color contrast");
    expect(result.prompt).not.toContain("lake adventures");
    expect(result.prompt).not.toContain("memories that last a lifetime");
    expectNoBrandOrLogoText(result.prompt);
    expectNoBrandOrLogoText(result.negativePrompt);
  });

  it("adapts the offer template to July 4th destination and duration details", async () => {
    const result = await buildPrompt({
      brief: julyFourthOfferBrief,
      channel: "google_display",
      size: size("google_display", "Responsive square"),
      model: photorealTextModel,
      seed: 9999,
      brandGuidelinesPath
    });

    expect(result.prompt).toContain("Design a square direct-response travel ad");
    expect(result.prompt).toContain("Orlando July 4th family getaway");
    expect(result.prompt).toContain('price: "$149"');
    expect(result.prompt).toContain('banner under price: "3 NIGHTS"');
    expect(result.prompt).toContain('Small promotional badge: "4TH OF JULY"');
    expect(result.prompt).toContain('Main headline: "July 4th Family Getaway"');
    expectNoBrandOrLogoText(result.prompt);
    expectNoBrandOrLogoText(result.negativePrompt);
  });

  it("builds a concise no-brand default prompt for text-capable July 4th Meta ads", async () => {
    const result = await buildPrompt({
      brief: lasVegasJulyFourthBrief,
      channel: "meta",
      size: size("meta", "Feed square"),
      model: photorealTextModel,
      seed: 1010,
      brandGuidelinesPath
    });

    expect(result.prompt).toContain(
      "Design a square direct-response travel ad promoting a Las Vegas July 4th family getaway."
    );
    expect(result.prompt).toContain(
      "The ad creative should feel fun, family-friendly, active, and vacation-ready"
    );
    expect(result.prompt).toContain("layered text blocks and strong price hierarchy");
    expect(result.prompt).toContain("huge central price");
    expect(result.prompt).toContain("simple bright color contrast");
    expect(result.prompt).toContain("Make sure the whole creative is July 4th theme.");
    expect(result.prompt).toContain("the graphic should only occupy 40% of the whole ad creative");
    expect(result.prompt).toContain('Main headline: "July 4th Family Getaway"');
    expect(result.prompt).toContain('price: "$99"');
    expect(result.prompt).toContain('banner under price: "3 NIGHTS"');
    expect(result.prompt).toContain('Small promotional badge: "4TH OF JULY"');
    expect(result.prompt).not.toContain("Creative direction:");
    expect(result.prompt).not.toContain("campaign summary:");
    expect(result.prompt).not.toContain("Lifestyle subject:");
    expect(result.prompt).not.toContain("Families and theme-park travelers planning an Orlando vacation");
    expect(result.prompt).not.toContain("Package highlights");
    expect(result.prompt).not.toContain("Brand guidelines:");
    expect(result.prompt).not.toContain("Style modifiers");
    expect(result.prompt).not.toContain("Reservations");
    expectNoBrandOrLogoText(result.prompt);
    expectNoBrandOrLogoText(result.negativePrompt);
  });

  it("uses the clean no-brand ad prompt for Meta even when the selected model is not text-capable", async () => {
    const result = await buildPrompt({
      brief: orlandoJulyFourthBrief,
      channel: "meta",
      size: size("meta", "Feed square"),
      model: geminiPreviewModel,
      seed: 1212,
      brandGuidelinesPath
    });

    expect(result.prompt).toContain(
      "Design a square direct-response travel ad promoting an Orlando July 4th family getaway."
    );
    expect(result.prompt).toContain('Main headline: "July 4th Family Getaway"');
    expect(result.prompt).toContain('price: "$99"');
    expect(result.prompt).toContain('banner under price: "3 NIGHTS"');
    expect(result.prompt).toContain('Small promotional badge: "4TH OF JULY"');
    expect(result.prompt).not.toContain("Creative direction:");
    expect(result.prompt).not.toContain("campaign summary:");
    expect(result.prompt).not.toContain("Package highlights");
    expect(result.prompt).not.toContain("Brand guidelines:");
    expect(result.prompt).not.toContain("Style modifiers");
    expect(result.prompt).not.toContain("Reservations");
    expectNoBrandOrLogoText(result.prompt);
    expectNoBrandOrLogoText(result.negativePrompt);
  });

  it("does not inject the offer-ad text template into no-text website prompts", async () => {
    const result = await buildPrompt({
      brief: memorialDayOfferBrief,
      channel: "website",
      size: size("website", "Hero wide"),
      model: photorealTextModel,
      seed: 1111,
      brandGuidelinesPath
    });

    expect(result.prompt).toContain("creative direction only");
    expect(result.prompt).not.toContain("direct-response promotional offer ad");
    expect(result.prompt).not.toContain("large layered text blocks");
    expect(result.prompt).not.toContain("huge central price");
    expect(result.prompt).not.toContain("duration banner");
    expectNoBrandOrLogoText(result.prompt);
    expectNoBrandOrLogoText(result.negativePrompt);
    expect(result.negativePrompt).toContain("no text");
  });
});

function size(channel: ChannelKey, name: string): ChannelSize {
  const found = channels[channel].sizes.find((channelSize) => channelSize.name === name);

  if (!found) {
    throw new Error(`Missing test size ${channel}:${name}`);
  }

  return found;
}

function expectNoBrandOrLogoText(value: string) {
  expect(value).not.toMatch(/\bwestgate\b/i);
  expect(value).not.toMatch(/\blogos?\b/i);
}
