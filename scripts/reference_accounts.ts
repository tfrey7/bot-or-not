// Canonical regression set: known Reddit accounts with hand-judged verdicts
// and personas. `npm run regress` compares pipeline output against these
// after prompt or verdict-math changes; `npm run harvest` reads the
// usernames when building the browser harvest script.
//
// Comparison is soft on purpose (verdict band within `expectVerdicts`,
// persona within the top-2 archetypes or label) — LLM nondeterminism makes
// strict equality flaky.

export interface ReferenceAccount {
  username: string;
  note: string;
  expectVerdicts: string[];
  expectPersonas: string[];
}

export const REFERENCE_ACCOUNTS: ReferenceAccount[] = [
  {
    username: "B-z_B-s",
    note: "r/politics megaposter, 1.4M+ karma in under a year; human left-wing zealot",
    expectVerdicts: ["human", "likely-human"],
    expectPersonas: ["politics"],
  },
  {
    username: "Ask4MD",
    note: "Most prolific r/Conservative poster; human right-wing zealot (left/right mirror of B-z_B-s — if only one lands politics, the prompt has partisan bias)",
    expectVerdicts: ["human", "likely-human"],
    expectPersonas: ["politics"],
  },
  {
    username: "WillyNilly1997",
    note: "Hyper-conservative r/Conservative poster; hid their history mid-2026 (972k karma, 0 visible items) so this now exercises the hidden-profile abstain path",
    expectVerdicts: ["uncertain"],
    expectPersonas: ["politics", "normal"],
  },
  {
    username: "Biscocino",
    note: "OnlyFans-funnel account, same ring as siruppaws; Bot Bouncer banned",
    expectVerdicts: ["bot", "likely-bot"],
    expectPersonas: ["cam_model"],
  },
  {
    username: "siruppaws",
    note: "OnlyFans-funnel account, same ring as Biscocino; founder-mod of r/altgothcloset",
    expectVerdicts: ["bot", "likely-bot"],
    expectPersonas: ["cam_model"],
  },
  {
    username: "netphilia",
    note: "Serial karma farmer, 5M+ karma over 15 years; human-operated so verdict stays human-side, persona is the farmer signal",
    expectVerdicts: ["human", "likely-human"],
    expectPersonas: ["farmer"],
  },
  // candy-fairyx — LLM AITA-storyteller bot — was banned by Reddit in mid-2026
  // and can no longer be harvested. Keep an eye out for a replacement
  // LLM-storyteller account to restore that coverage.
];
