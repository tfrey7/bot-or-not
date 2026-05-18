// Lenient JSON extraction — strips markdown code fences and locates the first
// {...} block. Used to parse Claude's verdict output, which may include
// surrounding narration.

export function bonExtractJson(text: string | null | undefined): unknown {
  if (!text) {
    return null;
  }

  let s = text.trim();
  if (s.startsWith("```")) {
    s = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
  }

  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    return null;
  }

  const candidate = s.slice(start, end + 1);
  try {
    return JSON.parse(candidate);
  } catch (err) {
    console.error("[Bot or Not] verdict JSON parse failed", err, candidate);
    return null;
  }
}
