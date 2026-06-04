"use client";

import { useState } from "react";

import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

type ProjectDocumentUploadFormProps = {
  projectId: string;
};

export function ProjectDocumentUploadForm({ projectId }: ProjectDocumentUploadFormProps) {
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!file) {
      setError("Choose a .docx project document.");
      return;
    }

    setIsSubmitting(true);

    try {
      const formData = new FormData();

      formData.set("projectId", projectId);
      formData.set("file", file);

      const response = await fetch("/api/project-documents", {
        method: "POST",
        body: formData
      });
      const payload = (await response.json().catch(() => ({}))) as {
        redirectHref?: string;
        error?: string;
      };

      if (!response.ok || !payload.redirectHref) {
        throw new Error(payload.error ?? "Unable to analyze project document.");
      }

      window.location.assign(payload.redirectHref);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to analyze project document.");
      setIsSubmitting(false);
    }
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <div className="space-y-2">
        <Label htmlFor="project-document">Project document</Label>
        <Input
          id="project-document"
          name="file"
          type="file"
          accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
        />
      </div>
      <p className="text-xs leading-5 text-muted-foreground">
        Upload the campaign request form when the landing page is not ready yet. The app will
        extract Step 2 brief fields from the document.
      </p>
      {error ? <p className="text-sm font-medium text-destructive">{error}</p> : null}
      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Analyzing..." : "Analyze project document"}
      </Button>
    </form>
  );
}
