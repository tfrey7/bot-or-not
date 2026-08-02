// Deterministic ~10% sample of non-bot verdicts used as a liveness control
// group: human-side accounts otherwise never get re-checked, so the bot-side
// gone rate has no baseline. Membership is a pure hash of the username — no
// stored state, the cohort self-extends as new verdicts arrive, the same
// accounts stay in it across sweeps, and exports can reproduce it in SQL.

const CONTROL_COHORT_DIVISOR = 10;

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

export function isControlCohortMember(username: string): boolean {
  const normalized = username.toLowerCase();
  let hash = FNV_OFFSET_BASIS;

  for (let i = 0; i < normalized.length; i++) {
    hash ^= normalized.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }

  return hash % CONTROL_COHORT_DIVISOR === 0;
}
