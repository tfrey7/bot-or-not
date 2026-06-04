// Field guide tab: editorial "history book" entries describing each persona.
// Each entry is a medallion with the body copy wrapping around it, a drop-cap
// opener, an identify list, and the known specimens (top exemplars). The book
// feel comes from layout — type stays within the page's sans/mono scopes since
// the serif is masthead-only.

import type { Report } from "../../types.ts";
import { ARCHETYPES, type ArchetypeMeta } from "../../factors.ts";
import {
  FIELD_GUIDE_ENTRIES,
  type FieldGuideEntry,
} from "./field_guide_data.ts";
import {
  personasCollect,
  personasExemplars,
  type PersonaExemplar,
  type PersonasRow,
} from "./logic.ts";
import { PERSONA_MEDALLIONS } from "./medallions.ts";

export interface RenderFieldGuideOptions {
  onSelectUser: (username: string) => void;
}

export function renderFieldGuideTab(
  reports: Array<Report & { username: string }>,
  container: HTMLElement | null,
  options: RenderFieldGuideOptions
): void {
  if (!container) {
    return;
  }

  container.replaceChildren();

  const exemplars = personasExemplars(
    personasCollect(reports as PersonasRow[])
  );

  const entries = ARCHETYPES.map((archetype) => ({
    archetype,
    entry: FIELD_GUIDE_ENTRIES[archetype.key],
  })).filter(
    (pair): pair is { archetype: ArchetypeMeta; entry: FieldGuideEntry } =>
      pair.entry !== undefined
  );

  const section = document.createElement("section");
  section.className = "bon-personas-field-guide";

  const header = document.createElement("header");
  header.className = "bon-field-guide-masthead";

  const heading = document.createElement("h2");
  heading.className = "bon-field-guide-page-title";
  heading.textContent = "Field guide";
  header.appendChild(heading);

  const intro = document.createElement("p");
  intro.className = "bon-field-guide-lede";
  intro.textContent =
    "The kinds of accounts you'll meet on Reddit — what drives them, how to spot them, and who to read for the type.";
  header.appendChild(intro);

  section.appendChild(header);

  for (const { archetype, entry } of entries) {
    const archetypeExemplars = exemplars[archetype.key] ?? [];
    section.appendChild(
      buildEntry(archetype, entry, archetypeExemplars, options.onSelectUser)
    );
  }

  container.appendChild(section);
}

function buildEntry(
  archetype: ArchetypeMeta,
  entry: FieldGuideEntry,
  exemplars: ReadonlyArray<PersonaExemplar>,
  onSelectUser: (username: string) => void
): HTMLElement {
  const article = document.createElement("article");
  article.className = "bon-field-guide-entry";
  article.style.setProperty("--bon-archetype-hue", String(archetype.hue));

  const title = document.createElement("h3");
  title.className = "bon-field-guide-title";
  title.textContent = `The ${archetype.label}`;
  article.appendChild(title);

  const epigraph = document.createElement("p");
  epigraph.className = "bon-field-guide-epigraph";
  epigraph.textContent = entry.epigraph;
  article.appendChild(epigraph);

  // Floated before the body in source so the copy wraps around its right edge.
  const medallion = document.createElement("figure");
  medallion.className = "bon-field-guide-medallion";
  const image = document.createElement("img");
  image.src = PERSONA_MEDALLIONS[archetype.key];
  image.alt = "";
  medallion.appendChild(image);
  article.appendChild(medallion);

  const body = document.createElement("p");
  body.className = "bon-field-guide-body";
  body.textContent = entry.body;
  article.appendChild(body);

  article.appendChild(buildSubhead("How to identify them"));

  const tells = document.createElement("ul");
  tells.className = "bon-field-guide-tells";

  for (const tell of entry.tells) {
    const item = document.createElement("li");
    item.textContent = tell;
    tells.appendChild(item);
  }

  article.appendChild(tells);

  article.appendChild(buildSubhead("Where they gather"));
  article.appendChild(buildSubreddits(entry.subreddits));

  article.appendChild(buildSubhead("In their own words"));
  article.appendChild(buildSamples(entry.samples));

  if (exemplars.length > 0) {
    article.appendChild(buildSubhead("Known specimens"));
    article.appendChild(buildSpecimens(exemplars, onSelectUser));
  }

  return article;
}

function buildSubreddits(subreddits: ReadonlyArray<string>): HTMLElement {
  const wrap = document.createElement("p");
  wrap.className = "bon-field-guide-habitat";

  subreddits.forEach((subreddit, i) => {
    if (i > 0) {
      wrap.appendChild(document.createTextNode(" · "));
    }

    const token = document.createElement("span");
    token.className = "bon-field-guide-sub";
    token.textContent = `r/${subreddit}`;
    wrap.appendChild(token);
  });

  return wrap;
}

function buildSamples(samples: ReadonlyArray<string>): HTMLElement {
  const list = document.createElement("div");
  list.className = "bon-field-guide-samples";

  for (const sample of samples) {
    const quote = document.createElement("blockquote");
    quote.className = "bon-field-guide-sample";
    quote.textContent = sample;
    list.appendChild(quote);
  }

  return list;
}

function buildSubhead(text: string): HTMLElement {
  const subhead = document.createElement("h4");
  subhead.className = "bon-field-guide-subhead";
  subhead.textContent = text;

  return subhead;
}

function buildSpecimens(
  exemplars: ReadonlyArray<PersonaExemplar>,
  onSelectUser: (username: string) => void
): HTMLElement {
  const wrap = document.createElement("p");
  wrap.className = "bon-field-guide-specimens";

  exemplars.forEach((exemplar, i) => {
    if (i > 0) {
      wrap.appendChild(document.createTextNode(" · "));
    }

    const link = document.createElement("button");
    link.type = "button";
    link.className = "bon-field-guide-specimen bon-pii-name";
    link.textContent = `u/${exemplar.username}`;
    link.title = `${Math.round(exemplar.score * 100)}% — open dossier`;
    link.addEventListener("click", () => onSelectUser(exemplar.username));
    wrap.appendChild(link);
  });

  return wrap;
}
