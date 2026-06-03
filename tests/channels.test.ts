import { channels, email_internal, meta, seo, website } from "../src/config/channels";

describe("channel config", () => {
  it("defines Meta's four final target sizes", () => {
    expect(meta.sizes.map((size) => `${size.w}x${size.h}`)).toEqual([
      "1080x1350",
      "1080x1920",
      "1200x1200",
      "1920x1080"
    ]);
  });

  it("defines exactly two Email Internal sizes", () => {
    expect(email_internal.sizes).toHaveLength(2);
    expect(email_internal.sizes.map((size) => `${size.w}x${size.h}`)).toEqual([
      "600x585",
      "420x420"
    ]);
  });

  it("forbids on-image text for Website, Email Internal, and SEO", () => {
    expect(website.allowOnImageText).toBe(false);
    expect(email_internal.allowOnImageText).toBe(false);
    expect(seo.allowOnImageText).toBe(false);
  });

  it("exports every required channel key", () => {
    expect(Object.keys(channels)).toEqual([
      "meta",
      "google_display",
      "website",
      "email_internal",
      "seo"
    ]);
  });
});
