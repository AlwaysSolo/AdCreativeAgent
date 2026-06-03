import { z } from "zod";

import { gptImage2QualityValues } from "../models/image-options";

export const channelKeySchema = z.enum([
  "meta",
  "google_display",
  "website",
  "email_internal",
  "seo"
]);

export const channelSizeSchema = z.object({
  name: z.string().trim().min(1),
  w: z.number().int().positive(),
  h: z.number().int().positive(),
  aspectLabel: z.string().trim().min(1)
});

export const creativeBriefSchema = z.object({
  resortName: z.string().trim().min(1),
  headline: z.string().trim().min(1),
  offer: z.string().trim().min(1),
  subheadline: z.string().trim().min(1).optional(),
  validDates: z.string().trim().min(1).optional(),
  ctaText: z.string().trim().min(1).optional(),
  heroImageUrl: z.string().url().optional(),
  brandColors: z.array(z.string().trim().min(1)).default([]),
  location: z.string().trim().min(1).optional(),
  campaignName: z.string().trim().min(1).optional(),
  promotionSummary: z.string().trim().min(1).optional(),
  targetAudience: z.string().trim().min(1).optional(),
  tone: z.string().trim().min(1).optional(),
  mustIncludeVisualElements: z.array(z.string().trim().min(1)).default([]),
  mustAvoidElements: z.array(z.string().trim().min(1)).default([])
});

export const channelSelectionSchema = z.object({
  channel: channelKeySchema,
  enabled: z.boolean().default(true),
  sizes: z.array(channelSizeSchema).min(1).optional()
});

export const modelInfoSchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  kind: z.enum(["image", "video", "audio", "other"]),
  description: z.string().trim().min(1).optional(),
  tags: z.array(z.string().trim().min(1)).optional(),
  thumbnailUrl: z.string().url().optional(),
  pricing: z
    .object({
      unit: z.enum(["image", "second", "megapixel", "request"]),
      amountUsd: z.number().nonnegative()
    })
    .optional(),
  capabilities: z
    .object({
      textToImage: z.boolean().optional(),
      imageToImage: z.boolean().optional(),
      imageToVideo: z.boolean().optional(),
      supportsOnImageText: z.boolean().optional(),
      supportsNegativePrompt: z.boolean().optional(),
      maxResolution: z
        .object({
          w: z.number().int().positive(),
          h: z.number().int().positive()
        })
        .optional(),
      supportedAspects: z.array(z.string().trim().min(1)).optional()
    })
    .optional()
});

export const modelSelectionSchema = z.object({
  imageModelId: z.string().trim().min(1),
  videoModelId: z.string().trim().min(1).optional()
});

export const imageModelOptionsSchema = z.object({
  quality: z.enum(gptImage2QualityValues).optional()
});

export const promptAssignmentTargetSchema = z.object({
  channel: channelKeySchema,
  sizeNames: z.array(z.string().trim().min(1)).min(1)
});

export const referenceImageUrlSchema = z.string().url();

export const promptAssignmentSchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  prompt: z.string().trim().min(1),
  negativePrompt: z.string().trim().min(1).optional(),
  referenceImageUrls: z.array(referenceImageUrlSchema).optional(),
  targets: z.array(promptAssignmentTargetSchema).min(1)
});

export const reviewedPromptSchema = z.object({
  assetId: z.string().trim().min(1),
  channel: channelKeySchema,
  sizeName: z.string().trim().min(1),
  prompt: z.string().trim().min(1),
  negativePrompt: z.string().trim().min(1),
  referenceImageUrls: z.array(referenceImageUrlSchema).optional()
});

export const creativeChatMessageSchema = z.object({
  role: z.enum(["assistant", "user"]),
  content: z.string().trim().min(1),
  createdAt: z.string().datetime({ offset: true })
});

export const creativeConceptSchema = z.object({
  id: z.string().trim().min(1),
  title: z.string().trim().min(1),
  description: z.string().trim().min(1),
  heroVisual: z.string().trim().min(1).optional(),
  adStructure: z.string().trim().min(1).optional(),
  approvedElementsUsed: z.array(z.string().trim().min(1)).optional(),
  avoid: z.array(z.string().trim().min(1)).optional()
});

export const creativeAdElementSchema = z.object({
  id: z.string().trim().min(1),
  label: z.string().trim().min(1),
  value: z.string().trim().min(1),
  source: z.enum(["scrape", "brief", "agent", "user"]).default("scrape"),
  selected: z.boolean().default(true)
});

export const creativeWorkspaceSchema = z.object({
  status: z
    .enum([
      "not_started",
      "elements_ready",
      "elements_approved",
      "questioning",
      "concepts_ready",
      "prompts_ready"
    ])
    .default("not_started"),
  adElements: z.array(creativeAdElementSchema).optional(),
  elementsApproved: z.boolean().optional(),
  referenceImageUrls: z.array(referenceImageUrlSchema).optional(),
  messages: z.array(creativeChatMessageSchema).default([]),
  concepts: z.array(creativeConceptSchema).optional(),
  approvedConceptId: z.string().trim().min(1).optional(),
  generatedPrompts: z.array(reviewedPromptSchema).optional()
});

