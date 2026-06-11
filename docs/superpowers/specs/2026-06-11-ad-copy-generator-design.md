# Ad Copy Generator Design Spec

## Product Goal
Add an ad-copy generation system to the local resort creative app so each approved creative angle can produce editable, versioned, channel-specific copy alongside generated image assets.

The copy system must support immediate campaign work in the Review step and long-term reuse from the project creative angle library. It should generate structured copy for paid social, display, email, website, and SEO placements while preserving offer accuracy, channel rules, cost visibility, and exportability.

## Source Of Truth
The existing `agent.md` remains the source of truth for the current app. This spec extends the product with new behavior that is not yet in `agent.md`. After implementation and acceptance, `agent.md` should be updated to reflect the final behavior.

## Non-Goals For V1
- Do not generate images or spend fal.ai credits as part of copy generation.
- Do not replace the Creative Direction agent.
- Do not require copy generation before image generation.
- Do not build a full CMS or approval workflow.
- Do not expose OpenRouter keys to the browser.
- Do not treat website and SEO copy as ad copy blobs; they need their own structured outputs.

## High-Level Workflow
The copy generator has two entry points.

### Entry Point 1: Review Step
1. User approves a creative angle in Step 5 Creative Direction.
2. Review shows image prompts as it does today.
3. Review also shows a new **Ad Copy** panel.
4. User chooses:
   - OpenRouter text model.
   - Tone/style, defaulting from Step 2 campaign tone.
   - Variant count, default `3`.
   - Channels to generate for, defaulting to selected channels.
   - Optional copy notes.
5. User clicks **Generate Ad Copy**.
6. App creates a new copy version for the approved creative angle.
7. User reviews validation warnings/blockers and edits copy inline.
8. Active copy version is available on Review, Results, exports, and the creative angle library.

### Entry Point 2: Creative Angle Library
1. User opens a project.
2. User opens a destination.
3. User selects a saved creative angle.
4. User can view existing copy versions or generate a new copy version for that angle.
5. User can later generate images/copy from the same angle.

## Information Hierarchy
The canonical reusable hierarchy is:

```text
Project
  Destination
    Creative Angle
      Copy Versions
        Channel Copy Sets
          Placement Copy Variants
```

Run-level state exists for workflow resume and immediate Review/Results display, but reusable copy state belongs to the creative angle library.

## OpenRouter Integration
Use OpenRouter for copy generation so the user can select from many text models and change models later.

### Environment
Add:

```text
OPENROUTER_API_KEY=
OPENROUTER_DEFAULT_COPY_MODEL=
```

`OPENROUTER_API_KEY` must be server-side only and must never reach the browser bundle or output files.

### API Shape
Use OpenRouter's OpenAI-compatible chat completions API:

```text
POST https://openrouter.ai/api/v1/chat/completions
```

The server sends:
- `Authorization: Bearer ${OPENROUTER_API_KEY}`
- `Content-Type: application/json`
- `model`
- `messages`
- structured output settings when supported

Official docs referenced during design:
- https://openrouter.ai/docs/quickstart
- https://openrouter.ai/docs/api/reference/overview
- https://openrouter.ai/docs/api/reference/authentication
- https://openrouter.ai/docs/api/api-reference/models/get-models
- https://openrouter.ai/docs/guides/features/structured-outputs
- https://openrouter.ai/docs/guides/routing/provider-selection
- https://openrouter.ai/docs/cookbook/administration/usage-accounting

### Structured Output Policy
The app should prefer structured-output-capable models.

For v1:
- The model picker is a searchable combobox.
- It defaults to recommended structured-output-capable models.
- It includes a **Show all models** option.
- If a user selects a model that may not support structured outputs, the UI warns but allows an advanced override.
- The server validates every model response against zod schemas before saving.
- Invalid output is not saved as an active copy version.

When structured outputs are available, use JSON Schema with strict mode and provider parameter requirements:

```json
{
  "response_format": {
    "type": "json_schema",
    "json_schema": {
      "name": "ad_copy_version",
      "strict": true,
      "schema": "The JSON Schema generated from the zod copy response schema"
    }
  },
  "provider": {
    "require_parameters": true
  }
}
```

