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
