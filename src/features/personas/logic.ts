// Pure barycentric projection of archetype vectors into 2D. No DOM, no I/O.
//
// Each archetype gets an anchor on the unit circle (top = first archetype,
// walking clockwise to mirror the persona radar). A user's point is the
// weighted sum of those anchors, weights = their archetype scores: a single
// archetype scoring 1.0 lands exactly on its anchor, a balanced spread of
// scores cancels symmetrically toward the origin. "How far from center"
// reads as "how concentrated this account is on one persona flavor."

import { ARCHETYPES, ARCHETYPE_KEYS } from "../../factors.ts";
import { personaHue } from "../../utils/persona_color.ts";
import type { ArchetypeKey, Persona, Report } from "../../types.ts";

// Below this, the archetype score is incidental noise — Claude routinely
// dribbles 0.1–0.2 into off-axes when scoring. Anything under this floor
// doesn't deserve to be cited as an exemplar.
const EXEMPLAR_MIN_SCORE = 0.3;
const EXEMPLAR_LIMIT = 5;

export interface PersonaPoint {
  username: string;

  // Unit-disk coordinates: x, y ∈ [-1, 1]. (0, 0) = no archetype pull.
  x: number;
  y: number;

  // 0–1: how far from origin (max possible = 1 when one archetype is 1.0).
  magnitude: number;

  // Top archetype score (used to fade low-signal dots and pick the label).
  topArchetype: ArchetypeKey;
  topScore: number;

  // Persona-card hue — matches the radar / persona pill on the dossier.
  hue: number | null;

  // True when the operator has hand-rated this account.
  isUserRated: boolean;

  // Verbatim AI persona for tooltip / sidebar use.
  persona: Persona;

  // Investigation timestamp for chronological tiebreaks / future top-N caps.
  investigatedAt: number;
}

export interface ArchetypeAnchor {
  key: ArchetypeKey;
  label: string;
  hue: number;
  x: number;
  y: number;
}

export const PERSONAS_ANCHORS: readonly ArchetypeAnchor[] = ARCHETYPES.map(
  (archetype, i) => {
    const step = (Math.PI * 2) / ARCHETYPES.length;
    const theta = -Math.PI / 2 + i * step;
    return {
      key: archetype.key,
      label: archetype.label,
      hue: archetype.hue,
      x: Math.cos(theta),
      y: Math.sin(theta),
    };
  }
);

// Distance from center to the anchor polygon's boundary along `theta`, for a
// circumradius-1 polygon with a vertex at -π/2 (matching PERSONAS_ANCHORS). 1
// at a vertex, the apothem cos(π/N) at an edge midpoint. Used to clamp points
// to the hexagon's edge rather than the circumscribed circle, which bulges
// past the edges between vertices.
function anchorBoundaryRadius(theta: number): number {
  const sides = PERSONAS_ANCHORS.length;
  const step = (Math.PI * 2) / sides;
  const local = (((theta + Math.PI / 2) % step) + step) % step;
  return Math.cos(Math.PI / sides) / Math.cos(local - step / 2);
}

export type PersonasRow = Report & { username: string };

export function personasCollect(reports: PersonasRow[]): PersonaPoint[] {
  const points: PersonaPoint[] = [];

  for (const report of reports) {
    const investigation = report.investigation;
    if (investigation?.status !== "done") {
      continue;
    }

    const persona = investigation.results.persona;
    if (!persona?.archetypes) {
      continue;
    }

    const archetypes = persona.archetypes;

    let sumX = 0;
    let sumY = 0;
    let topKey: ArchetypeKey = PERSONAS_ANCHORS[0].key;
    let topScore = 0;

    for (const anchor of PERSONAS_ANCHORS) {
      const score = Math.max(0, Math.min(1, archetypes[anchor.key] || 0));
      sumX += score * anchor.x;
      sumY += score * anchor.y;

      if (score > topScore) {
        topScore = score;
        topKey = anchor.key;
      }
    }

    // Raw barycentric sum can overshoot the hexagon when two adjacent
    // archetypes both score high (Superfan 1.0 + Shill 1.0 reinforces in their
    // shared direction). Pin overshoots to the polygon edge — direction stays
    // meaningful, and a 50/50 adjacent blend lands on the edge connecting the
    // two vertices instead of bulging out onto the circumscribed circle.
    const rawMagnitude = Math.sqrt(sumX * sumX + sumY * sumY);
    let x = sumX;
    let y = sumY;
    let magnitude = rawMagnitude;
    const maxRadius = anchorBoundaryRadius(Math.atan2(sumY, sumX));
    if (magnitude > maxRadius) {
      x *= maxRadius / magnitude;
      y *= maxRadius / magnitude;
      magnitude = maxRadius;
    }

    points.push({
      username: report.username,
      x,
      y,
      magnitude,
      topArchetype: topKey,
      topScore,
      hue: personaHue(persona),
      isUserRated: (report.userNotes?.ratings.length ?? 0) > 0,
      persona,
      investigatedAt: investigation.results.runAt,
    });
  }

  return points;
}

export interface PersonaExemplar {
  username: string;
  score: number;
}

export type PersonaExemplars = Record<ArchetypeKey, PersonaExemplar[]>;

// For each archetype, return the top-N investigated accounts by raw score
// on *that specific axis* (not by top-archetype). A user with 0.7 superfan AND
// 0.65 shill is a legitimate exemplar of both lists — the radar plots
// independent axes, so the exemplars do too.
export function personasExemplars(points: PersonaPoint[]): PersonaExemplars {
  const buckets = {} as PersonaExemplars;

  for (const key of ARCHETYPE_KEYS) {
    buckets[key] = [];
  }

  for (const archetype of ARCHETYPES) {
    const ranked: PersonaExemplar[] = [];

    for (const point of points) {
      const score = point.persona.archetypes?.[archetype.key] ?? 0;
      if (score >= EXEMPLAR_MIN_SCORE) {
        ranked.push({ username: point.username, score });
      }
    }

    ranked.sort((a, b) => b.score - a.score);
    buckets[archetype.key] = ranked.slice(0, EXEMPLAR_LIMIT);
  }

  return buckets;
}
