export async function createDocxFixtureBuffer() {
  return createDocxBuffer([
    "REGULAR CAMPAIGN PROJECT REQUEST FORM",
    "Project Title: AquaGlow Campaign",
    "Target Launch Date: Jun 1, 2026 (flexible)",
    "Project Description*: Stay 4/3 + 4 Tickets to AquaGlow for $199 (this offer is valid from May 15 to September)",
    "Marketing Channels*: Social Ads, Email, affiliated, SEO",
    "Target Audience:",
    "Demographics: Parents (Ages 28–55) with children ages 3–15.",
    "Cold Audience (Interests)",
    "Family Travel: Family vacations, Amusement parks, Water parks.",
    "Bargain Hunting: Extreme Couponing, Discounting",
    "Social Ads:",
    "Orlando",
    "Headline: Determine by the Copywriter",
    "Subheadline:",
    "3 Nights + 4 AquaGlow tickets $199",
    "Logos: Westgate Resorts Orlando and Aquatica",
    "Website measure: 1400x 600, 980x 305, 1076 x800, 592 x 440, 800x310 (Only photo concept, no text, no logo)",
    "Email internal: (1) 600x585 and (1) 420x420 (Only concept photo with offer (no Westgate logo)",
    "SEO: 950x270, 800 x 450 (horizontal, original concept)",
    "Visual Concept: A fun night at Aquatica where everything is covered in glowing neon lights, showing families, they can get a full vacation deal for just $199.",
    "A clear offer badge highlights:",
    "3 Nights + 4 tickets for $199",
    "Example: Experience the relaxation of the resort by day and the excitement of the AQUAGLOW event by night."
  ]);
}

async function createDocxBuffer(paragraphs: string[]) {
  const { ZipArchive } = importArchiver();
  const archive = new ZipArchive({ zlib: { level: 9 } });
  const chunks: Buffer[] = [];
  const completion = new Promise<Buffer>((resolve, reject) => {
    archive.on("data", (chunk: Buffer) => chunks.push(chunk));
    archive.on("end", () => resolve(Buffer.concat(chunks)));
    archive.on("error", reject);
  });

  archive.append(contentTypesXml(), { name: "[Content_Types].xml" });
  archive.append(documentXml(paragraphs), { name: "word/document.xml" });
  archive.append(Buffer.from("fake image 1"), { name: "word/media/image1.png" });
  archive.append(Buffer.from("fake image 2"), { name: "word/media/image2.png" });
  await archive.finalize();

  return completion;
}

type ZipArchiveStream = NodeJS.ReadWriteStream & {
  append(source: string | Buffer, data: { name: string }): ZipArchiveStream;
  finalize(): Promise<void>;
};

type ZipArchiveConstructor = new (options?: { zlib?: { level: number } }) => ZipArchiveStream;

function importArchiver() {
  const requireFromWorkspace = eval("require") as (specifier: string) => unknown;

  return requireFromWorkspace("archiver") as {
    ZipArchive: ZipArchiveConstructor;
  };
}

function documentXml(paragraphs: string[]) {
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
    "<w:body>",
    ...paragraphs.map(
      (paragraph) => `<w:p><w:r><w:t>${escapeXml(paragraph)}</w:t></w:r></w:p>`
    ),
    "</w:body>",
    "</w:document>"
  ].join("");
}

function contentTypesXml() {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
    '<Default Extension="xml" ContentType="application/xml"/>',
    '<Default Extension="png" ContentType="image/png"/>',
    "</Types>"
  ].join("");
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
