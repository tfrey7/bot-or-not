import type { Report, UserNotes } from "../../types.ts";

export interface AnnotatedReport {
  username: string;
  report: Report;
  userNotes: UserNotes;
}

export function bonSelfImprovementCollect(
  reports: Record<string, Report>
): AnnotatedReport[] {
  const collected: AnnotatedReport[] = [];

  for (const [username, report] of Object.entries(reports)) {
    const userNotes = report.userNotes;
    if (!userNotes) {
      continue;
    }

    const hasRating = userNotes.ratings.length > 0;
    const hasNote = userNotes.note.trim() !== "";
    if (!hasRating && !hasNote) {
      continue;
    }

    collected.push({ username, report, userNotes });
  }

  collected.sort((a, b) => b.userNotes.updatedAt - a.userNotes.updatedAt);

  return collected;
}

export type AgreementState = "agree" | "disagree" | "no-ai-pick" | "no-rating";

// User picks are a set — "agree" when the AI's single pick is anywhere in
// that set. Picking stan+hustler and the AI also says stan counts as
// agreement; the operator already identified that signal.
export function bonSelfImprovementAgreement(
  annotated: AnnotatedReport
): AgreementState {
  const yourPicks = annotated.userNotes.ratings;
  const investigation = annotated.report.investigation;
  const aiPick =
    investigation?.status === "done"
      ? (investigation.results.persona?.label ?? null)
      : null;

  if (yourPicks.length === 0) {
    return "no-rating";
  }

  if (aiPick === null) {
    return "no-ai-pick";
  }

  return yourPicks.includes(aiPick) ? "agree" : "disagree";
}
