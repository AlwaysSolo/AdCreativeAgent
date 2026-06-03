export type ChannelKey =
  | "meta"
  | "google_display"
  | "website"
  | "email_internal"
  | "seo";

export type ChannelSize = Readonly<{
  name: string;
  w: number;
  h: number;
  aspectLabel: string;
}>;

export type ChannelConfig = Readonly<{
  allowOnImageText: boolean;
  overlayLogo: boolean;
  overlayCTA: boolean;
  overlayHeadline: boolean;
  sizes: readonly ChannelSize[];
  uiBadge: string;
}>;

export type SelectedChannelSizes = Partial<Record<ChannelKey, string[]>>;

export const meta: ChannelConfig = {
  allowOnImageText: true,
  overlayLogo: true,
  overlayCTA: true,
  overlayHeadline: true,
  uiBadge: "With overlays",
  sizes: [
    { name: "Feed portrait", w: 1080, h: 1350, aspectLabel: "4:5" },
    { name: "Stories/Reels", w: 1080, h: 1920, aspectLabel: "9:16" },
    { name: "Feed square", w: 1200, h: 1200, aspectLabel: "1:1" },
    { name: "Feed landscape", w: 1920, h: 1080, aspectLabel: "16:9" }
  ]
};

export const google_display: ChannelConfig = {
  allowOnImageText: true,
  overlayLogo: true,
  overlayCTA: true,
  overlayHeadline: true,
  uiBadge: "With overlays",
  sizes: [
    { name: "Medium rectangle", w: 300, h: 250, aspectLabel: "1.2:1" },
    { name: "Large rectangle", w: 336, h: 280, aspectLabel: "1.2:1" },
    { name: "Leaderboard", w: 728, h: 90, aspectLabel: "8.09:1" },
    { name: "Half page", w: 300, h: 600, aspectLabel: "1:2" },
    { name: "Large mobile", w: 320, h: 100, aspectLabel: "3.2:1" },
    { name: "Responsive square", w: 1200, h: 1200, aspectLabel: "1:1" },
    { name: "Responsive landscape", w: 1200, h: 628, aspectLabel: "1.91:1" },
    { name: "Skyscraper", w: 160, h: 600, aspectLabel: "4:15" }
  ]
};

export const website: ChannelConfig = {
  allowOnImageText: false,
  overlayLogo: false,
  overlayCTA: false,
  overlayHeadline: false,
  uiBadge: "Concept photo only — no text/logo",
  sizes: [
    { name: "Hero wide", w: 1400, h: 600, aspectLabel: "~2.33:1" },
    { name: "Banner short", w: 980, h: 305, aspectLabel: "~3.21:1" },
    { name: "Feature large", w: 1076, h: 800, aspectLabel: "~1.35:1" },
    { name: "Feature small", w: 592, h: 440, aspectLabel: "~1.35:1" },
    { name: "Strip banner", w: 800, h: 310, aspectLabel: "~2.58:1" }
  ]
};

export const email_internal: ChannelConfig = {
  allowOnImageText: false,
  overlayLogo: false,
  overlayCTA: false,
  overlayHeadline: false,
  uiBadge: "Concept photo only — no text/logo",
  sizes: [
    { name: "Email near-square", w: 600, h: 585, aspectLabel: "~1.03:1" },
    { name: "Email square", w: 420, h: 420, aspectLabel: "1:1" }
  ]
};

export const seo: ChannelConfig = {
  allowOnImageText: false,
  overlayLogo: false,
  overlayCTA: false,
  overlayHeadline: false,
  uiBadge: "Concept as is — no overlays",
  sizes: [
    { name: "Horizontal article", w: 950, h: 270, aspectLabel: "~3.52:1" },
    { name: "Horizontal hero", w: 800, h: 450, aspectLabel: "16:9" }
  ]
};

export const channels: Record<ChannelKey, ChannelConfig> = {
  meta,
  google_display,
  website,
  email_internal,
  seo
};

export function allSizeNamesForChannel(channel: ChannelKey) {
  return channels[channel].sizes.map((size) => size.name);
}

export function defaultSelectedChannelSizes(selectedChannels: readonly ChannelKey[]) {
  return Object.fromEntries(
    selectedChannels.map((channel) => [channel, allSizeNamesForChannel(channel)])
  ) as SelectedChannelSizes;
}

export function selectedSizesForChannel(
  channel: ChannelKey,
  selectedChannelSizes?: SelectedChannelSizes
) {
  const selectedNames = selectedChannelSizes?.[channel];

  if (!selectedNames) {
    return [...channels[channel].sizes];
  }

  const selectedSet = new Set(selectedNames);

  return channels[channel].sizes.filter((size) => selectedSet.has(size.name));
}

export function normalizeSelectedChannelSizes(
  selectedChannels: readonly ChannelKey[],
  selectedChannelSizes?: SelectedChannelSizes
) {
  const normalized: SelectedChannelSizes = {};

  for (const channel of selectedChannels) {
    const selected = selectedSizesForChannel(channel, selectedChannelSizes);

    normalized[channel] = selected.length
      ? selected.map((size) => size.name)
      : allSizeNamesForChannel(channel);
  }

  return normalized;
}
