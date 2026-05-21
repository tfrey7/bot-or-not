import { BON_ARCHETYPES } from "../../factors.ts";
import type { ArchetypeKey, PersonaLabel } from "../../types.ts";
import { bonFormatDate } from "../../utils/format_time.ts";
import { bonFormatVerdict } from "../../utils/format_text.ts";
import {
  bonSelfImprovementAgreement,
  type AgreementState,
  type AnnotatedReport,
} from "./logic.ts";

const ARCHETYPE_LABEL_MAP: Record<string, string> = Object.fromEntries(
  BON_ARCHETYPES.map((archetype) => [archetype.key, archetype.label])
);

const EXTRA_LABEL_MAP: Record<string, string> = {
  bot: "Bot",
  normal: "Normal",
};

const AGREEMENT_LABEL: Record<AgreementState, string> = {
  agree: "Agree",
  disagree: "Disagree",
  "no-ai-pick": "No AI pick",
  "no-rating": "Note only",
};

export function bonSelfImprovementRow(
  annotated: AnnotatedReport
): HTMLDivElement {
  const { username, report, userNotes } = annotated;
  const investigation = report.investigation;
  const results =
    investigation?.status === "done" ? investigation.results : null;
  const persona = results?.persona ?? null;
  const agreement = bonSelfImprovementAgreement(annotated);

  const card = document.createElement("article");
  card.className = `bon-self-improvement-row bon-self-improvement-row--${agreement}`;
  card.dataset.bonUsername = username;

  card.appendChild(buildHeader(username, userNotes.updatedAt, agreement));

  const grid = document.createElement("div");
  grid.className = "bon-self-improvement-grid";
  grid.appendChild(buildSideYou(userNotes.ratings, userNotes.note));
  grid.appendChild(
    buildSideAi(
      persona?.label ?? null,
      persona?.reasoning ?? "",
      persona?.archetypes ?? null,
      results?.verdict ?? null,
      results?.summary ?? ""
    )
  );
  card.appendChild(grid);

  return card as unknown as HTMLDivElement;
}

function buildHeader(
  username: string,
  updatedAt: number,
  agreement: AgreementState
): HTMLElement {
  const header = document.createElement("header");
  header.className = "bon-self-improvement-row__header";

  const userLink = document.createElement("a");
  userLink.className = "bon-self-improvement-row__user";
  userLink.href = `?user=${encodeURIComponent(username)}`;
  userLink.textContent = `u/${username}`;
  userLink.title = "Open in the Reports tab";
  header.appendChild(userLink);

  const tag = document.createElement("span");
  tag.className = `bon-self-improvement-tag bon-self-improvement-tag--${agreement}`;
  tag.textContent = AGREEMENT_LABEL[agreement];
  header.appendChild(tag);

  if (updatedAt > 0) {
    const time = document.createElement("time");
    time.className = "bon-self-improvement-row__time";
    time.dateTime = new Date(updatedAt).toISOString();
    time.textContent = `noted ${bonFormatDate(updatedAt)}`;
    header.appendChild(time);
  }

  return header;
}

function buildSideYou(ratings: PersonaLabel[], note: string): HTMLElement {
  const side = document.createElement("section");
  side.className = "bon-self-improvement-side bon-self-improvement-side--you";

  const title = document.createElement("p");
  title.className = "bon-self-improvement-side__title";
  title.textContent = "Your call";
  side.appendChild(title);

  if (ratings.length === 0) {
    side.appendChild(buildPersonaChip(null, "no call"));
  } else {
    const chipRow = document.createElement("div");
    chipRow.className = "bon-self-improvement-pickrow";

    for (const rating of ratings) {
      chipRow.appendChild(buildPersonaChip(rating, "no call"));
    }

    side.appendChild(chipRow);
  }

  const noteText = note.trim();
  if (noteText) {
    const noteEl = document.createElement("p");
    noteEl.className = "bon-self-improvement-note";
    noteEl.textContent = noteText;
    side.appendChild(noteEl);
  }

  return side;
}

