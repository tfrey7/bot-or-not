# Ideas

- [ ] **Rework region inference.** Currently it's driven by history/timeline-based metrics — that's wrong. Should use the normal analysis plus context instead.
- [ ] **Account Age vs Activity metric misreads the API cap.** We're capped at a few hundred comments, so the gap between account creation and the oldest visible post gets misinterpreted as dormancy when it isn't. If we've hit the cap, that metric isn't usable — except as a "they posted a fuck ton" signal.
- [ ] **Reports table "time taken" column width jitters.** The column subtly grows/shrinks as the live duration value re-renders. Want that column's width static (the value can keep updating).
- [ ] **Declutter the timeline heatmap.** Too many extra labels/warnings around it. Also consider showing both timelines side by side somehow.
- [ ] **Rethink per-criterion cards on the reports page.** The little card-per-factor sections could use a better visualization. Like the summary/evidence split — consider defaulting to summaries only and making evidence a drill-in. If evidence becomes drill-in, we can afford to gather more of it.
- [ ] **More graphics, lean into the style.** Want more visual personality throughout — stylize tables and other chrome to match the noir aesthetic.
- [ ] **Profile-injected summary block looks worse than the rest of the app.** Question how often it actually gets used. Consider replacing it with a much briefer summary + a link to the user's row in the reports table.
- [ ] **Expand the Persona taxonomy.** More types exist — e.g. "Serial Question Asker" (likely human, but constantly posts high-engagement questions). As personas multiply, the spider graph stops being the right visualization — need to rethink the chart type.
- [ ] **Long-running requests terminated early (bug).** Unclear whether it's a fetch limitation, an extension/service-worker timeout, or the upstream API.
