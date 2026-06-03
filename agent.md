# agent.md — Resort Ad Creative Generator (Local Web App)

## Project Purpose
This is a **locally-run web application** that generates paid social, display,
website, email, and SEO creatives for a resort company. The user opens the app
in their browser, fills out a guided form (landing page URL, brief, channel
selection, brand options), and the app generates creatives via the fal.ai API,
sized correctly for each channel.

There is **NO CLI**. All interaction happens through the web UI.

## Core User Flow (Web UI)
1. User runs `npm run dev` and opens `http://localhost:3000`.
2. **Step 1 — Landing Page**: User pastes the landing page URL. App scrapes
   it server-side and shows the extracted fields (resort name, headline,
   offer, dates, hero image, brand colors). User can edit any field inline
   before continuing.
3. **Step 2 — Campaign Brief**: User fills in or confirms:
   - Campaign name
   - Promotion summary (free text)
   - Target audience (couples, families, luxury, etc.)
   - Tone (relaxed, energetic, romantic, premium, family-fun)
   - Must-include visual elements
   - Must-avoid elements
4. **Step 3 — Channel Selection**: User toggles which channels to generate
   for (Meta, Google Display, Website, Email Internal, SEO). Each channel
   shows its sizes and a clear badge: **"With overlays"** or
   **"Concept photo only — no text, no logo"**.
5. **Step 4 — Model Selection**: User picks the image and (optional) video
   model for each channel from a **searchable dropdown** of all available
   fal.ai models (see "Model Discovery & Selection" below). The app
   suggests a sensible default for each channel but the user has full
   control. Cost estimate updates live as selections change. A **Dry Run**
   toggle is available. User must confirm if estimated cost > $5.
6. **Step 5 — Creative Direction**: User chats with the AI Creative Director
   agent. The agent asks needed discovery questions, proposes 2–3 creative
   angles/signature visual hooks, waits for user approval, then generates the
   channel/size prompts for Review.
7. **Step 6 — Review**: User sees the resolved prompts, models, sizes, and
   cost summary. Can edit prompts inline before generating.
8. **Step 7 — Generate**: User clicks Generate. UI streams progress per job
   (queued → running → done/failed) with thumbnails appearing live.
9. **Step 8 — Review Results**: Results page shows a contact sheet grouped
   by channel, with download links (individual + ZIP per channel + ZIP all).
   Re-roll button per image (uses same prompt + model, new seed). User can
   also re-roll with a *different* model from the dropdown.

## Tech Stack (DO NOT CHANGE WITHOUT ASKING)
- Framework: **Next.js 14+ (App Router)** with TypeScript
- UI: React + Tailwind CSS + shadcn/ui components
- Forms: react-hook-form + zod
- Server: Next.js API routes / Server Actions
- Real-time progress: Server-Sent Events (SSE) from `/api/generate/stream`
- Searchable dropdown: shadcn/ui `Combobox` (built on Radix + cmdk)
- Scraping: undici + cheerio (Playwright fallback only if cheerio fails)
- Image processing: sharp
- Video processing: fluent-ffmpeg
- fal.ai SDK: @fal-ai/client (server-side only, never in browser)
- Logging: pino
- Tests: vitest + @testing-library/react
- ZIP packaging: archiver

