// TF-IDF cosine similarity over per-account subreddit attention.
// Coordinated accounts share where they post even when their writing
// styles differ, so overlapping attention vectors surface ring candidates
// no single-account factor can see. Mirrors the notion of "attention
// fingerprint" the Databricks subreddit_fingerprints gold table uses.

import type { Report } from "../../types.ts";

export interface RingCandidate {
  username: string;
  similarity: number;
  sharedSubs: string[];
}

const MIN_SHARED_SUBS = 3;
const MIN_SIMILARITY = 0.3;
const MAX_CANDIDATES = 5;
const MAX_SHARED_SUBS_SHOWN = 5;

export function ringDetectionRankCandidates(
  targetKey: string,
  reports: Record<string, Report>
): RingCandidate[] {
  const countsByUser = new Map<string, Record<string, number>>();

  for (const [username, report] of Object.entries(reports)) {
    const subCounts = report.activityData?.subredditCounts;
    if (subCounts && Object.keys(subCounts).length > 0) {
      countsByUser.set(username, subCounts);
    }
  }

  const targetCounts = countsByUser.get(targetKey);
  if (!targetCounts) {
    return [];
  }

  const documentFrequency = new Map<string, number>();

  for (const subCounts of countsByUser.values()) {
    for (const sub of Object.keys(subCounts)) {
      documentFrequency.set(sub, (documentFrequency.get(sub) ?? 0) + 1);
    }
  }

  const userCount = countsByUser.size;
  const idf = (sub: string): number =>
    Math.log(1 + userCount / (documentFrequency.get(sub) ?? 1));

  const vectorize = (
    subCounts: Record<string, number>
  ): Map<string, number> => {
    let total = 0;

    for (const count of Object.values(subCounts)) {
      total += count;
    }

    const vector = new Map<string, number>();

    for (const [sub, count] of Object.entries(subCounts)) {
      vector.set(sub, (count / total) * idf(sub));
    }

    return vector;
  };

  const norm = (vector: Map<string, number>): number => {
    let sum = 0;

    for (const weight of vector.values()) {
      sum += weight * weight;
    }

    return Math.sqrt(sum);
  };

  const targetVector = vectorize(targetCounts);
  const targetNorm = norm(targetVector);
  if (targetNorm === 0) {
    return [];
  }

  const candidates: RingCandidate[] = [];

  for (const [username, subCounts] of countsByUser) {
    if (username === targetKey) {
      continue;
    }

    const vector = vectorize(subCounts);
    const contributions: { sub: string; product: number }[] = [];
    let dot = 0;

    for (const [sub, weight] of vector) {
      const targetWeight = targetVector.get(sub);
      if (targetWeight === undefined) {
        continue;
      }

      const product = weight * targetWeight;
      dot += product;
      contributions.push({ sub, product });
    }

    if (contributions.length < MIN_SHARED_SUBS) {
      continue;
    }

    const candidateNorm = norm(vector);
    if (candidateNorm === 0) {
      continue;
    }

    const similarity = dot / (targetNorm * candidateNorm);
    if (similarity < MIN_SIMILARITY) {
      continue;
    }

    contributions.sort((a, b) => b.product - a.product);

    candidates.push({
      username,
      similarity,
      sharedSubs: contributions
        .slice(0, MAX_SHARED_SUBS_SHOWN)
        .map((entry) => entry.sub),
    });
  }

  candidates.sort((a, b) => b.similarity - a.similarity);
  return candidates.slice(0, MAX_CANDIDATES);
}
