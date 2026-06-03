"use client";

import { useState } from "react";

import { Button } from "./ui/button";
import { Input } from "./ui/input";

type ReferenceImageUploaderProps = {
  runId: string;
  label: string;
  value?: readonly string[];
  onChange: (urls: string[]) => void;
};

export function ReferenceImageUploader({
  runId,
  label,
  value = [],
  onChange
}: ReferenceImageUploaderProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const urls = [...value];

  async function handleUpload(files: FileList | null) {
    const selectedFiles = Array.from(files ?? []);

    if (selectedFiles.length === 0) {
      return;
    }

    setIsUploading(true);
    setError(null);

    try {
      const uploadedUrls: string[] = [];

      for (const file of selectedFiles) {
        const formData = new FormData();
        formData.append("runId", runId);
        formData.append("file", file);

        const response = await fetch("/api/reference-images", {
          method: "POST",
          body: formData
        });

        if (!response.ok) {
          throw new Error("Unable to upload reference image.");
        }

        const payload = (await response.json()) as { url?: string };

        if (!payload.url) {
          throw new Error("Reference image upload did not return a URL.");
        }

        uploadedUrls.push(payload.url);
      }

      onChange(Array.from(new Set([...urls, ...uploadedUrls])));
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Unable to upload reference image.");
    } finally {
      setIsUploading(false);
    }
  }

  function removeUrl(url: string) {
    onChange(urls.filter((existingUrl) => existingUrl !== url));
  }

  return (
    <div className="space-y-2">
      <label className="block space-y-2 text-sm font-medium">
        <span>{label}</span>
        <Input
          aria-label={label}
          type="file"
          accept="image/*"
          multiple
          disabled={isUploading}
          onChange={(event) => {
            void handleUpload(event.currentTarget.files);
            event.currentTarget.value = "";
          }}
        />
      </label>
      {urls.length > 0 ? (
        <ul className="space-y-2">
          {urls.map((url) => (
            <li
              key={url}
              className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-xs"
            >
              <span className="break-all text-muted-foreground">{url}</span>
              <Button
                type="button"
                className="h-8 border bg-background px-2 text-xs text-foreground hover:bg-muted"
                onClick={() => removeUrl(url)}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      {isUploading ? <p className="text-xs text-muted-foreground">Uploading reference image</p> : null}
      {error ? <p className="text-xs font-medium text-destructive">{error}</p> : null}
    </div>
  );
}
