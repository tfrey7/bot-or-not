// Lenient JSON extraction — strips markdown code fences and locates the first
// {...} block. Used to parse Claude's verdict output, which may include
// surrounding narration.

export function extractJson(text: string | null | undefined): unknown {
  if (!text) {
    return null;
  }

  let trimmed = text.trim();
  if (trimmed.startsWith("```")) {
    trimmed = trimmed.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
  }

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    return null;
  }

  const candidate = trimmed.slice(start, end + 1);
  try {
    return JSON.parse(candidate);
  } catch (error) {
    console.error("[Bot or Not] verdict JSON parse failed", error, candidate);
    return null;
  }
}
