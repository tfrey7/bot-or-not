// Number/currency/percent formatters. Pure.

export function fmtUsd(value: number | null | undefined): string {
  if (value == null || !isFinite(value)) {
    return "—";
  }

  if (value === 0) {
    return "$0";
  }

  if (value >= 100) {
    return `$${value.toFixed(2)}`;
  }

  if (value >= 10) {
    return `$${value.toFixed(2)}`;
  }

  if (value >= 1) {
    return `$${value.toFixed(3)}`;
  }

  if (value >= 0.01) {
    return `$${value.toFixed(4)}`;
  }

  if (value >= 0.0001) {
    return `$${value.toFixed(5)}`;
  }

  return `<$0.0001`;
}

export function fmtThousands(value: number | null | undefined): string {
  if (value == null || !isFinite(value)) {
    return "—";
  }

  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }

  if (value >= 10_000) {
    return `${(value / 1_000).toFixed(0)}k`;
  }

  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}k`;
  }

  return String(Math.round(value));
}

export function fmtNum(value: number | null | undefined, digits = 0): string {
  if (value == null || !isFinite(value)) {
    return "—";
  }

  return value.toFixed(digits);
}

export function fmtPercent(
  value: number | null | undefined,
  digits = 0
): string {
  if (value == null || !isFinite(value)) {
    return "—";
  }

  return `${(value * 100).toFixed(digits)}%`;
}