function buildSideAi(
  label: PersonaLabel | null,
  reasoning: string,
  archetypes: Record<ArchetypeKey, number> | null,
  verdict: string | null,
  summary: string
): HTMLElement {
  const side = document.createElement("section");
  side.className = "bon-self-improvement-side bon-self-improvement-side--ai";

  const title = document.createElement("p");
  title.className = "bon-self-improvement-side__title";
  title.textContent = "AI's call";
  side.appendChild(title);

  const pickRow = document.createElement("div");
  pickRow.className = "bon-self-improvement-pickrow";
  pickRow.appendChild(buildPersonaChip(label, "no investigation"));

  if (verdict) {
    const verdictPill = document.createElement("span");
    verdictPill.className = `bon-self-improvement-verdict bon-self-improvement-verdict--${verdict}`;
    verdictPill.textContent = bonFormatVerdict(verdict);
    pickRow.appendChild(verdictPill);
  }

  side.appendChild(pickRow);

  const topArchetypes = pickTopArchetypes(archetypes, label, 2);
  if (topArchetypes.length > 0) {
    const radar = document.createElement("ul");
    radar.className = "bon-self-improvement-radar";

    for (const { key, strength } of topArchetypes) {
      const item = document.createElement("li");
      item.className = "bon-self-improvement-radar__item";

      const dot = document.createElement("span");
      dot.className = "bon-self-improvement-radar__dot";
      dot.style.background = archetypeColor(key);
      item.appendChild(dot);

      const text = document.createElement("span");
      text.className = "bon-self-improvement-radar__label";
      text.textContent = `${ARCHETYPE_LABEL_MAP[key]} ${strength.toFixed(2)}`;
      item.appendChild(text);

      radar.appendChild(item);
    }

    side.appendChild(radar);
  }

  if (reasoning) {
    const reasoningEl = document.createElement("p");
    reasoningEl.className = "bon-self-improvement-reasoning";
    reasoningEl.textContent = reasoning;
    side.appendChild(reasoningEl);
  }

  if (summary && summary !== reasoning) {
    const summaryEl = document.createElement("p");
    summaryEl.className =
      "bon-self-improvement-reasoning bon-self-improvement-reasoning--summary";
    summaryEl.textContent = summary;
    side.appendChild(summaryEl);
  }

  return side;
}

function buildPersonaChip(
  value: PersonaLabel | null,
  emptyText: string
): HTMLElement {
  const chip = document.createElement("span");
  const key = value ?? "empty";
  chip.className = `bon-self-improvement-chip bon-self-improvement-chip--${key}`;

  const stripe = document.createElement("span");
  stripe.className = "bon-self-improvement-chip__stripe";
  if (value && value !== "bot" && value !== "normal") {
    stripe.style.background = archetypeColor(value);
  }

  chip.appendChild(stripe);

  const labelEl = document.createElement("span");
  labelEl.className = "bon-self-improvement-chip__label";
  labelEl.textContent = value
    ? ARCHETYPE_LABEL_MAP[value] || EXTRA_LABEL_MAP[value] || value
    : `— ${emptyText} —`;
  chip.appendChild(labelEl);

  return chip;
}

function pickTopArchetypes(
  archetypes: Record<ArchetypeKey, number> | null,
  label: PersonaLabel | null,
  limit: number
): { key: ArchetypeKey; strength: number }[] {
  if (!archetypes) {
    return [];
  }

  const entries = (Object.entries(archetypes) as [ArchetypeKey, number][])
    .filter(([, strength]) => strength > 0)
    .sort((a, b) => b[1] - a[1]);

  const picked: { key: ArchetypeKey; strength: number }[] = [];
  const seen = new Set<ArchetypeKey>();

  // Surface the AI's picked label first if it has a radar strength, then fill
  // with whatever else stood out — this is how `feedback_stan_plus_hustler`
  // becomes visible at a glance: stan listed plus the next-strongest spoke.
  if (label && label !== "bot" && label !== "normal") {
    const archetypeLabel = label as ArchetypeKey;
    const strength = archetypes[archetypeLabel] ?? 0;
    if (strength > 0) {
      picked.push({ key: archetypeLabel, strength });
      seen.add(archetypeLabel);
    }
  }

  for (const [key, strength] of entries) {
    if (picked.length >= limit) {
      break;
    }

    if (seen.has(key)) {
      continue;
    }

    picked.push({ key, strength });
    seen.add(key);
  }

  return picked;
}

function archetypeColor(key: ArchetypeKey | PersonaLabel): string {
  const archetype = BON_ARCHETYPES.find((entry) => entry.key === key);
  if (!archetype) {
    return "var(--bon-border)";
  }

  return `hsl(${archetype.hue} 60% 50%)`;
}
