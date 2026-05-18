// Number/currency/percent formatters. Pure.

(function () {
  function bonFmtUsd(n) {
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

  function bonFmtThousands(n) {
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

  function bonFmtNum(n, digits = 0) {
    if (n == null || !isFinite(n)) {
      return "—";
    }
    return n.toFixed(digits);
  }

  function bonFmtPercent(n, digits = 0) {
    if (n == null || !isFinite(n)) {
      return "—";
    }
    return `${(n * 100).toFixed(digits)}%`;
  }

  globalThis.bonFmtUsd = bonFmtUsd;
  globalThis.bonFmtThousands = bonFmtThousands;
  globalThis.bonFmtNum = bonFmtNum;
  globalThis.bonFmtPercent = bonFmtPercent;
})();
