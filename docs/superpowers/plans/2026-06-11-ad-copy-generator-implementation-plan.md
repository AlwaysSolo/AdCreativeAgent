# Ad Copy Generator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a versioned OpenRouter-powered ad-copy generator that creates, validates, edits, stores, and exports channel-specific copy for each saved creative angle.

**Architecture:** Add a focused `src/copy/` domain for copy schemas, channel rules, validation, OpenRouter model search, generation, version persistence, and exports. Store canonical reusable copy versions on creative angle records, mirror active copy on run state for Review/Results resume, and keep all OpenRouter calls server-side.

**Tech Stack:** Next.js 14 App Router, TypeScript strict mode, zod, React, shadcn/ui primitives, Vitest, OpenRouter Chat Completions API, filesystem JSON persistence, existing `outputs/` archive conventions.

---

## Scope Guardrails

- Do not call OpenRouter in tests except through mocked `fetch`.
- Do not call fal.ai while implementing this feature.
- Do not expose `OPENROUTER_API_KEY` to the browser.
- Keep all new filesystem writes under `cache/` or `outputs/`.
- Use TDD for each task: write the failing test, run it, implement, rerun.
- Commit after every task that passes focused tests.
- Run `npm run typecheck` and `npm test` before the final commit/push.

## File Structure Map

Create:
- `src/copy/schemas.ts` - zod schemas and inferred TypeScript types for copy models, settings, channel copy sets, copy versions, validation, and OpenRouter cost.
- `src/copy/channel-copy-rules.ts` - channel-specific copy field rules, recommended lengths, and default tone options.
- `src/copy/copy-validator.ts` - validates generated/edited copy against approved elements, length guidance, forbidden terms, price/stay mismatch, and unsupported urgency.
- `src/copy/openrouter-models.ts` - loads, normalizes, caches, searches, and refreshes OpenRouter model catalog.
- `src/copy/openrouter-client.ts` - server-side OpenRouter chat-completions wrapper.
- `src/copy/copy-agent.ts` - builds structured copy-generation requests and validates model responses.
- `src/copy/copy-exporter.ts` - writes active/all copy versions as JSON, Markdown, and CSV.
- `src/lib/copy-versions.ts` - creates, updates, activates, mirrors, and persists copy versions for runs and creative angle records.
- `components/OpenRouterModelCombobox.tsx` - searchable server-backed OpenRouter model picker.
- `components/AdCopyPanel.tsx` - Review/angle-library panel for settings, generation, active version selection, validation, and editing.
- `components/CopyVersionEditor.tsx` - grouped channel copy editor.
- `app/api/copy/models/route.ts` - `GET /api/copy/models?q=...`.
- `app/api/copy/models/refresh/route.ts` - `POST /api/copy/models/refresh`.
- `app/api/runs/[runId]/copy/generate/route.ts` - generate a run/angle copy version from Review.
- `app/api/runs/[runId]/copy/[copyVersionId]/route.ts` - patch edited copy fields.
- `app/api/runs/[runId]/copy/[copyVersionId]/activate/route.ts` - activate a run copy version.
- `app/api/projects/[projectId]/angles/[angleId]/copy/generate/route.ts` - generate copy from the creative angle library.
- `app/api/projects/[projectId]/angles/[angleId]/copy/[copyVersionId]/route.ts` - patch angle copy fields.
- `app/api/projects/[projectId]/angles/[angleId]/copy/[copyVersionId]/activate/route.ts` - activate an angle copy version.
- `tests/copy-schemas.test.ts`
- `tests/copy-validator.test.ts`
- `tests/openrouter-models.test.ts`
- `tests/openrouter-client.test.ts`
- `tests/copy-agent.test.ts`
- `tests/copy-versions.test.ts`
- `tests/copy-exporter.test.ts`
- `tests/ad-copy-panel.test.tsx`
- `tests/openrouter-model-combobox.test.tsx`
- `tests/copy-routes.test.ts`
- `tests/copy-results-export.test.tsx`

Modify:
- `src/schemas/index.ts` - export copy types or embed copy fields in `RunState`/`CreativeAngleRecord` schemas if the team chooses central exports.
- `src/lib/runs.ts` - add `copyVersions`, `activeCopyVersionId`, and copy update helpers.
- `src/lib/creative-angles.ts` - persist copy versions on creative angle records and carry them into runs created from an angle.
- `src/lib/projects.ts` - store project-level remembered copy settings.
- `app/review/page.tsx` - pass copy state/defaults to the Review form.
- `components/ReviewPromptForm.tsx` - render `AdCopyPanel` without changing existing prompt behavior.
- `app/projects/[projectId]/page.tsx` - pass copy metadata into `CreativeAngleLibrary`.
- `components/CreativeAngleLibrary.tsx` - expose copy version status and generation entry point.
- `src/lib/results.ts` - load active copy version, export contact sheet copy section, include copy files in ZIP archives.
- `app/api/download/[runId]/route.ts` - include copy files in all-download ZIP and optionally serve copy files directly.
- `.env.example` - add `OPENROUTER_API_KEY=` and `OPENROUTER_DEFAULT_COPY_MODEL=`.
- `README.md` - document OpenRouter setup, copy generation, exports, cost logs.
- `agent.md` - update after feature acceptance to make ad-copy behavior part of source of truth.

---

### Task 1: Copy Schemas And Channel Rules

**Files:**
- Create: `src/copy/schemas.ts`
- Create: `src/copy/channel-copy-rules.ts`
- Modify: `src/schemas/index.ts`
- Test: `tests/copy-schemas.test.ts`

- [ ] **Step 1: Write failing schema tests**

Add `tests/copy-schemas.test.ts` with tests for:

