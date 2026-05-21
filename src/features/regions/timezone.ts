// Timezone band → region label. Coarse signal (UTC offset = longitude band,
// not a country), used as a tie-breaker bonus on regions already nominated
// by stronger signals — never as a primary input. See the comment in
// index.ts for why this is intentional.

export interface TzInferred {
  kind: "inferred";
  offsetHours: number;
}

export interface TimezoneOnlyRegionInference {
  kind: "timezone-only";
  offsetHours: number;
  possibleRegions: string[];
}

// Coarse UTC-offset → region-band label for the inferred-timezone strip.
// Returns "" for offsets outside the commonly-populated bands.
export function bonRegionForOffset(offset: number): string {
  if (offset === 0) {
    return "UK, Portugal, West Africa";
  }

  if (offset === 1) {
    return "Western/Central Europe";
  }

  if (offset === 2) {
    return "Eastern Europe, South Africa";
  }

  if (offset === 3) {
    return "Moscow, Eastern Europe, East Africa";
  }

  if (offset === 4) {
    return "Gulf, Caucasus";
  }

  if (offset === 5) {
    return "Pakistan, West Asia";
  }

  if (offset === 6) {
    return "India, Bangladesh";
  }

  if (offset === 7) {
    return "Thailand, Vietnam, Indonesia";
  }

  if (offset === 8) {
    return "China, Singapore, Philippines";
  }

  if (offset === 9) {
    return "Japan, Korea";
  }

  if (offset === 10) {
    return "Eastern Australia";
  }

  if (offset === 11) {
    return "Solomon Islands";
  }

  if (offset === 12) {
    return "New Zealand";
  }

  if (offset === -1) {
    return "Azores, Cape Verde";
  }

  if (offset === -2) {
    return "Mid-Atlantic";
  }

  if (offset === -3) {
    return "Brazil, Argentina";
  }

  if (offset === -4) {
    return "Atlantic, Eastern Caribbean";
  }

  if (offset === -5) {
    return "US Eastern, Colombia, Peru";
  }

  if (offset === -6) {
    return "US Central, Mexico";
  }

  if (offset === -7) {
    return "US Mountain";
  }

  if (offset === -8) {
    return "US Pacific";
  }

  if (offset === -9) {
    return "Alaska";
  }

  if (offset === -10) {
    return "Hawaii";
  }

  return "";
}