export const runRequestSchema = z
  .object({
    brief: creativeBriefSchema,
    channels: z.array(channelSelectionSchema).min(1),
    models: z.partialRecord(channelKeySchema, modelSelectionSchema),
    dryRun: z.boolean().default(false),
    editedPrompts: z.partialRecord(channelKeySchema, z.string().trim().min(1)).optional(),
    promptAssignments: z.array(promptAssignmentSchema).optional(),
    reviewedPrompts: z.array(reviewedPromptSchema).optional(),
    forceNoTextMode: z.partialRecord(channelKeySchema, z.boolean()).optional()
  })
  .superRefine((request, context) => {
    const enabledChannels = request.channels.filter((selection) => selection.enabled);

    if (enabledChannels.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["channels"],
        message: "At least one channel must be enabled."
      });
    }

    for (const selection of enabledChannels) {
      if (!request.models[selection.channel]?.imageModelId) {
        context.addIssue({
          code: "custom",
          path: ["models", selection.channel, "imageModelId"],
          message: "Selected channels require an image model."
        });
      }
    }
  });

export const assetResultSchema = z.object({
  assetId: z.string().trim().min(1),
  runId: z.string().trim().min(1),
  channel: channelKeySchema,
  size: channelSizeSchema,
  status: z.enum(["queued", "running", "done", "failed"]),
  progress: z.number().min(0).max(100),
  modelId: z.string().trim().min(1),
  prompt: z.string().trim().min(1),
  seed: z.number().int(),
  outputPath: z.string().trim().min(1).optional(),
  thumbnailUrl: z.string().trim().min(1).optional(),
  error: z.string().trim().min(1).optional(),
  costUsd: z.number().nonnegative().optional(),
  textDetected: z.boolean().optional(),
  ocrConfidence: z.number().min(0).max(1).optional()
});

export const costLogEntrySchema = z.object({
  timestamp: z.string().datetime({ offset: true }),
  runId: z.string().trim().min(1),
  assetId: z.string().trim().min(1).optional(),
  channel: channelKeySchema.optional(),
  modelId: z.string().trim().min(1),
  seed: z.number().int().optional(),
  params: z.record(z.string(), z.unknown()),
  reportedCostUsd: z.number().nonnegative(),
  dryRun: z.boolean().default(false),
  error: z.string().trim().min(1).optional()
});

export const massEditInputImageSchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  sourceUrl: z.string().url(),
  width: z.number().int().positive(),
  height: z.number().int().positive()
});

export const massEditBatchSchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  prompt: z.string().trim().min(1),
  modelId: z.string().trim().min(1),
  model: modelInfoSchema,
  quality: z.enum(gptImage2QualityValues).optional(),
  images: z.array(massEditInputImageSchema).min(1)
});

export const massEditRunRequestSchema = z.object({
  projectId: z.string().trim().min(1),
  dryRun: z.boolean().default(true),
  batches: z.array(massEditBatchSchema).min(1)
});

export const massEditAssetResultSchema = z.object({
  runId: z.string().trim().min(1),
  assetId: z.string().trim().min(1),
  batchId: z.string().trim().min(1),
  imageId: z.string().trim().min(1),
  sourceName: z.string().trim().min(1),
  modelId: z.string().trim().min(1),
  prompt: z.string().trim().min(1),
  quality: z.enum(gptImage2QualityValues).optional(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  outputPath: z.string().trim().min(1),
  thumbnailUrl: z.string().trim().min(1),
  seed: z.number().int()
});

export type ChannelKey = z.infer<typeof channelKeySchema>;
export type ChannelSize = z.infer<typeof channelSizeSchema>;
export type CreativeBrief = z.infer<typeof creativeBriefSchema>;
export type ChannelSelection = z.infer<typeof channelSelectionSchema>;
export type ModelInfo = z.infer<typeof modelInfoSchema>;
export type ModelSelection = z.infer<typeof modelSelectionSchema>;
export type ImageModelOptions = z.infer<typeof imageModelOptionsSchema>;
export type ReferenceImageUrl = z.infer<typeof referenceImageUrlSchema>;
export type PromptAssignmentTarget = z.infer<typeof promptAssignmentTargetSchema>;
export type PromptAssignment = z.infer<typeof promptAssignmentSchema>;
export type ReviewedPrompt = z.infer<typeof reviewedPromptSchema>;
export type CreativeChatMessage = z.infer<typeof creativeChatMessageSchema>;
export type CreativeConcept = z.infer<typeof creativeConceptSchema>;
export type CreativeAdElement = z.infer<typeof creativeAdElementSchema>;
export type CreativeWorkspace = z.infer<typeof creativeWorkspaceSchema>;
export type RunRequest = z.infer<typeof runRequestSchema>;
export type AssetResult = z.infer<typeof assetResultSchema>;
export type CostLogEntry = z.infer<typeof costLogEntrySchema>;
export type MassEditInputImage = z.infer<typeof massEditInputImageSchema>;
export type MassEditBatch = z.infer<typeof massEditBatchSchema>;
export type MassEditRunRequest = z.infer<typeof massEditRunRequestSchema>;
export type MassEditAssetResult = z.infer<typeof massEditAssetResultSchema>;