```ts
import {
  copyVersionSchema,
  copyGenerationSettingsSchema,
  openRouterModelSchema
} from "../src/copy/schemas";

describe("copy schemas", () => {
  it("accepts a valid active copy version with Meta and SEO channel sets", () => {
    const parsed = copyVersionSchema.parse({
      id: "copy-v1",
      versionNumber: 1,
      runId: "01HX0000000000000000000000",
      projectId: "01HXPROJECT00000000000000",
      destinationSlug: "orlando",
      creativeAngleId: "01HXANGLE0000000000000000",
      modelId: "anthropic/claude-3.5-sonnet",
      tone: "Direct-response",
      variantCount: 3,
      selectedChannels: ["meta", "seo"],
      status: "generated",
      regenerationMode: "full",
      createdAt: "2026-06-11T12:00:00.000Z",
      updatedAt: "2026-06-11T12:00:00.000Z",
      channelSets: {
        meta: {
          primaryText: [
            { generatedText: "Book an Orlando summer escape from $99.", edited: false }
          ],
          headlines: [
            { generatedText: "Orlando From $99", edited: false }
          ],
          descriptions: [
            { generatedText: "Limited vacation package.", edited: false }
          ],
          cta: { generatedText: "BOOK NOW", edited: false },
          complianceNotes: []
        },
        seo: {
          metaTitles: [
            { generatedText: "Orlando Vacation Packages From $99", edited: false }
          ],
          metaDescriptions: [
            { generatedText: "Plan an Orlando getaway with vacation packages from $99.", edited: false }
          ],
          h1s: [{ generatedText: "Orlando Vacation Packages", edited: false }],
          h2Ideas: [{ generatedText: "Orlando Family Getaway Deals", edited: false }],
          introParagraphs: [
            { generatedText: "Explore Orlando vacation package options for families.", edited: false }
          ],
          imageAltTexts: [{ generatedText: "Orlando resort pool at sunset", edited: false }],
          faqIdeas: [{ generatedText: "What is included in the Orlando package?", edited: false }],
          internalLinkAnchors: [{ generatedText: "Orlando vacation packages", edited: false }],
          schemaSummary: { generatedText: "Orlando vacation package offer.", edited: false },
          complianceNotes: []
        }
      },
      validation: { warnings: [], blockers: [] },
      cost: {
        promptTokens: 1200,
        completionTokens: 900,
        totalTokens: 2100,
        reportedCostUsd: 0.02
      }
    });

    expect(parsed.channelSets.meta?.primaryText[0].generatedText).toContain("Orlando");
  });

  it("rejects variant counts outside 1 to 10", () => {
    expect(
      copyGenerationSettingsSchema.safeParse({
        modelId: "openai/gpt-4o-mini",
        tone: "Direct-response",
        variantCount: 11,
        selectedChannels: ["meta"]
      }).success
    ).toBe(false);
  });

  it("normalizes OpenRouter model metadata", () => {
    const parsed = openRouterModelSchema.parse({
      id: "openai/gpt-4o-mini",
      name: "GPT-4o mini",
      contextLength: 128000,
      pricing: {
        prompt: 0.00000015,
        completion: 0.0000006
      },
      supportedParameters: ["response_format", "tools"],
      badges: ["structured output", "low cost"]
    });

    expect(parsed.supportedParameters).toContain("response_format");
  });
});
```

- [ ] **Step 2: Run schema tests and confirm failure**

Run:

```powershell
npm test -- tests/copy-schemas.test.ts
```

Expected: fails because `src/copy/schemas.ts` does not exist.

- [ ] **Step 3: Create copy schemas**

Create `src/copy/schemas.ts` with:
- `openRouterModelSchema`
- `copyToneSchema`
- `copyGenerationSettingsSchema`
- `copyTextFieldSchema`
- channel schemas for `meta`, `google_display`, `email_internal`, `website`, `seo`
- `copyValidationIssueSchema`
- `copyValidationSummarySchema`
- `copyCostSummarySchema`
- `copyVersionSchema`
- inferred types for all exported schemas

Important implementation details:
- `copyTextFieldSchema` should define `generatedText`, optional `editedText`, optional `effectiveText`, and `edited`.
- Use `.transform()` or helper functions later to compute effective text; do not require callers to pass a correct effective value in v1 tests.
- Keep `selectedChannels` as `z.array(channelKeySchema).min(1)`.
- Keep `variantCount` as `z.number().int().min(1).max(10)`.

- [ ] **Step 4: Create channel copy rules**

Create `src/copy/channel-copy-rules.ts` exporting:
- `COPY_TONE_OPTIONS`
- `COPY_VARIANT_MIN = 1`
- `COPY_VARIANT_MAX = 10`
- `DEFAULT_COPY_VARIANT_COUNT = 3`
- `copyChannelRules`

The rules should include field labels and recommended lengths:

```ts
export const copyChannelRules = {
  meta: {
    label: "Meta",
    fields: {
      primaryText: { label: "Primary text", recommendedMax: 125 },
      headlines: { label: "Headline", recommendedMax: 40 },
      descriptions: { label: "Description", recommendedMax: 30 }
    }
  },
  google_display: {
    label: "Google Display",
    fields: {
      shortHeadlines: { label: "Short headline", recommendedMax: 30 },
      longHeadlines: { label: "Long headline", recommendedMax: 90 },
      descriptions: { label: "Description", recommendedMax: 90 }
    }
  },
  email_internal: {
    label: "Email Internal",
    fields: {
      subjectLines: { label: "Subject line", recommendedMax: 60 },
      preheaders: { label: "Preheader", recommendedMax: 90 },
      heroHeadlines: { label: "Hero headline", recommendedMax: 60 },
      bodyIntros: { label: "Body intro", recommendedMax: 240 },
      ctas: { label: "CTA", recommendedMax: 24 }
    }
  },
  website: {
    label: "Website",
    fields: {
      heroHeadlines: { label: "Hero headline", recommendedMax: 60 },
      heroSubheadlines: { label: "Hero subheadline", recommendedMax: 140 },
      ctas: { label: "CTA", recommendedMax: 24 },
      offerDisclaimerLines: { label: "Offer/disclaimer line", recommendedMax: 140 },
      supportingSectionIntros: { label: "Supporting intro", recommendedMax: 260 }
    }
  },
  seo: {
    label: "SEO",
    fields: {
      metaTitles: { label: "Meta title", recommendedMin: 35, recommendedMax: 60 },
      metaDescriptions: { label: "Meta description", recommendedMin: 120, recommendedMax: 160 },
      h1s: { label: "H1", recommendedMax: 70 },
      h2Ideas: { label: "H2 idea", recommendedMax: 80 },
      introParagraphs: { label: "Intro paragraph", recommendedMax: 360 },
      imageAltTexts: { label: "Image alt text", recommendedMax: 125 },
      faqIdeas: { label: "FAQ idea", recommendedMax: 120 },
      internalLinkAnchors: { label: "Internal link anchor", recommendedMax: 60 }
    }
  }
} as const;
```