## Project Structure
```
/
├── app/
│   ├── page.tsx                  ← Step 1 (URL input)
│   ├── brief/page.tsx            ← Step 2
│   ├── channels/page.tsx         ← Step 3
│   ├── models/page.tsx           ← Step 4 (model selection per channel)
│   ├── creative/page.tsx         ← Step 5 (AI creative direction chat)
│   ├── review/page.tsx           ← Step 6
│   ├── generate/page.tsx         ← Step 7 (live progress)
│   ├── results/[runId]/page.tsx  ← Step 8
│   └── api/
│       ├── scrape/route.ts          ← POST { url } → CreativeBrief
│       ├── models/route.ts          ← GET ?q=…&kind=image|video → ModelInfo[]
│       ├── models/refresh/route.ts  ← POST → re-fetch the catalog
│       ├── estimate/route.ts        ← POST { brief, channels, models } → cost
│       ├── runs/[runId]/creative/route.ts ← POST chat/concepts/approval
│       ├── generate/route.ts        ← POST → returns runId
│       ├── generate/stream/route.ts ← SSE per runId
│       ├── reroll/route.ts          ← POST { runId, assetId, modelId? }
│       └── download/[runId]/route.ts← ZIP download
├── src/
│   ├── generators/fal-client.ts  ← THE ONLY place fal.ai is called
│   ├── generators/prompt-builder.ts
│   ├── generators/post-processor.ts
│   ├── models/catalog.ts         ← fal.ai model catalog loader + cache
│   ├── models/router.ts          ← suggest-default + capability checks
│   ├── scraper/landing-page.ts
│   ├── config/channels.ts        ← Channel rules + sizes (single source of truth)
│   ├── lib/runs.ts               ← Run state (in-memory + disk persistence)
│   └── lib/logger.ts
├── components/
│   ├── ModelCombobox.tsx         ← searchable dropdown of all fal models
│   ├── ChannelModelPicker.tsx    ← per-channel image+video selector
│   └── …                         ← forms, contact sheet, etc.
├── outputs/<campaign-slug>/<runId>/   ← generated assets
├── cache/
│   ├── models-catalog.json       ← cached fal.ai model list
│   └── scrape/                   ← cached landing-page scrapes
├── brand-assets/
│   └── brand-guidelines.md
└── CLAUDE.md
```

## Coding Conventions
- TypeScript strict mode. No `any` unless justified with a comment.
- All external inputs validated with zod schemas (shared between client + server).
- All fal.ai calls go through `src/generators/fal-client.ts`. Never call the
  SDK from a React component or any other module.
- All fal.ai calls happen **server-side only**. The `FAL_KEY` must never reach
  the browser bundle. Verify with `next build` output.
- All filesystem writes go under `outputs/` or `cache/`. Never write outside.
- Use async/await, no callbacks. Use `Promise.allSettled` for batch jobs.
- Cost-sensitive: every fal.ai call MUST be logged to
  `outputs/<campaign>/<runId>/cost-log.jsonl` with model, params, and reported cost.
- React components: server components by default; mark `"use client"` only
  when interactivity is required (forms, progress streams, comboboxes).

## fal.ai Integration Rules
- Auth via `FAL_KEY` env var, loaded via `.env.local`. Never hardcode. Never
  expose to the client. The SDK is imported only in files under `app/api/**`
  or `src/generators/**`.
- Use `fal.subscribe()` for long-running jobs (image-to-video, large batches).
- Use `fal.queue.submit()` + polling when running >5 jobs concurrently.
- Always include `seed` in output metadata for reproducibility.
- Retry policy: 3 retries with exponential backoff on 5xx and rate-limit errors.
- If a model rejects a prompt (safety filter), log it, surface the error in
  the UI for that specific asset, and continue with the rest of the batch.

## Model Discovery & Selection
The user picks **any** fal.ai model — the app does not maintain a curated
allow-list. The catalog is fetched dynamically and exposed via a searchable
dropdown.

### Catalog source
- Primary: fetch from fal.ai's public model index (the same data that powers
  https://fal.ai/models). Implementation lives in `src/models/catalog.ts`.
- Cache the response on disk at `cache/models-catalog.json` with a TTL of
  **24 hours**. The catalog is also served in-memory on the server.
- A "Refresh catalog" button on the model selection page calls
  `POST /api/models/refresh` to bust the cache.
- If the live fetch fails, fall back to the last cached copy and surface a
  small warning in the UI ("Showing cached catalog from <timestamp>").
- If no cache exists and the live fetch fails, the UI shows an error state
  with a manual "Enter model id" text input as a last resort. The entered
  id is validated by attempting a tiny dry submission to the fal.ai
  endpoint before being accepted.

### ModelInfo shape (what each dropdown row carries)
```ts
type ModelInfo = {
  id: string;                  // e.g. "fal-ai/flux-pro/v1.1-ultra"
  name: string;                // human label
  kind: "image" | "video" | "audio" | "other";
  description?: string;
  tags?: string[];             // e.g. ["text-to-image", "photorealistic"]
  thumbnailUrl?: string;
  pricing?: {                  // best-effort, may be null
    unit: "image" | "second" | "megapixel" | "request";
    amountUsd: number;
  };
  capabilities?: {
    textToImage?: boolean;
    imageToImage?: boolean;
    imageToVideo?: boolean;
    supportsOnImageText?: boolean;  // true for Ideogram-class models
    maxResolution?: { w: number; h: number };
    supportedAspects?: string[];     // e.g. ["1:1","16:9","9:16"]
  };
};
```
The catalog loader best-effort-populates `kind`, `capabilities`, and
`pricing` from fal.ai metadata + a small heuristic layer. Anything unknown
is left undefined and the UI degrades gracefully.

