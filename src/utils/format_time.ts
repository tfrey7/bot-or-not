// Time/date/duration formatters. Pure — same input always yields same output.

export function bonFmtDuration(ms: number | null | undefined): string {
  if (ms == null || !isFinite(ms)) {
    return "—";
  }
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }

  const seconds = ms / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainderSeconds = Math.round(seconds % 60);
  if (minutes < 60) {
    return remainderSeconds
      ? `${minutes}m ${remainderSeconds}s`
      : `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

export function bonFormatDate(ts: number): string {
  const date = new Date(ts);
  const diffMs = Date.now() - ts;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diffMs < minute) {
    return "now";
  }
  if (diffMs < hour) {
    return `${Math.floor(diffMs / minute)}m ago`;
  }
  if (diffMs < day) {
    return `${Math.floor(diffMs / hour)}h ago`;
  }
  if (diffMs < 7 * day) {
    return `${Math.floor(diffMs / day)}d ago`;
  }

  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(undefined, {
    year: sameYear ? undefined : "2-digit",
    month: "short",
    day: "numeric",
  });
}

// Like bonFormatDate but with terser relative units ("5m" vs "5m ago") for
// the in-feed panel where horizontal space is tight.
export function bonFormatPanelDate(ts: number): string {
  const diffMs = Date.now() - ts;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diffMs < minute) {
    return "now";
  }
  if (diffMs < hour) {
    return `${Math.floor(diffMs / minute)}m`;
  }
  if (diffMs < day) {
    return `${Math.floor(diffMs / hour)}h`;
  }
  if (diffMs < 7 * day) {
    return `${Math.floor(diffMs / day)}d`;
  }

  const date = new Date(ts);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(undefined, {
    year: sameYear ? undefined : "2-digit",
    month: "short",
    day: "numeric",
  });
}

export function bonFmtTimestamp(ts: number): string {
  const date = new Date(ts);
  const dateStr = date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
  const timeStr = date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${dateStr} ${timeStr}`;
}

export function bonPad2(n: number): string {
  return String(n).padStart(2, "0");
}
