// Small lookup tables used by sort + heatmap rendering. Kept as a
// dedicated file so the rest of the feature doesn't need to scroll past
// 14-entry month/day arrays.

import type { Verdict } from "../../types.ts";

export const REDDITORS_VERDICT_RANK: Record<Verdict, number> = {
  bot: 0,
  "likely-bot": 1,
  uncertain: 2,
  "likely-human": 3,
  human: 4,
};

export const REDDITORS_MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export const REDDITORS_DAY_NAMES = [
  "Sun",
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
];