- [ ] **Step 5: Export copy schemas from central schema barrel**

Modify `src/schemas/index.ts` to re-export types from `src/copy/schemas.ts` only if needed by existing modules. Prefer importing directly from `src/copy/schemas.ts` in new code to keep the central schema file from becoming too large.

- [ ] **Step 6: Run focused tests**

Run:

```powershell
npm test -- tests/copy-schemas.test.ts
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```powershell
git add src/copy/schemas.ts src/copy/channel-copy-rules.ts src/schemas/index.ts tests/copy-schemas.test.ts
git commit -m "Add ad copy schemas and channel rules"
```

---

### Task 2: Copy Validation Rules

**Files:**
- Create: `src/copy/copy-validator.ts`
- Test: `tests/copy-validator.test.ts`

- [ ] **Step 1: Write failing validator tests**

Add `tests/copy-validator.test.ts` with tests for:
- price mismatch blocker
- stay-length mismatch blocker
- unsupported urgency blocker
- forbidden brand/property term blocker
- channel length warning
- valid copy has no blockers

Use a fixture like:

```ts
const approvedElements = [
  { id: "destination", label: "Destination", value: "Orlando", source: "scrape", selected: true },
  { id: "offer", label: "Offer / price", value: "from $99", source: "scrape", selected: true },
  { id: "stay", label: "Stay length", value: "3 Nights", source: "scrape", selected: true },
  { id: "cta", label: "CTA", value: "Book Now", source: "scrape", selected: true }
] as const;
```

Test snippet:

```ts
it("blocks a different price than the approved offer", () => {
  const result = validateCopyVersion(copyVersionWithText("Orlando getaway from $149"), {
    approvedElements,
    forbiddenTerms: ["Westgate", "logo"],
    noBrandTerms: true
  });

  expect(result.blockers).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        code: "price_mismatch",
        severity: "blocker"
      })
    ])
  );
});
```

- [ ] **Step 2: Run validator tests and confirm failure**

Run:

```powershell
npm test -- tests/copy-validator.test.ts
```

Expected: fails because `validateCopyVersion` does not exist.

- [ ] **Step 3: Implement validator**

Create `src/copy/copy-validator.ts` exporting:
- `validateCopyVersion(copyVersion, context)`
- `extractApprovedClaims(approvedElements)`
- `collectCopyText(copyVersion)`

Validation behavior:
- Extract approved prices with `/\$\s?\d[\d,]*(?:\.\d{2})?/g`.
- Extract approved stay lengths with `/\b\d+\s*(?:night|nights|day|days)\b/i` and `/\b\d+\s*days?\s*\/\s*\d+\s*nights?\b/i`.
- Treat urgency terms as blockers unless approved text includes them: `today only`, `last chance`, `ends tonight`, `limited time`, `act now`, `book today`.
- Treat forbidden terms as blockers when `noBrandTerms` is true.
- Length warnings should use `copyChannelRules`.

- [ ] **Step 4: Run focused tests**

Run:

```powershell
npm test -- tests/copy-validator.test.ts
```

Expected: all validator tests pass.

- [ ] **Step 5: Commit**

```powershell
git add src/copy/copy-validator.ts tests/copy-validator.test.ts
git commit -m "Add ad copy validation"
```

---

### Task 3: Copy Version Persistence For Runs, Angles, And Projects

**Files:**
- Create: `src/lib/copy-versions.ts`
- Modify: `src/lib/runs.ts`
- Modify: `src/lib/creative-angles.ts`
- Modify: `src/lib/projects.ts`
- Modify: `src/schemas/index.ts`
- Test: `tests/copy-versions.test.ts`
- Test: `tests/creative-angles.test.ts`

- [ ] **Step 1: Write failing persistence tests**

Add `tests/copy-versions.test.ts` with tests:
- creates `v1` on a run and mirrors it to its creative angle
- creates `v2` without replacing `v1`
- activates `v2`
- edits a field while preserving generated text
- saves project-level last-used copy settings

Example assertion:

```ts
expect(updatedRun.copyVersions).toHaveLength(2);
expect(updatedRun.activeCopyVersionId).toBe("copy-v2");
expect(updatedAngle.activeCopyVersionId).toBe("copy-v2");
expect(updatedAngle.copyVersions?.[1].versionNumber).toBe(2);
```

- [ ] **Step 2: Run persistence tests and confirm failure**

Run:

```powershell
npm test -- tests/copy-versions.test.ts
```

Expected: fails because copy version persistence does not exist.

- [ ] **Step 3: Extend run state**

Modify `src/lib/runs.ts`:
- import `CopyVersion` and `CopyGenerationSettings` from `src/copy/schemas.ts`
- add to `RunState`:

```ts
copyVersions?: CopyVersion[];
activeCopyVersionId?: string;
copyGenerationSettings?: CopyGenerationSettings;
```

Add helpers:
- `updateRunCopyVersions(runId, update, options)`
- `setRunActiveCopyVersion(runId, copyVersionId, options)`

- [ ] **Step 4: Extend creative angle schema and persistence**

Modify `src/schemas/index.ts` `creativeAngleRecordSchema` to include:

```ts
copyVersions: z.array(copyVersionSchema).default([]),
activeCopyVersionId: z.string().trim().min(1).optional(),
defaultCopyGenerationSettings: copyGenerationSettingsSchema.optional()
```

Modify `src/lib/creative-angles.ts`:
- preserve existing `copyVersions` and `activeCopyVersionId` in `saveCreativeAnglesForRun`
- carry angle copy versions into runs in `createRunFromCreativeAngle`
- add `updateCreativeAngleCopyVersions`
- add `setCreativeAngleActiveCopyVersion`

- [ ] **Step 5: Extend project state**

Modify `src/lib/projects.ts`:
- add `lastCopyGenerationSettings?: CopyGenerationSettings` to `ProjectState`
- add `updateProjectCopySettings(projectId, settings, options)`
- preserve existing create/list/read behavior

- [ ] **Step 6: Implement `src/lib/copy-versions.ts`**

Export:
- `createCopyVersion({ run, angle, settings, channelSets, validation, cost, now })`
- `appendCopyVersionToRun(runId, copyVersion, options)`
- `appendCopyVersionToAngle(input, copyVersion, options)`
- `editCopyVersionField(copyVersion, edit)`
- `activateCopyVersion(copyVersions, copyVersionId)`
- `nextCopyVersionNumber(copyVersions)`

Keep ID format simple and deterministic enough for tests:

```ts
export function copyVersionId(versionNumber: number) {
  return `copy-v${versionNumber}`;
}
```

- [ ] **Step 7: Update existing creative angle tests**

Modify `tests/creative-angles.test.ts` so saved angles default to:

```ts
copyVersions: []
```

and runs created from angles preserve existing copy versions.

- [ ] **Step 8: Run focused tests**

Run:

```powershell
npm test -- tests/copy-versions.test.ts tests/creative-angles.test.ts tests/runs.test.ts
```

Expected: all focused persistence tests pass.

- [ ] **Step 9: Commit**

```powershell
git add src/lib/copy-versions.ts src/lib/runs.ts src/lib/creative-angles.ts src/lib/projects.ts src/schemas/index.ts tests/copy-versions.test.ts tests/creative-angles.test.ts tests/runs.test.ts
git commit -m "Persist ad copy versions"
```

---

### Task 4: OpenRouter Model Catalog And Search

**Files:**
- Create: `src/copy/openrouter-models.ts`
- Create: `app/api/copy/models/route.ts`
- Create: `app/api/copy/models/refresh/route.ts`
- Test: `tests/openrouter-models.test.ts`
- Test: `tests/openrouter-model-combobox.test.tsx` later in Task 8

- [ ] **Step 1: Write failing catalog tests**

Add `tests/openrouter-models.test.ts` covering:
- normalizes `GET /api/v1/models` payload
- caches to `cache/openrouter-models-catalog.json`
- uses 24-hour TTL
- filters by query
- filters by structured output
- refresh bypasses cache
- live failure falls back to stale cache

Mock payload:

```ts
const apiPayload = {
  data: [
    {
      id: "openai/gpt-4o-mini",
      name: "GPT-4o mini",
      context_length: 128000,
      pricing: { prompt: "0.00000015", completion: "0.0000006" },
      supported_parameters: ["response_format", "tools"]
    },
    {
      id: "meta-llama/llama-3.1-8b-instruct:free",
      name: "Llama 3.1 8B Instruct Free",
      context_length: 8192,
      pricing: { prompt: "0", completion: "0" },
      supported_parameters: []
    }
  ]
};
```

- [ ] **Step 2: Run catalog tests and confirm failure**

Run:

```powershell
npm test -- tests/openrouter-models.test.ts
```

Expected: fails because model catalog module does not exist.

- [ ] **Step 3: Implement OpenRouter model catalog**

Create `src/copy/openrouter-models.ts` exporting:
- `loadOpenRouterModels(options)`
- `refreshOpenRouterModels(options)`
- `searchOpenRouterModels(options)`
- `normalizeOpenRouterModel(raw)`

Normalization:
- `id`
- `name`
- `contextLength`
- `pricing.prompt`
- `pricing.completion`
- `supportedParameters`
- `badges`
- `supportsStructuredOutput` true when `supported_parameters` includes `response_format` or model metadata says structured outputs are supported

Recommended badge rules:
- `structured output` if supports structured output
- `free` if prompt and completion are `0`
- `long context` if context length is at least `100000`
- `low cost` if prompt plus completion price is below `0.000005`

- [ ] **Step 4: Implement API routes**

Create `app/api/copy/models/route.ts`:
- parse `q`, `structured`, `free`, `recommended`, `longContext`
- return `{ models, staleSince?, manualEntryAvailable? }`

Create `app/api/copy/models/refresh/route.ts`:
- call `refreshOpenRouterModels`
- return `{ models, refreshedAt }`

- [ ] **Step 5: Run focused tests**

Run:

```powershell
npm test -- tests/openrouter-models.test.ts
```

Expected: all catalog tests pass.

- [ ] **Step 6: Commit**

```powershell
git add src/copy/openrouter-models.ts app/api/copy/models/route.ts app/api/copy/models/refresh/route.ts tests/openrouter-models.test.ts
git commit -m "Add OpenRouter model catalog"
```

---

### Task 5: OpenRouter Client And Copy Agent

**Files:**
- Create: `src/copy/openrouter-client.ts`
- Create: `src/copy/copy-agent.ts`
- Test: `tests/openrouter-client.test.ts`
- Test: `tests/copy-agent.test.ts`

- [ ] **Step 1: Write failing OpenRouter client tests**

Add `tests/openrouter-client.test.ts`:

```ts
it("posts chat completions with server-side OpenRouter auth", async () => {
  const fetchSpy = vi.fn(async () =>
    new Response(
      JSON.stringify({
        choices: [{ message: { content: "{\"ok\":true}" } }],
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30, cost: 0.001 }
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    )
  );

  await callOpenRouterChat({
    apiKey: "test-key",
    model: "openai/gpt-4o-mini",
    messages: [{ role: "user", content: "Return JSON" }],
    fetch: fetchSpy
  });

  expect(fetchSpy).toHaveBeenCalledWith(
    "https://openrouter.ai/api/v1/chat/completions",
    expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ authorization: "Bearer test-key" })
    })
  );
});
```

- [ ] **Step 2: Write failing copy-agent tests**

Add `tests/copy-agent.test.ts` covering:
- request includes approved ad elements as hard truth
- request includes scrape/project doc context as background
- request uses JSON Schema response format when selected model supports structured output
- parsed response validates through `copyVersionSchema`
- invalid model response is rejected and not marked active

- [ ] **Step 3: Run client and agent tests and confirm failure**

Run:

```powershell
npm test -- tests/openrouter-client.test.ts tests/copy-agent.test.ts
```

Expected: fails because modules do not exist.

- [ ] **Step 4: Implement OpenRouter client**

Create `src/copy/openrouter-client.ts` exporting:
- `callOpenRouterChat(request, options)`
- `extractOpenRouterText(payload)`
- `extractOpenRouterUsage(payload)`

Behavior:
- read `OPENROUTER_API_KEY` unless `apiKey` option is passed
- throw clear setup error if missing
- include optional `HTTP-Referer` and `X-Title` headers only if configured constants are available
- never log or return API key
- throw `OpenRouter request failed with HTTP ${status}` with a short body snippet

- [ ] **Step 5: Implement copy agent**

Create `src/copy/copy-agent.ts` exporting:
- `buildCopyAgentMessages(context)`
- `buildCopyJsonSchema(selectedChannels)`
- `generateCopyForRun(context, options)`
- `parseCopyAgentResponse(payload, selectedChannels)`

Prompt contract:
- system message: expert travel copywriter, strict offer accuracy, output valid JSON
- user message sections:
  - approved ad elements
  - selected creative angle
  - campaign brief
  - background context
  - selected channels
  - variant count
  - tone/style
  - copy notes
  - forbidden claims

Request settings:
- use selected OpenRouter model
- when model supports structured output, send `response_format` JSON Schema and `provider.require_parameters: true`
- otherwise send explicit JSON-only prompt and validate response

- [ ] **Step 6: Run focused tests**

Run:

```powershell
npm test -- tests/openrouter-client.test.ts tests/copy-agent.test.ts
```

Expected: all client/agent tests pass.

- [ ] **Step 7: Commit**

```powershell
git add src/copy/openrouter-client.ts src/copy/copy-agent.ts tests/openrouter-client.test.ts tests/copy-agent.test.ts
git commit -m "Add OpenRouter copy agent"
```

---

### Task 6: Copy Generation, Edit, And Activation Routes

**Files:**
- Create: `app/api/runs/[runId]/copy/generate/route.ts`
- Create: `app/api/runs/[runId]/copy/[copyVersionId]/route.ts`
- Create: `app/api/runs/[runId]/copy/[copyVersionId]/activate/route.ts`
- Create: `app/api/projects/[projectId]/angles/[angleId]/copy/generate/route.ts`
- Create: `app/api/projects/[projectId]/angles/[angleId]/copy/[copyVersionId]/route.ts`
- Create: `app/api/projects/[projectId]/angles/[angleId]/copy/[copyVersionId]/activate/route.ts`
- Modify: `src/lib/copy-versions.ts`
- Test: `tests/copy-routes.test.ts`

- [ ] **Step 1: Write failing route tests**

Add `tests/copy-routes.test.ts` covering:
- `POST /api/runs/[runId]/copy/generate` creates inactive invalid version when validation blocks
- valid generation creates active version on run and angle
- route saves project last-used copy settings
- `PATCH` edits one field and marks version edited
- `activate` switches active version
- angle-library route generates copy without starting a new image run

Mock the copy agent by dependency injection if routes call a helper that accepts options. If direct mocking is needed, export a route handler helper such as `handleGenerateRunCopy(request, context, deps)`.

- [ ] **Step 2: Run route tests and confirm failure**

Run:

```powershell
npm test -- tests/copy-routes.test.ts
```

Expected: fails because routes do not exist.

- [ ] **Step 3: Implement run generation route**

`app/api/runs/[runId]/copy/generate/route.ts`:
- parse body with `copyGenerationSettingsSchema`
- read run
- require `run.brief`, selected channels, creative angle id, and approved creative workspace elements
- estimate cost and require `confirmedOverCopyThreshold` if estimate > `$1`
- call `generateCopyForRun`
- validate copy with `validateCopyVersion`
- create next copy version
- append to run
- append to angle if `projectId`, `destinationSlug`, and `creativeAngleId` exist
- update project last-used settings
- return `{ copyVersion, activeCopyVersionId }`

- [ ] **Step 4: Implement edit routes**

Patch route body:

```ts
{
  "path": {
    "channel": "meta",
    "field": "headlines",
    "index": 0
  },
  "editedText": "Orlando From $99"
}
```

Behavior:
- update matching `CopyTextField.editedText`
- set `edited: true`
- recompute validation
- save run and angle versions

- [ ] **Step 5: Implement activation routes**

Behavior:
- read existing run/angle
- verify copy version id exists
- verify selected version has no blockers before active activation
- set active id on run and angle
- return active version

- [ ] **Step 6: Implement angle-library generation route**

`app/api/projects/[projectId]/angles/[angleId]/copy/generate/route.ts`:
- read angle by `projectId`, `destinationSlug`, `angleId`
- use `briefSnapshot`
- use `approvedElementsUsed` plus current saved angle metadata as context
- create a copy version on the angle
- update project last-used settings
- return copy version

- [ ] **Step 7: Run focused tests**

Run:

```powershell
npm test -- tests/copy-routes.test.ts tests/copy-versions.test.ts
```

Expected: route and persistence tests pass.

- [ ] **Step 8: Commit**

```powershell
git add app/api/runs/[runId]/copy app/api/projects/[projectId]/angles/[angleId]/copy src/lib/copy-versions.ts tests/copy-routes.test.ts
git commit -m "Add ad copy version routes"
```

---

### Task 7: OpenRouter Model Combobox

**Files:**
- Create: `components/OpenRouterModelCombobox.tsx`
- Test: `tests/openrouter-model-combobox.test.tsx`

- [ ] **Step 1: Write failing component tests**

Add `tests/openrouter-model-combobox.test.tsx`:
- opens popover
- fetches `/api/copy/models?q=...`
- renders name, id, context length, price, and badges
- supports filters
- supports "Show all models"
- calls `onChange(model)` when item selected
- shows manual model id input when `manualEntryAvailable` is true

- [ ] **Step 2: Run component tests and confirm failure**

Run:

```powershell
npm test -- tests/openrouter-model-combobox.test.tsx
```

Expected: fails because component does not exist.

- [ ] **Step 3: Implement combobox**

Create `components/OpenRouterModelCombobox.tsx` by following `components/ModelCombobox.tsx` patterns:
- use `Popover`
- use `Command`
- set `shouldFilter={false}`
- debounce search by 150ms
- endpoint `/api/copy/models`
- filter chips: `All`, `Recommended`, `Structured output`, `Low cost`, `Long context`, `Free`
- checkbox or toggle for `Show all models`
- manual entry section when API returns `manualEntryAvailable`

- [ ] **Step 4: Run focused tests**

Run:

```powershell
npm test -- tests/openrouter-model-combobox.test.tsx
```

Expected: component tests pass.

- [ ] **Step 5: Commit**

```powershell
git add components/OpenRouterModelCombobox.tsx tests/openrouter-model-combobox.test.tsx
git commit -m "Add OpenRouter model picker"
```

---

### Task 8: Review Page Ad Copy Panel

**Files:**
- Create: `components/AdCopyPanel.tsx`
- Create: `components/CopyVersionEditor.tsx`
- Modify: `app/review/page.tsx`
- Modify: `components/ReviewPromptForm.tsx`
- Test: `tests/ad-copy-panel.test.tsx`
- Test: `tests/review-page.test.tsx`

- [ ] **Step 1: Write failing Review UI tests**

Add `tests/ad-copy-panel.test.tsx`:
- renders model picker, tone dropdown, variant count, channel checklist, notes, Generate Ad Copy button
- defaults tone from brief
- defaults variant count to `3`
- defaults channels to selected channels
- posts to `/api/runs/[runId]/copy/generate`
- shows active copy version after response
- edits a copy field and sends `PATCH`
- switches active version and sends activate request

Add to `tests/review-page.test.tsx`:

```ts
expect(screen.getByRole("heading", { name: "Ad Copy" })).toBeInTheDocument();
expect(screen.getByRole("button", { name: "Generate Ad Copy" })).toBeInTheDocument();
```

- [ ] **Step 2: Run UI tests and confirm failure**

Run:

```powershell
npm test -- tests/ad-copy-panel.test.tsx tests/review-page.test.tsx
```

Expected: fails because the Ad Copy panel does not exist.

- [ ] **Step 3: Implement `CopyVersionEditor`**

Create `components/CopyVersionEditor.tsx`:
- props: `copyVersion`, `onEditField`, `isSaving`
- render one section per channel
- render field arrays with textareas
- show generated text if no edit
- show edited badge for edited fields
- show validation warnings/blockers at top

Use stable labels:
- `Meta Primary text 1`
- `Meta Headline 1`
- `SEO Meta title 1`
- `Email Internal Subject line 1`

- [ ] **Step 4: Implement `AdCopyPanel`**

Create `components/AdCopyPanel.tsx`:
- client component
- props:
  - `runId`
  - `briefTone`
  - `selectedChannels`
  - `initialCopyVersions`
  - `activeCopyVersionId`
  - `initialSettings`
- local state for settings
- use `OpenRouterModelCombobox`
- fetch generation endpoint
- handle cost confirmation for `estimatedCopyCostUsd > 1`
- render `CopyVersionEditor`

- [ ] **Step 5: Integrate into Review**

Modify `app/review/page.tsx`:
- compute copy defaults from run, project settings, brief tone
- pass copy props to `ReviewPromptForm`

Modify `components/ReviewPromptForm.tsx`:
- add optional `copyPanel` prop or render `AdCopyPanel` above `Prompt assignments`
- keep existing Generate button behavior unchanged

Recommended integration:

```tsx
{copyPanel ? <section className="border-t pt-6">{copyPanel}</section> : null}
```

This keeps the prompt form from owning copy internals.

- [ ] **Step 6: Run focused tests**

Run:

```powershell
npm test -- tests/ad-copy-panel.test.tsx tests/review-page.test.tsx
```

Expected: Review copy UI tests pass.

- [ ] **Step 7: Commit**

```powershell
git add components/AdCopyPanel.tsx components/CopyVersionEditor.tsx app/review/page.tsx components/ReviewPromptForm.tsx tests/ad-copy-panel.test.tsx tests/review-page.test.tsx
git commit -m "Add ad copy panel to review"
```

---

### Task 9: Creative Angle Library Copy Entry Point

**Files:**
- Modify: `app/projects/[projectId]/page.tsx`
- Modify: `components/CreativeAngleLibrary.tsx`
- Reuse: `components/AdCopyPanel.tsx`
- Test: `tests/project-creative-angles.test.tsx`

- [ ] **Step 1: Write failing angle-library tests**

Modify `tests/project-creative-angles.test.tsx`:
- saved angle card shows active copy version summary when copy exists
- saved angle card shows `Generate Ad Copy`
- clicking generate posts to `/api/projects/[projectId]/angles/[angleId]/copy/generate`
- edited copy version count is visible

Expected UI text:
- `Copy versions: 0`
- `Generate Ad Copy`
- `Active copy: v1 - Direct-response - 3 variants`

- [ ] **Step 2: Run angle-library tests and confirm failure**

Run:

```powershell
npm test -- tests/project-creative-angles.test.tsx
```

Expected: fails because copy UI is not in the angle library.

- [ ] **Step 3: Update library component**

Modify `components/CreativeAngleLibrary.tsx`:
- show copy version count per angle
- show active version summary
- add a collapsible copy panel per angle
- use `AdCopyPanel` in angle mode or create a thin wrapper around it

Do not make the project page visually crowded:
- keep angle cards compact
- reveal copy controls only after user clicks `Manage copy`

- [ ] **Step 4: Update project page props**

Modify `app/projects/[projectId]/page.tsx`:
- pass project last-used copy settings into `CreativeAngleLibrary`
- keep project document and landing page panels unchanged

- [ ] **Step 5: Run focused tests**

Run:

```powershell
npm test -- tests/project-creative-angles.test.tsx tests/ad-copy-panel.test.tsx
```

Expected: tests pass.

- [ ] **Step 6: Commit**

```powershell
git add app/projects/[projectId]/page.tsx components/CreativeAngleLibrary.tsx tests/project-creative-angles.test.tsx
git commit -m "Add creative angle copy entry point"
```

---

### Task 10: Copy Exporter, Results Page, And ZIP Downloads

**Files:**
- Create: `src/copy/copy-exporter.ts`
- Modify: `src/lib/results.ts`
- Modify: `app/results/[runId]/page.tsx`
- Modify: `app/api/download/[runId]/route.ts`
- Test: `tests/copy-exporter.test.ts`
- Test: `tests/copy-results-export.test.tsx`
- Test: `tests/results.test.tsx`

- [ ] **Step 1: Write failing exporter tests**

Add `tests/copy-exporter.test.ts`:
- writes `copy/active/copy.json`
- writes `copy/active/copy.md`
- writes `copy/active/copy.csv`
- writes `copy/v1/copy.*`
- uses edited text in exports
- excludes API keys and request secrets

Assertion:

```ts
expect(markdown).toContain("Meta");
expect(markdown).toContain("Edited headline");
expect(csv).toContain("channel,field,index,text,edited");
expect(JSON.stringify(json)).not.toContain("OPENROUTER_API_KEY");
```

- [ ] **Step 2: Write failing Results tests**

Add `tests/copy-results-export.test.tsx`:
- Results page shows active copy version metadata
- Results page groups copy by channel
- Download-all ZIP includes `copy/active/copy.json`, `copy/active/copy.md`, and `copy/active/copy.csv`
- contact-sheet HTML includes a copy summary section

- [ ] **Step 3: Run exporter/results tests and confirm failure**

Run:

```powershell
npm test -- tests/copy-exporter.test.ts tests/copy-results-export.test.tsx
```

Expected: fails because exporter/results integration does not exist.

- [ ] **Step 4: Implement exporter**

Create `src/copy/copy-exporter.ts` exporting:
- `exportCopyVersion({ run, runDir, copyVersion })`
- `copyVersionToMarkdown(copyVersion)`
- `copyVersionToCsv(copyVersion)`
- `copyVersionToJson(copyVersion)`
- `copyOutputDir(runDir, version)`

CSV columns:

```text
copyVersionId,versionNumber,channel,field,index,text,edited,modelId,tone,variantCount
```

Markdown structure:

```md
# Ad Copy - v1

