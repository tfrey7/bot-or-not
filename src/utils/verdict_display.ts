// Presentation-only mapping from the verdict scalar + persona to what the UI
// shows. The verdict math (src/verdict.ts) is untouched — an `app` persona
// still scores bot-side; this layer only decides that such accounts read as
// "App" rather than "Bot" in the headline and don't count as suspected bots.

import type { Persona, Verdict } from "../types.ts";
import { formatVerdict } from "./format_text.ts";

export function isAppPersona(persona: Persona | null | undefined): boolean {
  return persona?.label === "app";
}

export function verdictBadgeLabel(
  verdict: Verdict,
  persona: Persona | null | undefined
): string {
  if (isAppPersona(persona)) {
    return "App";
  }

  return formatVerdict(verdict);
}

export function verdictBadgeModifier(
  verdict: Verdict,
  persona: Persona | null | undefined
): string {
  if (isAppPersona(persona)) {
    return "app";
  }

  return verdict;
}
