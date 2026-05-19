// The agent's final-turn summary is rendered as a single inline status line.
// Block-level markdown (headers, lists, code fences) gets collapsed to text;
// inline emphasis (**bold**, *italic*, `code`) becomes safe HTML so the
// status line can show typographic accents without re-introducing an XSS
// vector. Caller writes the result with innerHTML.

const HTML_ESCAPE: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(input: string): string {
  return input.replace(/[&<>"']/g, (char) => HTML_ESCAPE[char]);
}

export function bonAiCommandFormatSummary(raw: string): string {
  if (!raw) {
    return "";
  }

  let text = raw.trim();

  text = text.replace(/```[\s\S]*?```/g, " ");
  text = text.replace(/^\s{0,3}#{1,6}\s+/gm, "");
  text = text.replace(/^\s*[-*+]\s+/gm, "");
  text = text.replace(/^\s*\d+\.\s+/gm, "");

  text = text.replace(/\s*\n\s*/g, " · ");
  text = text.replace(/\s+/g, " ").trim();

  text = escapeHtml(text);

  text = text.replace(/`([^`]+)`/g, "<code>$1</code>");
  text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  text = text.replace(
    /(^|[\s([])\*([^*\s][^*]*?)\*(?=[\s.,!?;:)\]]|$)/g,
    "$1<em>$2</em>"
  );
  text = text.replace(
    /(^|[\s([])_([^_\s][^_]*?)_(?=[\s.,!?;:)\]]|$)/g,
    "$1<em>$2</em>"
  );

  return text;
}