Model: ...
Tone: ...

## Meta
### Primary Text
1. ...
```

- [ ] **Step 5: Integrate Results loading**

Modify `src/lib/results.ts`:
- load active copy version from run or creative angle
- call `exportCopyVersion` inside `loadRunResults`
- return `copyVersion`, `copyDownloadHrefs`, and exported file paths
- include copy files in `archiveAssets` for all-download ZIP

Do not include copy files in per-channel image ZIP unless the user requested all assets. V1 default:
- `Download all` includes copy exports
- per-channel ZIPs remain image-only

- [ ] **Step 6: Update Results page UI**

Modify `app/results/[runId]/page.tsx`:
- add copy section below contact sheet
- show version, model, tone, validation summary
- render grouped copy with effective text

- [ ] **Step 7: Run focused tests**

Run:

```powershell
npm test -- tests/copy-exporter.test.ts tests/copy-results-export.test.tsx tests/results.test.tsx
```

Expected: all copy export/results tests pass.

- [ ] **Step 8: Commit**

```powershell
git add src/copy/copy-exporter.ts src/lib/results.ts app/results/[runId]/page.tsx app/api/download/[runId]/route.ts tests/copy-exporter.test.ts tests/copy-results-export.test.tsx tests/results.test.tsx
git commit -m "Export ad copy with results"
```

---

### Task 11: Environment, Docs, And Security Checks

**Files:**
- Modify: `.env.example`
- Modify: `README.md`
- Modify: `agent.md`
- Modify: `scripts/check-server-only-imports.mjs`
- Test: existing build/import security tests or a new `tests/openrouter-security.test.ts`

- [ ] **Step 1: Write failing security test**

Add `tests/openrouter-security.test.ts`:

```ts
import { readFile } from "node:fs/promises";

