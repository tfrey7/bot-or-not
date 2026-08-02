// "Similar accounts" dossier section: reported accounts whose subreddit
// attention overlaps the selected user's — ring candidates the operator
// can inspect and link. Data arrives async from the background ranker;
// the section renders a quiet placeholder until it lands.

import { clientSend } from "../../client.ts";
import type { Verdict } from "../../types.ts";
import { formatVerdict } from "../../utils/format_text.ts";
import { buildRingChip } from "../../utils/ring_chip.ts";
import type { RingCandidateSummary } from "./handlers.ts";

export function ringDetectionSimilarAccountsSection(
  username: string,
  ringId: string | null
): HTMLDivElement {
  const wrap = document.createElement("div");
  wrap.className = "bon-detail-wrap bon-similar-accounts";

  const title = document.createElement("p");
  title.className = "bon-detail-title";
  title.textContent = "Similar accounts";
  wrap.appendChild(title);

  const body = document.createElement("div");
  body.className = "bon-similar-accounts__body";
  body.textContent = "Comparing subreddit fingerprints…";
  wrap.appendChild(body);

  void (async () => {
    const { candidates } = await clientSend<{
      candidates: RingCandidateSummary[];
    }>({ type: "get-ring-candidates", username });

    renderCandidates(body, username, ringId, candidates);
  })();

  return wrap;
}

function renderCandidates(
  body: HTMLDivElement,
  username: string,
  ringId: string | null,
  candidates: RingCandidateSummary[]
): void {
  body.textContent = "";

  if (candidates.length === 0) {
    const empty = document.createElement("p");
    empty.className = "bon-similar-accounts__empty";
    empty.textContent =
      "No reported account shares this user's subreddit fingerprint.";
    body.appendChild(empty);
    return;
  }

  for (const candidate of candidates) {
    body.appendChild(buildCandidateRow(username, ringId, candidate));
  }
}

function buildCandidateRow(
  username: string,
  ringId: string | null,
  candidate: RingCandidateSummary
): HTMLDivElement {
  const row = document.createElement("div");
  row.className = "bon-similar-row";

  const head = document.createElement("div");
  head.className = "bon-similar-row__head";

  const link = document.createElement("a");
  link.className = "bon-similar-row__name bon-pii-name";
  link.href = `?user=${encodeURIComponent(candidate.username)}`;
  link.textContent = `u/${candidate.username}`;
  head.appendChild(link);

  const chip = buildRingChip(candidate.ringId);
  if (chip) {
    head.appendChild(chip);
  }

  if (candidate.userStatus) {
    const status = document.createElement("span");
    status.className = "bon-similar-row__status";
    status.textContent = candidate.userStatus;
    head.appendChild(status);
  }

  const meter = document.createElement("span");
  meter.className = "bon-similar-row__meter";
  meter.style.setProperty(
    "--bon-similarity",
    `${Math.round(candidate.similarity * 100)}%`
  );
  meter.title = `Attention overlap ${Math.round(candidate.similarity * 100)}%`;
  head.appendChild(meter);

  const pct = document.createElement("span");
  pct.className = "bon-similar-row__pct";
  pct.textContent = `${Math.round(candidate.similarity * 100)}%`;
  head.appendChild(pct);

  if (candidate.verdict) {
    const verdict = document.createElement("span");
    verdict.className = "bon-similar-row__verdict";
    verdict.textContent = formatVerdict(candidate.verdict as Verdict);
    head.appendChild(verdict);
  }

  const sameRing = ringId !== null && candidate.ringId === ringId;
  if (!sameRing) {
    head.appendChild(buildLinkButton(username, candidate.username));
  }

  row.appendChild(head);

  const subs = document.createElement("p");
  subs.className = "bon-similar-row__subs";
  subs.textContent = candidate.sharedSubs
    .map((sub) => `r/${sub}`)
    .join("  ·  ");
  row.appendChild(subs);

  return row;
}

function buildLinkButton(
  username: string,
  candidateUsername: string
): HTMLButtonElement {
  const button = document.createElement("button");
  button.className = "bon-similar-row__link-btn";
  button.textContent = "Link ring";
  button.title = `Link u/${username} and u/${candidateUsername} into a ring`;

  button.addEventListener("click", () => {
    button.disabled = true;
    void clientSend({
      type: "link-ring",
      usernames: [username, candidateUsername],
    });
  });

  return button;
}
