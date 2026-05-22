// Day-tick formatter for the daily-bucketed analytics charts.
// uplot hands us a tick value in seconds (epoch); we format as M/D using
// the user's local timezone — matches how the data was bucketed.

export function formatDayTick(secondsEpoch: number): string {
  const d = new Date(secondsEpoch * 1000);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
