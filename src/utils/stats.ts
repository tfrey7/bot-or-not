// Pure numeric helpers.

// Caller must pre-sort `sortedArr`. p is in [0, 1].
export function bonPercentile(sortedArr: number[], p: number): number {
  if (!sortedArr.length) {
    return 0;
  }
  const idx = Math.min(sortedArr.length - 1, Math.floor(sortedArr.length * p));
  return sortedArr[idx];
}
