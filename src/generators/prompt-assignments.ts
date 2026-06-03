import type { ChannelKey } from "../config/channels";
import type { PromptAssignment, ReviewedPrompt } from "../schemas";

export type PromptAssignableItem = {
  assetId: string;
  channel: ChannelKey;
  sizeName: string;
  prompt: string;
  negativePrompt: string;
  referenceImageUrls?: string[];
};

export function applyPromptAssignments<T extends PromptAssignableItem>(
  items: readonly T[],
  assignments: readonly PromptAssignment[]
): T[] {
  return items.map((item) => {
    const assignment = matchingAssignment(item, assignments);

    if (!assignment) {
      return { ...item };
    }

    return {
      ...item,
      prompt: [
        `User creative prompt (${assignment.name}): ${assignment.prompt}`,
        "System, channel, brand, and sizing rules:",
        item.prompt
      ].join("\n\n"),
      negativePrompt: [item.negativePrompt, assignment.negativePrompt]
        .filter((value): value is string => Boolean(value?.trim()))
        .join(", "),
      referenceImageUrls: mergeReferenceImageUrls(
        item.referenceImageUrls,
        assignment.referenceImageUrls
      )
    };
  });
}

export function reviewedPromptForAsset(
  prompts: readonly ReviewedPrompt[] | undefined,
  asset: Pick<ReviewedPrompt, "assetId" | "channel" | "sizeName">
) {
  return prompts?.find(
    (prompt) =>
      prompt.assetId === asset.assetId ||
      (prompt.channel === asset.channel && prompt.sizeName === asset.sizeName)
  );
}

function matchingAssignment(
  item: PromptAssignableItem,
  assignments: readonly PromptAssignment[]
) {
  return [...assignments]
    .reverse()
    .find((assignment) =>
      assignment.targets.some(
        (target) =>
          target.channel === item.channel && target.sizeNames.includes(item.sizeName)
      )
    );
}

function mergeReferenceImageUrls(
  itemUrls: readonly string[] | undefined,
  assignmentUrls: readonly string[] | undefined
) {
  return Array.from(new Set([...(itemUrls ?? []), ...(assignmentUrls ?? [])]));
}