describe("OpenRouter security", () => {
  it("keeps OpenRouter API key out of client-facing source", async () => {
    const clientFiles = [
      "components/AdCopyPanel.tsx",
      "components/OpenRouterModelCombobox.tsx",
      "components/CopyVersionEditor.tsx"
    ];

    for (const file of clientFiles) {
      const content = await readFile(file, "utf8");
      expect(content).not.toContain("OPENROUTER_API_KEY");
    }
  });
});
```

- [ ] **Step 2: Run security test and confirm failure if server-only checker is incomplete**

Run:

```powershell
npm test -- tests/openrouter-security.test.ts
```

Expected: initially passes if client files are clean; if not, fix imports before continuing.

- [ ] **Step 3: Update env docs**

Modify `.env.example`:

```text
OPENROUTER_API_KEY=
OPENROUTER_DEFAULT_COPY_MODEL=
```

Modify `README.md`:
- setup OpenRouter key
- copy model search
- Generate Ad Copy flow
- copy versioning
- exports: JSON/MD/CSV
- cost threshold
- no fal.ai spend for copy generation

Modify `agent.md` after feature acceptance:
- add ad copy generator to core flow
- add OpenRouter as text-copy provider
- add copy output conventions
- add security and cost logging rules

- [ ] **Step 4: Update server-only import checker**

Modify `scripts/check-server-only-imports.mjs`:
- ensure `src/copy/openrouter-client.ts` is not imported by client components
- ensure no component imports `OPENROUTER_API_KEY`

- [ ] **Step 5: Run focused checks**

Run:

```powershell
npm run typecheck
npm test -- tests/openrouter-security.test.ts
```

Expected: both pass.

- [ ] **Step 6: Commit**

```powershell
git add .env.example README.md agent.md scripts/check-server-only-imports.mjs tests/openrouter-security.test.ts
git commit -m "Document OpenRouter ad copy setup"
```

---

### Task 12: End-To-End Mocked Copy Workflow

**Files:**
- Create: `tests/ad-copy-e2e.test.tsx`
- Modify: `src/lib/copy-versions.ts`
- Modify: `src/copy/copy-exporter.ts`
- Modify: `src/lib/results.ts`
- Modify: `components/AdCopyPanel.tsx`
- Modify: `components/CreativeAngleLibrary.tsx`

- [ ] **Step 1: Write failing mocked e2e test**

Add `tests/ad-copy-e2e.test.tsx` covering:
1. Create project.
2. Create run from fixture scrape or document.
3. Approve or seed a creative angle.
4. Open Review.
5. Select OpenRouter model.
6. Generate copy with mocked OpenRouter response.
7. Edit one Meta headline.
8. Confirm active version is saved to run and creative angle.
9. Load Results.
10. Assert copy export files exist.
11. Assert all-download ZIP contains copy files.

Use mocked fetch for OpenRouter; do not hit network.

- [ ] **Step 2: Run e2e test and confirm failure**

Run:

```powershell
npm test -- tests/ad-copy-e2e.test.tsx
```

Expected: fails until all integration points are wired.

- [ ] **Step 3: Fix integration gaps**

Only fix gaps that the e2e test proves:
- missing active version propagation
- missing export
- missing result display
- incorrect route payload
- forgotten project settings persistence

- [ ] **Step 4: Run the e2e and major focused suites**

Run:

```powershell
npm test -- tests/ad-copy-e2e.test.tsx tests/copy-routes.test.ts tests/ad-copy-panel.test.tsx tests/copy-results-export.test.tsx
```

Expected: all pass.

- [ ] **Step 5: Commit**

```powershell
git add tests/ad-copy-e2e.test.tsx src components app
git commit -m "Add ad copy end-to-end coverage"
```

---

### Task 13: Final Verification And Push

**Files:**
- No new files unless previous tasks require fixes.

- [ ] **Step 1: Run typecheck**

Run:

```powershell
npm run typecheck
```

Expected:

```text
tsc --noEmit
```

exits with code `0`.

- [ ] **Step 2: Run full test suite**

Run:

```powershell
npm test
```

Expected:
- all test files pass
- all tests pass
- no unexpected OpenRouter or fal.ai live calls

- [ ] **Step 3: Inspect git status**

Run:

```powershell
git status --short --branch
```

Expected:
- only intentional files modified
- no generated `outputs/` or `cache/` files staged unless explicitly required

- [ ] **Step 4: Commit final fixes if needed**

If verification required any final fixes:

```powershell
git add src app components tests .env.example README.md agent.md scripts/check-server-only-imports.mjs
git commit -m "Finish ad copy generator"
```

If no final fixes are needed, do not create an empty commit.

- [ ] **Step 5: Push**

Run:

```powershell
git push origin main
```

- [ ] **Step 6: Confirm remote alignment**

Run:

```powershell
git fetch origin --prune
git rev-list --left-right --count origin/main...HEAD
git log -1 --oneline
```

Expected:

```text
0  0
```

and the latest commit should be the final ad-copy-generator commit.

---

## Implementation Order Summary

1. Copy schemas and channel rules.
2. Copy validator.
3. Run, project, and creative angle persistence.
4. OpenRouter model catalog.
5. OpenRouter client and copy agent.
6. Copy generation/edit/activate routes.
7. OpenRouter model combobox.
8. Review page copy panel.
9. Creative angle library copy panel.
10. Copy exports and Results integration.
11. Environment/docs/security.
12. Mocked e2e workflow.
13. Full verification and push.

## Manual QA Checklist

After implementation, manually verify:
- Start app at `http://localhost:3000`.
- Create or open a project.
- Scrape a destination or upload a project document.
- Complete brief, channels, models, and creative angle approval.
- Open Review and confirm the Ad Copy panel appears.
- Search for an OpenRouter model.
- Generate 3 variants for Meta and Email with mocked or live OpenRouter only after explicit approval.
- Edit one copy field and confirm edited state remains after refresh.
- Generate images in Dry Run and open Results.
- Confirm copy appears on Results.
- Download all and confirm `copy/active/copy.json`, `copy/active/copy.md`, and `copy/active/copy.csv` are included.
- Open project creative angle library and confirm the saved angle shows copy version metadata.