### The Combobox (`components/ModelCombobox.tsx`)
- Built with shadcn/ui `Command` + `Popover` (cmdk under the hood).
- **Backed by `GET /api/models?q=…&kind=image|video`** so search happens
  server-side against the cached catalog (fast even if the catalog is huge).
- Each row shows: thumbnail, name, model id (small), tags, pricing badge.
- Filters at the top: `[All] [Image] [Video]` and a tag chip row
  (text-to-image, image-to-image, image-to-video, photoreal,
  illustration, supports-on-image-text, fast, premium).
- Keyboard accessible. Highlights search-term matches. Shows "Most used in
  this project" at the top (read from a small `cache/model-usage.json`).
- A footer link "Open on fal.ai ↗" for each model so the user can read docs.

### `ChannelModelPicker.tsx` (used on Step 4)
For each selected channel, the user sees:
- **Image model** (required) — `ModelCombobox` filtered to `kind=image`.
- **Video model** (optional, only shown if user toggles "Generate video for
  this channel") — `ModelCombobox` filtered to `kind=video`.
- A "Suggest default" button that calls `src/models/router.ts` to pick a
  reasonable model based on the channel's rules (see "Default Suggestions"
  below). Clicking it just pre-fills the combobox; the user can change it.
- A capability warning banner if the chosen model conflicts with the
  channel's rules (see "Hard Constraints" below). The Generate button is
  disabled until conflicts are resolved.

### Default suggestions (NOT a hard allow-list)
`src/models/router.ts` exposes `suggestDefaultModel(channel, kind)` which
returns a model id from the catalog using these heuristics:
- For channels with `allowOnImageText: true` and the brief includes
  on-image text → prefer a model whose `capabilities.supportsOnImageText`
  is true. Tiebreak by lower price.
- For channels with `allowOnImageText: false` → prefer a photoreal
  text-to-image model whose `supportsOnImageText` is **not** required.
  Tiebreak by lower price.
- For video → prefer image-to-video models with `supportedAspects`
  matching the channel sizes.
These are suggestions only. The user can override.

### Hard Constraints (enforced regardless of model selection)
The user's freedom to pick any model does NOT relax channel rules. Before
running:
1. If a channel has `allowOnImageText: false` and the user picked a model
   whose `capabilities.supportsOnImageText === true` (Ideogram-class), the
   UI shows a warning: *"This model bakes text into images. The selected
   channel forbids on-image text. Continue anyway, with strict negative
   prompts? [Cancel] [Yes, force no-text mode]"*. If the user proceeds, the
   prompt builder injects aggressive no-text negatives and the
   post-processor runs an OCR check (see below).
2. The post-processor runs OCR (tesseract.js, server-side) on every output
   for `allowOnImageText: false` channels. If text is detected at >0.6
   confidence, the asset is flagged in the UI with a "Text detected — re-roll
   recommended" badge. It is NOT auto-deleted; the reviewer decides.
3. The Generate button is disabled if any required ModelCombobox is empty
   or the chosen model's `capabilities.maxResolution` is smaller than the
   smallest target size for the channel.

## Channel Rules (READ BEFORE BUILDING ANY PROMPT)
This table is the single source of truth and is mirrored in
`src/config/channels.ts`. The UI reads from this file to render badges,
size lists, and override controls.

| Channel        | allowOnImageText | overlayLogo | overlayCTA | overlayHeadline | UI Badge                          |
|----------------|------------------|-------------|------------|------------------|-----------------------------------|
| meta           | true             | true        | true       | true             | "With overlays"                   |
| google_display | true             | true        | true       | true             | "With overlays"                   |
| website        | false            | false       | false      | false            | "Concept photo only — no text/logo" |
| email_internal | false            | false       | false      | false            | "Concept photo only — no text/logo" |
| seo            | false            | false       | false      | false            | "Concept as is — no overlays"     |

