// Number/currency/percent formatters. Pure.

export function bonFmtUsd(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) {
    return "—";
  }
  if (n === 0) {
    return "$0";
  }
  if (n >= 100) {
    return `$${n.toFixed(2)}`;
  }
  if (n >= 10) {
    return `$${n.toFixed(2)}`;
  }
  if (n >= 1) {
    return `$${n.toFixed(3)}`;
  }
  if (n >= 0.01) {
    return `$${n.toFixed(4)}`;
  }
  if (n >= 0.0001) {
    return `$${n.toFixed(5)}`;
  }
  return `<$0.0001`;
}

export function bonFmtThousands(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) {
    return "—";
  }
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(1)}M`;
  }
  if (n >= 10_000) {
    return `${(n / 1_000).toFixed(0)}k`;
  }
  if (n >= 1_000) {
    return `${(n / 1_000).toFixed(1)}k`;
  }
  return String(Math.round(n));
}

export function bonFmtNum(n: number | null | undefined, digits = 0): string {
  if (n == null || !isFinite(n)) {
    return "—";
  }
  return n.toFixed(digits);
}

export function bonFmtPercent(
  n: number | null | undefined,
  digits = 0
): string {
  if (n == null || !isFinite(n)) {
    return "—";
  }
  return `${(n * 100).toFixed(digits)}%`;
}
