"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";

import { creativeBriefSchema, type CreativeBrief } from "../src/schemas";
import type { ScrapedCreativeBrief } from "../src/scraper/landing-page";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";

type BriefFormValues = {
  resortName: string;
  headline: string;
  offer: string;
  subheadline: string;
  validDates: string;
  ctaText: string;
  heroImageUrl: string;
  brandColors: string;
  location: string;
  campaignName: string;
  promotionSummary: string;
  targetAudience: string;
  tone: string;
  mustIncludeVisualElements: string;
  mustAvoidElements: string;
};

type BriefFormProps = {
  runId: string;
  initialBrief: ScrapedCreativeBrief | CreativeBrief;
  onSaved?: (brief: CreativeBrief) => void | Promise<void>;
};

export function BriefForm({ runId, initialBrief, onSaved }: BriefFormProps) {
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting }
  } = useForm<BriefFormValues>({
    defaultValues: toFormValues(initialBrief)
  });

  async function onSubmit(values: BriefFormValues) {
    setServerError(null);
    const parsed = creativeBriefSchema.safeParse(toCreativeBrief(values));

    if (!parsed.success) {
      setServerError("Please fix the highlighted brief fields before continuing.");
      return;
    }

    if (onSaved) {
      await onSaved(parsed.data);
      return;
    }

    const response = await fetch(`/api/runs/${encodeURIComponent(runId)}/brief`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ brief: parsed.data })
    });

    if (!response.ok) {
      setServerError("Unable to save the brief.");
      return;
    }

    window.location.assign(`/channels?runId=${encodeURIComponent(runId)}`);
  }

  return (
    <form className="space-y-8" onSubmit={handleSubmit(onSubmit)}>
      <section className="grid gap-5 md:grid-cols-3">
        <Field
          id="resortName"
          label="Resort name"
          required
          error={errors.resortName?.message}
        >
          <Input
            id="resortName"
            aria-invalid={errors.resortName ? "true" : "false"}
            {...register("resortName", { required: "Resort name is required." })}
          />
        </Field>
        <Field id="headline" label="Headline" required error={errors.headline?.message}>
          <Input
            id="headline"
            aria-invalid={errors.headline ? "true" : "false"}
            {...register("headline", { required: "Headline is required." })}
          />
        </Field>
        <Field id="offer" label="Offer" required error={errors.offer?.message}>
          <Input
            id="offer"
            aria-invalid={errors.offer ? "true" : "false"}
            {...register("offer", { required: "Offer is required." })}
          />
        </Field>
      </section>

      <section className="grid gap-5 md:grid-cols-2">
        <Field id="subheadline" label="Subheadline">
          <Textarea id="subheadline" {...register("subheadline")} />
        </Field>
        <Field id="promotionSummary" label="Promotion summary">
          <Textarea id="promotionSummary" {...register("promotionSummary")} />
        </Field>
        <Field id="campaignName" label="Campaign name">
          <Input id="campaignName" {...register("campaignName")} />
        </Field>
        <Field id="targetAudience" label="Target audience">
          <Input id="targetAudience" {...register("targetAudience")} />
        </Field>
        <Field id="tone" label="Tone">
          <Input id="tone" {...register("tone")} />
        </Field>
        <Field id="validDates" label="Valid dates">
          <Input id="validDates" {...register("validDates")} />
        </Field>
        <Field id="ctaText" label="CTA text">
          <Input id="ctaText" {...register("ctaText")} />
        </Field>
        <Field id="location" label="Location">
          <Input id="location" {...register("location")} />
        </Field>
        <Field id="heroImageUrl" label="Hero image URL">
          <Input id="heroImageUrl" type="url" {...register("heroImageUrl")} />
        </Field>
        <Field id="brandColors" label="Brand colors">
          <Input id="brandColors" {...register("brandColors")} />
        </Field>
        <Field id="mustIncludeVisualElements" label="Must-include visual elements">
          <Textarea id="mustIncludeVisualElements" {...register("mustIncludeVisualElements")} />
        </Field>
        <Field id="mustAvoidElements" label="Must-avoid elements">
          <Textarea id="mustAvoidElements" {...register("mustAvoidElements")} />
        </Field>
      </section>

      {serverError ? <p className="text-sm font-medium text-destructive">{serverError}</p> : null}

      <div className="flex items-center justify-between border-t pt-5">
        <p className="text-sm text-muted-foreground">Step 2 of 8</p>
        <Button type="submit" disabled={isSubmitting}>
          Continue
        </Button>
      </div>
    </form>
  );
}

function Field({
  id,
  label,
  required = false,
  error,
  children
}: {
  id: string;
  label: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={id}>{label}</Label>
        {required ? (
          <span className="rounded-sm bg-destructive/10 px-2 py-1 text-xs font-medium text-destructive">
            Required before continuing
          </span>
        ) : null}
      </div>
      {children}
      {error ? <p className="text-sm font-medium text-destructive">{error}</p> : null}
    </div>
  );
}

function toFormValues(brief: ScrapedCreativeBrief | CreativeBrief): BriefFormValues {
  return {
    resortName: brief.resortName ?? "",
    headline: brief.headline ?? "",
    offer: brief.offer ?? "",
    subheadline: brief.subheadline ?? "",
    validDates: brief.validDates ?? "",
    ctaText: brief.ctaText ?? "",
    heroImageUrl: brief.heroImageUrl ?? "",
    brandColors: brief.brandColors.join(", "),
    location: brief.location ?? "",
    campaignName: "campaignName" in brief ? brief.campaignName ?? "" : "",
    promotionSummary: "promotionSummary" in brief ? brief.promotionSummary ?? "" : "",
    targetAudience: "targetAudience" in brief ? brief.targetAudience ?? "" : "",
    tone: "tone" in brief ? brief.tone ?? "" : "",
    mustIncludeVisualElements:
      "mustIncludeVisualElements" in brief
        ? (brief.mustIncludeVisualElements ?? []).join(", ")
        : "",
    mustAvoidElements:
      "mustAvoidElements" in brief ? (brief.mustAvoidElements ?? []).join(", ") : ""
  };
}

function toCreativeBrief(values: BriefFormValues) {
  return removeEmpty({
    resortName: values.resortName.trim(),
    headline: values.headline.trim(),
    offer: values.offer.trim(),
    subheadline: values.subheadline.trim(),
    validDates: values.validDates.trim(),
    ctaText: values.ctaText.trim(),
    heroImageUrl: values.heroImageUrl.trim(),
    brandColors: splitList(values.brandColors),
    location: values.location.trim(),
    campaignName: values.campaignName.trim(),
    promotionSummary: values.promotionSummary.trim(),
    targetAudience: values.targetAudience.trim(),
    tone: values.tone.trim(),
    mustIncludeVisualElements: splitList(values.mustIncludeVisualElements),
    mustAvoidElements: splitList(values.mustAvoidElements)
  });
}

function splitList(value: string) {
  return value
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function removeEmpty<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => {
      if (Array.isArray(entry)) {
        return entry.length > 0;
      }

      return entry !== "";
    })
  );
}
