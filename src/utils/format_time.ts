// Time/date/duration formatters. Pure — same input always yields same output.

export function bonFmtDuration(ms: number | null | undefined): string {
  if (ms == null || !isFinite(ms)) {
    return "—";
  }
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }

  const s = ms / 1000;
  if (s < 60) {
    return `${s.toFixed(s < 10 ? 1 : 0)}s`;
  }

  const m = Math.floor(s / 60);
  const rem = Math.round(s % 60);
  if (m < 60) {
    return rem ? `${m}m ${rem}s` : `${m}m`;
  }

  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export function bonFormatDate(ts: number): string {
  const d = new Date(ts);
  const diffMs = Date.now() - ts;
  const min = 60_000;
  const hour = 60 * min;
  const day = 24 * hour;

  if (diffMs < min) {
    return "now";
  }
  if (diffMs < hour) {
    return `${Math.floor(diffMs / min)}m ago`;
  }
  if (diffMs < day) {
    return `${Math.floor(diffMs / hour)}h ago`;
  }
  if (diffMs < 7 * day) {
    return `${Math.floor(diffMs / day)}d ago`;
  }

  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, {
    year: sameYear ? undefined : "2-digit",
    month: "short",
    day: "numeric",
  });
}

// Like bonFormatDate but with terser relative units ("5m" vs "5m ago") for
// the in-feed panel where horizontal space is tight.
export function bonFormatPanelDate(ts: number): string {
  const diffMs = Date.now() - ts;
  const min = 60_000;
  const hour = 60 * min;
  const day = 24 * hour;

  if (diffMs < min) {
    return "now";
  }
  if (diffMs < hour) {
    return `${Math.floor(diffMs / min)}m`;
  }
  if (diffMs < day) {
    return `${Math.floor(diffMs / hour)}h`;
  }
  if (diffMs < 7 * day) {
    return `${Math.floor(diffMs / day)}d`;
  }

  const d = new Date(ts);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, {
    year: sameYear ? undefined : "2-digit",
    month: "short",
    day: "numeric",
  });
}

export function bonFmtTimestamp(ts: number): string {
  const d = new Date(ts);
  const date = d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
  const time = d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${date} ${time}`;
}

export function bonPad2(n: number): string {
  return String(n).padStart(2, "0");
}
