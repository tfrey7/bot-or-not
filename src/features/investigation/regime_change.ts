// Deterministic account-handoff gate, applied after the LLM and
// deterministic factors merge. When an established account's recent
// posting rate is many-fold above its lifetime baseline, the text-reading
// factors are scoring the *previous* operator — a long human history is
// exactly what a bought account ships with. The gate (a) overrides
// dormant_account_revival with a regime-change score strong enough to
// red-flag, and (b) caps the confidence of human-leaning stylometric
// factors so accumulated style can't outvote the structural anomaly.
// Runs in TS because repeated fixture iterations showed the LLM won't do
// this comparative arithmetic reliably — "trust structure over style" is
// unenforceable from inside a prompt.

import type { Factor, HourHistograms, ProfileSummary } from "../../types.ts";

const RATE_RAMP_MULTIPLIER = 5;
const RATE_RAMP_MIN_RECENT_PER_DAY = 2;

// Below this the account is young enough that Pattern A / A′ machinery
// owns the burst; the handoff read only makes sense against a real baseline.
const RATE_RAMP_MIN_WINDOW_DAYS = 90;

const STYLE_CONFIDENCE_CAP = 0.25;

// A shifted active clock coincident with the ramp corroborates new hands;
// below the event minimum a window's circular mean is noise.
const HOUR_SHIFT_CORROBORATION_HOURS = 3;
const HOUR_SHIFT_MIN_EVENTS = 30;

const STYLE_FACTOR_KEYS = new Set([
  "llm_content_style",
  "engagement_patterns",
  "topical_drift",
]);

interface RegimeChange {
  rateRatio: number;
  recentPerDay: number;
  lifetimePerDay: number;
  hourShiftHours: number | null;
}

function circularMeanHour(histogram: number[]): number | null {
  let total = 0;
  let sinSum = 0;
  let cosSum = 0;

  for (let hour = 0; hour < 24; hour++) {
    const count = histogram[hour];
    const angle = (2 * Math.PI * hour) / 24;
    total += count;
    sinSum += count * Math.sin(angle);
    cosSum += count * Math.cos(angle);
  }

  if (total < HOUR_SHIFT_MIN_EVENTS) {
    return null;
  }

  return ((Math.atan2(sinSum, cosSum) * 24) / (2 * Math.PI) + 24) % 24;
}

function hourWindowShift(histograms: HourHistograms | null): number | null {
  if (!histograms) {
    return null;
  }

  const recentMean = circularMeanHour(histograms.recent);
  const priorMean = circularMeanHour(histograms.prior);

  if (recentMean === null || priorMean === null) {
    return null;
  }

  const difference = Math.abs(recentMean - priorMean);
  return Math.min(difference, 24 - difference);
}

function detectRegimeChange(summary: ProfileSummary): RegimeChange | null {
  const rate = summary.activity.posting_rate;

  if (!rate) {
    return null;
  }

  if (rate.visible_window_days < RATE_RAMP_MIN_WINDOW_DAYS) {
    return null;
  }

  if (rate.recent_items_per_day < RATE_RAMP_MIN_RECENT_PER_DAY) {
    return null;
  }

  const rateRatio =
    rate.recent_items_per_day / Math.max(rate.visible_items_per_day, 0.01);

  if (rateRatio < RATE_RAMP_MULTIPLIER) {
    return null;
  }

  return {
    rateRatio,
    recentPerDay: rate.recent_items_per_day,
    lifetimePerDay: rate.visible_items_per_day,
    hourShiftHours: hourWindowShift(summary.activity.hour_histograms_utc),
  };
}

export function applyRegimeChangeGate(
  factors: Factor[],
  summary: ProfileSummary
): Factor[] {
  const regimeChange = detectRegimeChange(summary);

  if (!regimeChange) {
    return factors;
  }

  const shifted =
    regimeChange.hourShiftHours !== null &&
    regimeChange.hourShiftHours >= HOUR_SHIFT_CORROBORATION_HOURS;
  const ratioLabel = `${Math.round(regimeChange.rateRatio)}×`;

  const evidence = [
    `posting_rate: recent ${regimeChange.recentPerDay}/day vs lifetime ${regimeChange.lifetimePerDay}/day (${ratioLabel})`,
  ];

  if (regimeChange.hourShiftHours !== null) {
    evidence.push(
      `active-hour circular mean shifted ${regimeChange.hourShiftHours.toFixed(1)}h in the recent window`
    );
  }

  return factors.map((factor) => {
    if (factor.key === "dormant_account_revival") {
      return {
        key: "dormant_account_revival",
        score: -0.65,
        confidence: shifted ? 0.85 : 0.7,
        reasoning: shifted
          ? `Recent rate is ${ratioLabel} the lifetime baseline AND the active clock shifted — regime change consistent with a handoff.`
          : `Recent rate is ${ratioLabel} the lifetime baseline on an established account — regime change consistent with a handoff.`,
        evidence,
      };
    }

    if (
      STYLE_FACTOR_KEYS.has(factor.key) &&
      factor.score > 0 &&
      factor.confidence > STYLE_CONFIDENCE_CAP
    ) {
      return {
        ...factor,
        confidence: STYLE_CONFIDENCE_CAP,
        reasoning: `${factor.reasoning} [confidence capped — the history this reads predates the rate regime change]`,
      };
    }

    return factor;
  });
}
