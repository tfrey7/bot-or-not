// Combine LLM-scored factors with deterministic-scored factors into a
// single array ordered by the canonical `BON_FACTORS` list. The
// investigation pipeline expects all 16 factors in the canonical order —
// the LLM's response when running under the "split" experiment carries
// only the soft factors, and the deterministic helper fills in the rest.

import { BON_FACTORS } from "../../factors.ts";
import type { Factor } from "../../types.ts";

export function bonMergeFactors(
  llmFactors: Factor[],
  deterministicFactors: Factor[]
): Factor[] {
  const byKey = new Map<string, Factor>();

  for (const f of llmFactors) {
    byKey.set(f.key, f);
  }

  for (const f of deterministicFactors) {
    byKey.set(f.key, f);
  }

  return BON_FACTORS.map((meta) => {
    const f = byKey.get(meta.key);
    if (f) {
      return f;
    }

    // Missing factor — fall back to a neutral placeholder so the
    // aggregator doesn't crash. Should not happen in normal use.
    return {
      key: meta.key,
      score: 0,
      confidence: 0,
      reasoning: "missing",
      evidence: [],
    };
  });
}
