// Pure numeric helpers.

(function () {
  // Caller must pre-sort `sortedArr`. p is in [0, 1].
  function bonPercentile(sortedArr, p) {
    if (!sortedArr.length) return 0;
    const idx = Math.min(
      sortedArr.length - 1,
      Math.floor(sortedArr.length * p)
    );
    return sortedArr[idx];
  }

  globalThis.bonPercentile = bonPercentile;
})();
