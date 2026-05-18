// Validation/normalization for the persona block Claude returns.
// Depends on BON_PERSONA_LABELS / BON_ARCHETYPE_KEYS from factors.js.

(function () {
  // Validates the persona block from Claude's response. Returns null when the
  // model omits it or returns a label outside the allowed enum — UI then falls
  // back to no-persona rendering instead of inventing a label from the verdict.
  //
  // `archetypes` is the per-axis 0–1 score map that powers the radar chart.
  // Axis list is the canonical one in factors.js so reports.js can trust the
  // shape: every known axis present, clamped to [0,1], or null for legacy data.
  function bonNormalizePersona(raw) {
    if (!raw || typeof raw !== "object") return null;
    const label = String(raw.label || "")
      .toLowerCase()
      .trim();
    if (!BON_PERSONA_LABELS.includes(label)) return null;
    const reasoning =
      typeof raw.reasoning === "string" ? raw.reasoning.trim() : "";
    return {
      label,
      reasoning,
      archetypes: bonNormalizeArchetypes(raw.archetypes),
    };
  }

  function bonNormalizeArchetypes(raw) {
    const out = {};
    const src = raw && typeof raw === "object" ? raw : {};
    let anyPresent = false;
    for (const axis of BON_ARCHETYPE_KEYS) {
      const v = src[axis];
      if (typeof v === "number" && Number.isFinite(v)) {
        out[axis] = Math.max(0, Math.min(1, v));
        anyPresent = true;
      } else {
        out[axis] = 0;
      }
    }
    // Legacy investigations (and any pre-archetype model output) have no axes —
    // return null so the renderer can fall back to the text-only persona panel
    // instead of drawing a flat zero radar.
    return anyPresent ? out : null;
  }

  globalThis.bonNormalizePersona = bonNormalizePersona;
  globalThis.bonNormalizeArchetypes = bonNormalizeArchetypes;
})();