The actual schema should be generated from the app's copy schemas or kept in sync with them.

## OpenRouter Model Search
Add a server-backed searchable model combobox for copy models.

### Catalog Source
Fetch:

```text
GET https://openrouter.ai/api/v1/models
```

Cache normalized models at:

```text
cache/openrouter-models-catalog.json
```

Use a 24-hour TTL, mirroring the fal.ai model catalog behavior.

### Model Row Fields
Each model row should show:
- model name
- model id
- provider/family if available
- context length
- pricing estimate
- supported parameters when available
- badges:
  - `structured output`
  - `tool capable`
  - `reasoning`
  - `free`
  - `recommended`

### Search And Filters
Server endpoint:

```text
GET /api/copy/models?q=...
```

Filters:
- All
- Recommended
- Structured output
- Low cost
- Long context
- Free

Manual fallback:
- Allow direct model id entry if the catalog fails.
- Validate by making a non-spending metadata/model availability check when possible.
- Do not make a paid generation call just to validate the model.

## Remembered Model Settings
The app should remember OpenRouter copy settings per project.

### First Use In A Project
Defaults:
- model: `OPENROUTER_DEFAULT_COPY_MODEL` when set; otherwise the first cached recommended structured-output model sorted by low cost, adequate context length, and non-preview status
- variant count: `3`
- tone/style: campaign tone from Step 2
- selected channels: current selected channels
- copy notes: empty

### After Generation
Save project-level last-used copy settings:
- model id
- tone/style
- variant count
- selected channels

Store these settings with the project record so they travel with the project rather than living in a separate global preference cache.

Next destination or creative angle in the same project should prefill those settings, while allowing all values to be changed.

## Copy Generation Settings
The Review and creative angle library copy panels should expose:

- OpenRouter model searchable combobox.
- Tone/style dropdown.
- Variant count input.
- Channel checklist.
- Optional copy notes.
- Generate Ad Copy button.

### Tone/Style
Default tone comes from Step 2 campaign tone. User can override before generation.

Suggested tone options:
- Direct-response
- Premium
- Family-friendly
- Romantic
- Urgent
- Playful
- Editorial/SEO
- Brand-safe neutral
- Custom

### Variant Count
Default: `3`.

Recommended guardrails:
- minimum: `1`
- maximum: `10`

V1 uses one global variant count for all selected channels. Per-channel variant counts can be a later enhancement.

## Approved Elements Rule
Approved ad elements from Creative Direction are the hard truth.

The copy generator can only make promotional claims from approved elements:
- destination
- promotion/theme
- offer/price
- stay length
- CTA
- headline
- dates
- package inclusions
- urgency language

The full scrape or project document may be used only as background context:
- tone
- atmosphere
- audience
- destination flavor
- amenities
- property type
- general travel context

The generator must not invent unsupported offer claims.

## Copy Version Data Model
Each click of **Generate Ad Copy** creates a new version.

One copy version belongs to the whole creative angle and contains all selected channel sets.

Conceptual type:

```ts
type CopyVersion = {
  id: string;
  versionNumber: number;
  runId: string;
  projectId?: string;
  destinationSlug?: string;
  creativeAngleId: string;
  modelId: string;
  provider?: string;
  tone: string;
  variantCount: number;
  selectedChannels: ChannelKey[];
  copyNotes?: string;
  status: "generated" | "edited" | "invalid";
  regenerationMode: "full" | "partial";
  createdAt: string;
  updatedAt: string;
  channelSets: Partial<Record<ChannelKey, ChannelCopySet>>;
  validation: CopyValidationSummary;
  cost: CopyCostSummary;
};
```

If a user regenerates only one channel later:
- create a new full version
- copy previous channel sets forward
- replace the regenerated channel
- set `regenerationMode: "partial"`
- mark the new version active

## Active Version Behavior
Each creative angle has one active copy version.

Review and Results show the active version by default.

The UI should support switching active version using a compact selector:

```text
v1 - Direct-response - 3 variants - Jun 11 2:14 PM
v2 - Premium - 5 variants - Jun 11 2:22 PM
```

Exports should use the active copy version by default.

## Generated Vs Edited Text
Generated copy must be editable inline.

Do not overwrite the original AI text silently.

Each copy field should preserve:

```ts
type CopyTextField = {
  generatedText: string;
  editedText?: string;
  effectiveText: string;
  edited: boolean;
};
```

`effectiveText` is the edited text if present, otherwise generated text.

When the user edits any field:
- save the edit into the same copy version
- set the field `edited: true`
- set version `status: "edited"`
- update validation for the edited value

## Channel Copy Schemas
All copy output must be structured by channel.

### Meta
Generate:
- primary text variants
- headline variants
- description variants
- CTA recommendation
- compliance notes

### Google Display
Generate:
- short headline variants
- long headline variants
- description variants
- CTA recommendation
- compliance notes

### Email Internal
Generate:
- subject line variants
- preheader variants
- hero headline variants
- body intro variants
- CTA variants
- compliance notes

### Website
Generate:
- hero headline variants
- hero subheadline variants
- CTA variants
- offer/disclaimer line variants
- supporting section intro variants
- compliance notes

Website copy is intended for HTML/CSS overlays or page modules. It is not baked into no-text website images.

### SEO
Generate:
- meta title variants
- meta description variants
- H1 variants
- H2 ideas
- intro paragraph variants
- image alt text variants
- FAQ ideas
- internal-link anchor text ideas
- schema-friendly summary
- compliance notes

SEO copy should optimize for search intent and clarity without inventing unsupported offer claims.

## Validation Rules
Validation runs on generated and edited copy.

Validation should be visible and actionable.

### Non-Blocking Warnings
- Meta headline exceeds recommended length.
- Google display headline/description exceeds recommended length.
- Email subject line is likely too long.
- SEO meta title is too long or too short.
- SEO meta description is too long or too short.
- Website hero headline is too long for likely overlay use.
- Copy includes a claim that appears in background context but not approved elements.

### Blocking Issues
- Copy includes a different price than approved.
- Copy includes a different stay length than approved.
- Copy includes unapproved dates or urgency such as "today only".
- Copy includes forbidden brand/logo/property-name language when the no-brand rule is active.
- Copy includes a package inclusion not present in approved elements.
- Model output fails schema validation and cannot be safely repaired.

Blocked copy versions can be saved as `invalid` for debugging, but they must not become active.

## Cost Logging
OpenRouter copy generation must be logged separately from fal.ai image generation.

Before generation, estimate copy cost from selected model pricing, expected output size, selected channels, and variant count. Require explicit confirmation when estimated copy cost exceeds `$1`, and also respect the app-wide `$5` confirmation rule when copy and image estimates are considered together.

Write:

```text
outputs/<project-or-campaign>/<destination>/<angle-or-run>/<runId>/copy/copy-cost-log.jsonl
```

Each entry includes:
- timestamp
- runId
- projectId
- destinationSlug
- creativeAngleId
- copyVersionId
- modelId
- provider if returned
- selected channels
- variant count
- prompt tokens
- completion tokens
- total tokens
- reported cost
- request parameters, excluding secrets

Never write `OPENROUTER_API_KEY` to output files.

## Export Behavior
Export active copy version in all three formats:

```text
copy.json
copy.md
copy.csv
```

Suggested output layout:

```text
outputs/<project>/<destination>/<angle-or-run>/<runId>/copy/
  active/
    copy.json
    copy.md
    copy.csv
  v1/
    copy.json
    copy.md
    copy.csv
  v2/
    copy.json
    copy.md
    copy.csv
  copy-cost-log.jsonl
```

ZIP downloads should include the active copy files by default.

## UI Requirements

### Review Page
Add an **Ad Copy** panel below or beside the prompt review area.

Initial state:
- explain that copy is generated per creative angle
- show copy settings
- show **Generate Ad Copy**

Generated state:
- show active version selector
- show validation summary
- show grouped channel copy
- allow inline edits
- show save state
- allow creating a new version