If a channel has `allowOnImageText: false`:
- Prompt MUST include negative prompts: "no text, no typography, no letters,
  no words, no logos, no watermarks, no captions, no signage with readable
  text, no UI elements, no graphic overlays".
- Post-processor MUST skip logo, CTA, and headline overlay steps.
- Post-processor MUST run an OCR pass and flag any output with detected text.
- The `ChannelModelPicker` MUST visibly warn (and require explicit confirm)
  when the user selects a model that advertises `supportsOnImageText: true`.

## Channel Size Specifications

### Meta (Facebook + Instagram) — `allowOnImageText: true`
- Feed portrait:      1080×1350  (4:5)
- Stories/Reels:      1080×1920  (9:16)
- Feed square:        1200×1200  (1:1)
- Feed landscape:     1920×1080  (16:9)

Generation dimensions for Meta are intentionally multiple-of-16 sizes:
- Feed portrait:      generate 1088×1360, resize/crop to 1080×1350
- Stories/Reels:      generate 1088×1920, resize/crop to 1080×1920
- Feed square:        generate 1200×1200, resize/crop to 1200×1200
- Feed landscape:     generate 1920×1088, resize/crop to 1920×1080

Composition note for the 16:9 landscape (1920×1080): mobile feed crops
aggressively, so the prompt builder must keep the key subject and any
on-image text within the **central 60% horizontal band**. Avoid critical
elements in the outer left/right thirds.

### Google Display — `allowOnImageText: true`
- Medium rectangle:   300×250
- Large rectangle:    336×280
- Leaderboard:        728×90
- Half page:          300×600
- Large mobile:       320×100
- Responsive square:  1200×1200
- Responsive landsc:  1200×628
- Skyscraper:         160×600

### Website — `allowOnImageText: false` (CONCEPT PHOTO ONLY, NO TEXT, NO LOGO)
- Hero wide:          1400×600   (~2.33:1)
- Banner short:       980×305    (~3.21:1)
- Feature large:      1076×800   (~1.35:1)
- Feature small:      592×440    (~1.35:1)
- Strip banner:       800×310    (~2.58:1)

Strategy: produce a clean, evocative resort photograph with strong negative
space so the website team can place their own headlines/CTAs in HTML/CSS on
top. Generate at the closest native aspect ratio supported by the model,
then crop down — never upscale.

### Email Internal — `allowOnImageText: false` (CONCEPT PHOTO ONLY, NO TEXT, NO LOGO)
Each campaign produces exactly:
- 1 × 600×585    (~1.03:1, near-square)
- 1 × 420×420    (1:1)

Strategy: a single hero concept rendered in both crops. Generate ONE master
image at the highest native ratio, then produce both crops from the same
master so the visual story is consistent. Use the same `seed` for both.

### SEO — `allowOnImageText: false` ("CONCEPT AS IS")
- Horizontal article: 950×270    (~3.52:1)
- Horizontal hero:    800×450    (16:9)

Strategy: clean editorial concept imagery with no overlays. The 950×270 is
extremely wide — generate at a wider native aspect (e.g., 21:9 or wider)
and crop. The 800×450 is standard 16:9.

## Resize / Crop Rules
- Always generate at an aspect ratio CLOSE TO the target, then crop. Never
  upscale beyond 1.0× the model's native output.
- Before submitting, check the chosen model's `capabilities.supportedAspects`
  and `maxResolution`. If the requested ratio isn't supported, pick the
  nearest supported wider ratio and crop.
- For ultra-wide targets (728×90, 950×270, 800×310, 980×305): generate at
  the nearest wider native ratio and use `sharp.extract()` with
  subject-aware centering. If subject detection confidence is low, the UI
  must surface the asset for manual crop adjustment before finalizing.
