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

    const hasRating = userNotes.rating !== null;
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

export function bonSelfImprovementAgreement(
  annotated: AnnotatedReport
): AgreementState {
  const yourPick = annotated.userNotes.rating;
  const aiPick = annotated.report.investigation?.persona?.label ?? null;

  if (yourPick === null) {
    return "no-rating";
  }

  if (aiPick === null) {
    return "no-ai-pick";
  }

  return yourPick === aiPick ? "agree" : "disagree";
}