### Creative Angle Library
Each saved angle should show:
- active copy version summary
- number of copy versions
- last model/tone/variant count
- generate/regenerate copy action
- view/edit copy versions action

### Results Page
Add copy display for active version:
- grouped by channel
- show edited text where present
- show model/tone/version metadata
- include copy exports in downloads

## Server/API Shape
Recommended routes:

```text
GET  /api/copy/models?q=...
POST /api/copy/models/refresh
POST /api/runs/[runId]/copy/generate
PATCH /api/runs/[runId]/copy/[copyVersionId]
POST /api/runs/[runId]/copy/[copyVersionId]/activate
POST /api/creative-angles/[angleId]/copy/generate
PATCH /api/creative-angles/[angleId]/copy/[copyVersionId]
POST /api/creative-angles/[angleId]/copy/[copyVersionId]/activate
```

The exact route names can be adjusted to match existing project route patterns.

## File/Module Boundaries
Proposed implementation modules:

```text
src/copy/channel-copy-rules.ts
src/copy/schemas.ts
src/copy/openrouter-client.ts
src/copy/openrouter-models.ts
src/copy/copy-agent.ts
src/copy/copy-validator.ts
src/copy/copy-exporter.ts
src/lib/copy-versions.ts
components/OpenRouterModelCombobox.tsx
components/AdCopyPanel.tsx
components/CopyVersionEditor.tsx
```

Keep OpenRouter calls inside `src/copy/openrouter-client.ts` or server route files only.

## Error Handling
- Missing `OPENROUTER_API_KEY`: show a clear setup error in the UI.
- Model catalog fetch fails with cache: show stale cache warning.
- Model catalog fetch fails without cache: allow manual model id entry.
- Generation request fails: keep existing copy active and show error.
- Schema validation fails: do not activate invalid copy.
- Partial channel failure: save successful channel outputs only if the user explicitly accepts a partial version, otherwise keep previous active version.

## Testing Plan
Unit tests:
- OpenRouter model catalog loads, normalizes, caches, searches, and refreshes.
- Copy schemas accept valid channel outputs and reject invalid outputs.
- Copy generator request includes approved elements as hard truth and background context as non-authoritative context.
- Copy validator catches price mismatch, stay-length mismatch, unsupported urgency, forbidden brand/property terms, and channel length warnings.
- Copy versioning creates new versions and preserves active version behavior.
- Edited copy preserves generated and edited text.
- Exporter writes JSON, Markdown, and CSV with effective text.

Component tests:
- Review page shows Ad Copy panel with remembered defaults.
- Model combobox searches server-side.
- Generate Ad Copy creates a new visible copy version.
- Inline edits update edited state.
- Validation warnings/blockers render correctly.
- Active version selector switches versions.

Integration tests:
- Dry run style workflow: project -> destination -> creative angle -> Review -> generate copy with mocked OpenRouter -> edit copy -> export files.
- Creative angle library can generate/view copy versions without starting a new image run.
- Results page includes active copy exports.

Security tests:
- `OPENROUTER_API_KEY` is absent from client bundle.
- Output files never include `OPENROUTER_API_KEY`.

## Rollout Plan
Implement in small vertical slices:

1. Copy schemas, channel rules, validation, and tests.
2. OpenRouter model catalog/search with mocked tests.
3. OpenRouter client wrapper with mocked generation tests.
4. Copy version persistence on runs and creative angles.
5. Review page Ad Copy panel.
6. Inline editing and active version switching.
7. Export JSON/MD/CSV and include in Results/downloads.
8. Creative angle library entry point.
9. README and `agent.md` updates after behavior is accepted.

## Implementation Defaults
- Default model selection comes from `OPENROUTER_DEFAULT_COPY_MODEL`; if unset, choose the first recommended structured-output model from the cached catalog.
- Partial channel failures should create an inactive partial version only when at least one channel succeeds; the previous active version remains active until the user explicitly activates the partial version.
- Project-level copy settings should live on the project record.
- Copy generation should have its own `$1` confirmation threshold while still respecting the app-wide `$5` spend-confirmation rule.
