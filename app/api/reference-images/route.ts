import { NextResponse } from "next/server";
import { fal } from "@fal-ai/client";

fal.config({ credentials: () => process.env.FAL_KEY });

const MAX_REFERENCE_IMAGE_BYTES = 20 * 1024 * 1024;

export async function POST(request: Request) {
  if (!process.env.FAL_KEY) {
    return NextResponse.json(
      { error: "FAL_KEY is required to upload reference images." },
      { status: 400 }
    );
  }

  let formData: FormData;

  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid multipart upload." }, { status: 400 });
  }

  const runId = formData.get("runId");
  const file = formData.get("file");

  if (typeof runId !== "string" || !runId.trim()) {
    return NextResponse.json({ error: "runId is required." }, { status: 400 });
  }

  if (!isUploadedImage(file)) {
    return NextResponse.json({ error: "Upload an image file." }, { status: 400 });
  }

  if (file.size > MAX_REFERENCE_IMAGE_BYTES) {
    return NextResponse.json(
      { error: "Reference images must be 20 MB or smaller." },
      { status: 400 }
    );
  }

  try {
    const url = await fal.storage.upload(file, {
      lifecycle: {
        expiresIn: "30d"
      }
    });

    return NextResponse.json({
      url,
      name: file.name,
      size: file.size,
      contentType: file.type
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to upload reference image.";

    return NextResponse.json({ error: message }, { status: 502 });
  }
}

function isUploadedImage(value: FormDataEntryValue | null): value is File {
  return value instanceof File && value.type.startsWith("image/") && value.size > 0;
}