- For multi-size families that must look consistent (Email Internal's
  600×585 + 420×420, Website's 1076×800 + 592×440), use the SAME seed and
  the SAME prompt; only the crop changes.
- For Meta's 1920×1080 landscape: prefer models that natively support 16:9.
  If not available, generate at the nearest wider ratio and center-crop.

## Landing Page Scraping
The `/api/scrape` endpoint extracts and returns a `CreativeBrief`:
- `resortName`        — from <title>, og:site_name, or schema.org
- `headline`          — h1 or og:title
- `subheadline`       — h2 or meta description
- `offer`             — regex for price patterns ($\d+, \d+% off, "save $X")
- `validDates`        — date-range patterns
- `ctaText`           — button text ("Book Now", "Reserve")
- `heroImageUrl`      — og:image
- `brandColors`       — extract from CSS / hero image dominant colors
- `location`          — from schema.org Place or page content

If extraction fails for a critical field (resortName, headline, offer), the
UI must show the field as **empty + flagged red** and require the user to
fill it in before advancing. Do NOT auto-guess on the server.

NOTE: For channels with `allowOnImageText: false`, scraped headline /
offer / CTA are used ONLY as creative direction context for the prompt —
they MUST NEVER appear as rendered text in the output image.

## Brand Guidelines (brand-assets/brand-guidelines.md)
Read this file at the start of every generation run. The prompt builder
must inject:
- Brand voice tokens
- Required visual elements (palette, photographic style references)
- FORBIDDEN elements (competitor names, prohibited imagery)

For `allowOnImageText: false` channels, brand color palette still informs
the scene (lighting, wardrobe, decor) but logo files are NEVER overlaid.

## Prompt Building Rules
1. Start with the brief's offer + headline as creative direction (NOT as
   text to render, unless channel allows on-image text AND the chosen
   model's `capabilities.supportsOnImageText === true`).
2. Add resort context ("luxury beachfront resort in Cancun…").
3. Add lifestyle subject ("couple at sunset, family by pool…").
4. Add style modifiers tuned to the chosen model family (read from
   `ModelInfo.tags`):
   - Photoreal/diffusion models: "cinematic, 35mm, golden hour, shallow
     depth of field"
   - Text-capable models: structured text-rendering instructions (only
     when channel + model both allow it)
   - Illustration/vector models: "flat illustration, brand palette,
     editorial style"
5. Add channel-aware composition guidance:
   - Meta Stories/Reels (9:16): vertical, subject centered, safe zones top/bottom
   - Meta Feed Landscape (16:9, 1920×1080): subject + any text in central
     60% horizontal band; avoid outer left/right thirds (mobile feed crops)
   - Google Display narrow units: subject in center 60% of frame
   - Website wide banners: strong negative space LEFT or RIGHT for HTML overlay
   - Email Internal: balanced central composition, near-square framing
   - SEO: editorial, clean, magazine-feature aesthetic
6. Add negative prompts. ALWAYS include "no other brand logos, no text
   artifacts". For `allowOnImageText: false` channels, additionally add:
   "no text, no typography, no letters, no words, no logos, no watermarks,
   no captions, no readable signage, no UI elements, no graphic overlays".
7. Show the final prompt in the UI's Review step (Step 6) BEFORE the user
   clicks Generate. The user can edit it inline.

## Web UI Requirements
- Multi-step wizard (Steps 1–8 above) with a sticky progress bar.
- Each step is its own route so the user can navigate back without losing state.
- Run state is persisted server-side keyed by `runId`; the client uses
  `runId` to resume on refresh.
- Step 4 features the **`ChannelModelPicker`** with searchable dropdowns
  for image and (optional) video, filter chips, and live cost recompute.
- Step 5 is an AI Creative Direction chat. It persists messages, proposed
  concepts, the approved concept, and generated prompts server-side on the
  run. The user must approve a concept before continuing to Review.
- Step 6 Review displays the prompts produced by Creative Direction when
  present, while still allowing inline edits and prompt assignments.
- The Generate page uses **Server-Sent Events** (`/api/generate/stream`) to
  push job updates: `{ assetId, status, progress, thumbnailUrl, error? }`.
- The Results page shows a **contact sheet** grouped by channel. Each
  channel section has a header with its rule badge so reviewers don't
  expect text/logos on Website / Email / SEO assets. Each asset card shows
  the model id used (so the team can correlate cost ↔ model ↔ output).
- Re-roll button per asset opens a small popover with the current prompt
  and a `ModelCombobox` defaulting to the original model. User can keep
  the same model + new seed, or pick a different model entirely.
- Download buttons:
  - Per asset (single file)
  - Per channel (ZIP)
  - All (ZIP, foldered by channel)
- Cost meter (top-right) shows running total during generation. Hard stop
  with a confirm modal if estimated cost exceeds $5; the user must click
  through to proceed.
- A **Dry Run** toggle on Step 4 simulates the entire flow with placeholder
  images (no fal.ai calls). Used for testing the UI without spend.
- Mobile-responsive enough to review results on a phone, but the primary
  target is desktop ≥1280px.

## Output Conventions
For each run:
```
outputs/<campaign-slug>/<runId>/
  brief.json              ← the resolved CreativeBrief
  selections.json         ← per-channel chosen models (image + video)
  prompts.jsonl           ← every prompt sent
  cost-log.jsonl          ← every fal.ai call + cost + model id
  raw/                    ← original fal.ai outputs
  final/
    meta/
      meta_feed-portrait_1080x1350_v1.jpg
      meta_stories-reels_1080x1920_v1.jpg
      meta_feed-square_1200x1200_v1.jpg
      meta_feed-landscape_1920x1080_v1.jpg
    google_display/
      gdn_300x250_v1.jpg
      gdn_336x280_v1.jpg
      gdn_728x90_v1.jpg
      gdn_300x600_v1.jpg
      gdn_320x100_v1.jpg
      gdn_1200x1200_v1.jpg
      gdn_1200x628_v1.jpg
      gdn_160x600_v1.jpg
    website/
      web_hero_1400x600_v1.jpg
      web_banner_980x305_v1.jpg
      web_feature_1076x800_v1.jpg
      web_feature_592x440_v1.jpg
      web_strip_800x310_v1.jpg
    email_internal/
      email_600x585_v1.jpg
      email_420x420_v1.jpg
    seo/
      seo_article_950x270_v1.jpg
      seo_hero_800x450_v1.jpg
  contact-sheet.html      ← static export of the results page (for archiving)
```

The `runId` is a short ULID. The Results URL is `/results/<runId>` so the
user can bookmark or share with a teammate on the same machine.

## Safety / Compliance
- Reject prompts that include people under 18 unless brand-asset reference
  photos are provided.
- Strip any PII from scraped pages before logging.
- Watermark drafts (`final/` is unwatermarked; `drafts/` is watermarked).
- Even watermarked drafts of `allowOnImageText: false` channels must store
  an unwatermarked copy in `final/` for the website/email/SEO teams.
- Never store the `FAL_KEY` in any output file.
- The app binds to `localhost` only by default. If the user wants to expose
  it on the LAN, that requires an explicit `HOST=0.0.0.0` env var and a
  warning printed in the terminal.

## Local Setup (README target)
The README must explain:
1. `git clone …`
2. `npm install`
3. Copy `.env.example` → `.env.local` and fill in `FAL_KEY`.
4. `npm run dev` → opens at `http://localhost:3000`.
5. Where outputs land (`outputs/<campaign-slug>/<runId>/`).
6. How to run tests (`npm test`) and dry-run mode (toggle in UI).
7. How the model catalog refreshes (auto every 24h, or click "Refresh
   catalog" on Step 4).

## When You Are Unsure
ASK before:
- Spending >$5 in a single run (UI must already require user confirm,
  but additionally surface a clarifying question if the brief is ambiguous).
- Adding new dependencies.
- Modifying brand-guidelines.md.
- Touching files outside `app/`, `src/`, `components/`, `outputs/`, `cache/`.
- Overriding any `allowOnImageText: false` rule. This rule is HARD.
- Exposing the app beyond localhost.

## Definition of Done for Any Feature
- TypeScript compiles with no errors (`npm run typecheck`).
- Vitest tests pass (`npm test`).
- The Dry Run mode works end-to-end without any fal.ai call.
- README updated if user-facing behavior changed.
- Cost logging works and includes the model id for every call.
- For any channel touched, a test verifies the `allowOnImageText` flag is
  respected in:
  1. The prompt builder (negative prompts present).
  2. The post-processor (overlay steps skipped, OCR check runs).
  3. The UI (correct badge shown, no overlay-related controls rendered,
     warning shown if a text-capable model is selected).
- For the model picker, tests cover:
  1. Catalog loads and caches.
  2. Search filters by query, kind, and tags.
  3. Refresh button busts the cache.
  4. Suggest-default returns a sensible model for each channel.
  5. Capability warnings fire when the chosen model conflicts with channel
     rules.
- `FAL_KEY` is verified absent from the client bundle (`next build` output
  inspected, or a test that imports the client bundle and asserts).
