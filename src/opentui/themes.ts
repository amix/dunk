export const DUNK_DIFF_THEME_NAMES = ["graphite", "midnight", "paper", "ember"] as const;

export type DunkDiffThemeName = (typeof DUNK_DIFF_THEME_NAMES)[number];
