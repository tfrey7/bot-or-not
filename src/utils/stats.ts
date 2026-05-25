// Pure numeric helpers.

// Caller must pre-sort `sortedValues`. percentile is in [0, 1].
export function percentile(sortedValues: number[], percentile: number): number {
  if (!sortedValues.length) {
    return 0;
  }

  const index = Math.min(
    sortedValues.length - 1,
    Math.floor(sortedValues.length * percentile)
  );

  return sortedValues[index];
}
