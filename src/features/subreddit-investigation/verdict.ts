// Derive a subreddit-level verdict from the per-user investigations of the
// sampled authors. Mirrors src/verdict.ts in spirit — the verdict isn't
// stored, it's derived on demand from current Report records so the badge
// stays accurate as individual investigations complete in the background.
//
// The rule (kept deliberately simple per design):
//   - Bot-leaning user = verdict in {bot, likely-bot}.
//   - Subreddit is compromised iff botLeaningCount / doneCount >= 0.5.
//   - "Ready" iff every sampled user has reached a terminal state
//     (done or error). Until then the badge shows pending progress.
//   - Errored / missing samples don't contribute to numerator or denominator;
//     they're just absences. A sub with 9 done + 1 errored is still ready.
//
// We require at least one done sample to call a verdict at all — a sub
// where every sample errored is "ready but inconclusive."
//
// No staleness check on the per-user reports: a "done" verdict from any
// point in the past is good enough (see memory: trust-stale-reports). The
// only thing the caller does after this is paint a badge.

import type {
  Investigation,
  Report,
  SubredditReport,
  Verdict,
} from "../../types.ts";
import { findReportKey } from "../../utils/history.ts";

const BOT_LEANING_VERDICTS = new Set<Verdict>(["bot", "likely-bot"]);
const COMPROMISED_FRACTION = 0.5;

export type SubredditSampleStatus = Investigation["status"] | "missing";

export interface SubredditSample {
  username: string;
  status: SubredditSampleStatus;
  verdict: Verdict | null;
}

export interface SubredditVerdict {
  ready: boolean;
  compromised: boolean;
  inconclusive: boolean;
  doneCount: number;
  errorCount: number;
  pendingCount: number;
  botLeaningCount: number;
  total: number;
  samples: SubredditSample[];
}

export function subredditDeriveVerdict(
  record: Pick<SubredditReport, "sampledUsernames">,
  reports: Record<string, Report>
): SubredditVerdict {
  const samples: SubredditSample[] = [];
  let doneCount = 0;
  let errorCount = 0;
  let pendingCount = 0;
  let botLeaningCount = 0;

  for (const username of record.sampledUsernames) {
    const key = findReportKey(reports, username);
    const report = key ? reports[key] : undefined;
    const investigation = report?.investigation ?? null;

    if (!investigation) {
      pendingCount++;
      samples.push({ username, status: "missing", verdict: null });
      continue;
    }

    if (investigation.status === "done") {
      doneCount++;
      const verdict = investigation.results.verdict;
      if (BOT_LEANING_VERDICTS.has(verdict)) {
        botLeaningCount++;
      }

      samples.push({ username, status: "done", verdict });
      continue;
    }

    if (investigation.status === "error") {
      errorCount++;
      samples.push({ username, status: "error", verdict: null });
      continue;
    }

    pendingCount++;
    samples.push({
      username,
      status: investigation.status,
      verdict: null,
    });
  }

  const total = record.sampledUsernames.length;
  const ready = pendingCount === 0;
  const inconclusive = ready && doneCount === 0;
  const compromised =
    doneCount > 0 && botLeaningCount / doneCount >= COMPROMISED_FRACTION;

  return {
    ready,
    compromised,
    inconclusive,
    doneCount,
    errorCount,
    pendingCount,
    botLeaningCount,
    total,
    samples,
  };
}
