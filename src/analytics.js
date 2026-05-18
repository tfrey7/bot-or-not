// Investigation analytics dashboard. Pure render over the reports object —
// pulls timing, token, and cost metadata off each stored investigation and
// renders summary cards, SVG charts, per-model breakdown, and top spenders.
//
// Loaded by reports.html after reports.js. Entry point:
//   bonRenderAnalytics(reports, containerEl) -> void
// The function wipes the container and rebuilds it. No storage I/O.

(function () {
  "use strict";

  const MS_PER_DAY = 86_400_000;
  const SVG_NS = "http://www.w3.org/2000/svg";

  // ---------- Public ----------

  function bonRenderAnalytics(reports, container) {
    if (!container) {
      return;
    }
    container.replaceChildren();

    const investigations = collectInvestigations(reports);
    const runs = investigations.filter((i) => i.status === "done");
    const errors = investigations.filter((i) => i.status === "error").length;

    const section = document.createElement("section");
    section.className = "bon-analytics";
    section.appendChild(buildHeader(runs.length, errors));

    if (!runs.length) {
      section.appendChild(buildEmptyState());
      container.appendChild(section);
      return;
    }

    const summary = summarize(runs);

    section.appendChild(buildStatGrid(summary));

    const charts = document.createElement("div");
    charts.className = "bon-analytics-charts";
    charts.appendChild(
      buildChartCard(
        "Cumulative spend",
        runs.length === 1
          ? `${bonFmtUsd(summary.totalCost)} on a single run`
          : `${bonFmtUsd(summary.totalCost)} across ${runs.length} investigations`,
        renderCumulativeCost(runs, summary)
      )
    );
    charts.appendChild(
      buildChartCard(
        "Investigations per day",
        `${summary.daysActive} active day${summary.daysActive === 1 ? "" : "s"} · ${bonFmtNum(summary.runsPerActiveDay, 1)} avg / active day`,
        renderDailyActivity(runs)
      )
    );
    charts.appendChild(
      buildChartCard(
        "Duration distribution",
        `median ${bonFmtDuration(summary.medianDuration)} · p95 ${bonFmtDuration(summary.p95Duration)}`,
        renderDurationHistogram(runs)
      )
    );
    charts.appendChild(
      buildChartCard(
        "Token economy",
        `${bonFmtThousands(summary.totalTokens)} tokens · ${bonFmtPercent(summary.cacheHitRate, 0)} served from cache`,
        renderTokenMix(summary)
      )
    );
    section.appendChild(charts);

    section.appendChild(buildModelTable(runs));
    section.appendChild(buildTopList(runs));
    section.appendChild(buildRunsTable(runs));
    section.appendChild(buildFootnote(summary));

    container.appendChild(section);
  }

  // ---------- Data collection ----------

  function collectInvestigations(reports) {
    const out = [];
    for (const r of reports || []) {
      const inv = r?.investigation;
      if (!inv) {
        continue;
      }

      // Newer records keep a runs[] history; emit one analytics entry per
      // historical run so re-investigations don't collapse into a single row.
      if (Array.isArray(inv.runs) && inv.runs.length > 0) {
        for (const run of inv.runs) {
          out.push(buildAnalyticsEntry(r.username, run));
        }
        // If a run is currently in flight, runs[] doesn't include it yet —
        // skip it (analytics only cares about completed runs).
        continue;
      }

      // Legacy record (single most-recent run only). Treat the root fields as
      // one run.
      out.push(buildAnalyticsEntry(r.username, inv));
    }
    return out;
  }

  function buildAnalyticsEntry(username, run) {
    const calls = [];
    if (run.usage) {
      calls.push({
        kind: "1d",
        model: run.model || null,
        usage: run.usage,
        costUsd:
          typeof run.costUsd === "number"
            ? run.costUsd
            : bonEstimateCostUsd(run.usage, run.model, run.webSearchCount),
        webSearchCount: run.webSearchCount || 0,
      });
    }
    const totalCost = calls.reduce((s, c) => s + (c.costUsd || 0), 0);
    return {
      username,
      status: run.status,
      runAt: run.runAt || null,
      durationMs: typeof run.durationMs === "number" ? run.durationMs : null,
      verdict: run.verdict || null,
      confidence: typeof run.confidence === "number" ? run.confidence : null,
      botProbability:
        typeof run.botProbability === "number" ? run.botProbability : null,
      persona: run.persona?.label || null,
      summary: typeof run.summary === "string" ? run.summary : "",
      postsFetched: run.postsFetched || 0,
      commentsFetched: run.commentsFetched || 0,
      calls,
      totalCost,
    };
  }

  function summarize(runs) {
    const s = {
      count: runs.length,
      totalCost: 0,
      totalDuration: 0,
      totalApiCalls: 0,
      totalWebSearches: 0,
      totalInput: 0,
      totalOutput: 0,
      totalCacheRead: 0,
      totalCacheWrite: 0,
      totalPosts: 0,
      totalComments: 0,
      cacheSavingsUsd: 0,
      models: {},
    };
    const durations = [];
    const days = new Set();
    let firstRun = Infinity;
    let lastRun = -Infinity;

    for (const r of runs) {
      s.totalCost += r.totalCost;
      if (typeof r.durationMs === "number") {
        s.totalDuration += r.durationMs;
        durations.push(r.durationMs);
      }
      s.totalPosts += r.postsFetched;
      s.totalComments += r.commentsFetched;
      if (r.runAt) {
        firstRun = Math.min(firstRun, r.runAt);
        lastRun = Math.max(lastRun, r.runAt);
        const d = new Date(r.runAt);
        days.add(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`);
      }
      for (const c of r.calls) {
        s.totalApiCalls++;
        s.totalWebSearches += c.webSearchCount || 0;
        const u = c.usage || {};
        s.totalInput += u.input_tokens || 0;
        s.totalOutput += u.output_tokens || 0;
        s.totalCacheRead += u.cache_read_input_tokens || 0;
        s.totalCacheWrite += u.cache_creation_input_tokens || 0;
        if (c.model) {
          const m = s.models[c.model] || {
            model: c.model,
            calls: 0,
            cost: 0,
            in: 0,
            out: 0,
            cacheRead: 0,
            cacheWrite: 0,
            duration: 0,
          };
          m.calls++;
          m.cost += c.costUsd || 0;
          m.in += u.input_tokens || 0;
          m.out += u.output_tokens || 0;
          m.cacheRead += u.cache_read_input_tokens || 0;
          m.cacheWrite += u.cache_creation_input_tokens || 0;
          s.models[c.model] = m;
        }
      }
    }

    durations.sort((a, b) => a - b);
    s.daysActive = days.size;
    s.firstRunAt = isFinite(firstRun) ? firstRun : null;
    s.lastRunAt = isFinite(lastRun) ? lastRun : null;
    s.avgCost = s.count ? s.totalCost / s.count : 0;
    s.medianCost = s.count
      ? bonPercentile(
          runs.map((r) => r.totalCost).sort((a, b) => a - b),
          0.5
        )
      : 0;
    s.maxCost = s.count ? Math.max(...runs.map((r) => r.totalCost)) : 0;
    s.avgDuration = durations.length ? s.totalDuration / durations.length : 0;
    s.medianDuration = bonPercentile(durations, 0.5);
    s.p95Duration = bonPercentile(durations, 0.95);
    s.totalTokens =
      s.totalInput + s.totalOutput + s.totalCacheRead + s.totalCacheWrite;
    s.cacheHitRate =
      s.totalInput + s.totalCacheRead > 0
        ? s.totalCacheRead / (s.totalInput + s.totalCacheRead)
        : 0;
    s.runsPerActiveDay = s.daysActive ? s.count / s.daysActive : 0;
    // Estimate dollars saved by cache reads vs. paying full input price.
    let savings = 0;
    for (const m of Object.values(s.models)) {
      const p = bonLookupPricing(m.model);
      if (!p) {
        continue;
      }
      savings += (m.cacheRead * (p.input - p.cacheRead)) / 1_000_000;
    }
    s.cacheSavingsUsd = savings;
    // Burn rate over last 7 days of activity (only counting days with runs
    // to avoid a misleadingly low rate for sporadic use).
    s.recentCost = bonRecentCost(runs, 7);
    s.recentDays = 7;
    return s;
  }

  // ---------- DOM builders ----------

  function buildHeader(count, errors) {
    const header = document.createElement("header");
    header.className = "bon-analytics-header";
    const h2 = document.createElement("h2");
    h2.textContent = "Investigation analytics";
    header.appendChild(h2);
    const sub = document.createElement("p");
    sub.className = "bon-analytics-subtitle";
    if (count > 0) {
      let text = `Cost, timing, and token usage across ${count} completed investigation${count === 1 ? "" : "s"}`;
      if (errors) {
        text += ` (${errors} failed run${errors === 1 ? "" : "s"} excluded)`;
      }
      sub.textContent = text + ".";
    } else {
      sub.textContent =
        "Cost, timing, and token usage across all completed investigations.";
    }
    header.appendChild(sub);
    return header;
  }

  function buildEmptyState() {
    const div = document.createElement("div");
    div.className = "bon-analytics-empty";
    div.textContent =
      "No completed investigations yet. Click 🤖 on a reported user to run one — stats will populate here.";
    return div;
  }

  function buildStatGrid(s) {
    const grid = document.createElement("div");
    grid.className = "bon-analytics-stats";

    addStat(
      grid,
      "Total spent",
      bonFmtUsd(s.totalCost),
      `${bonFmtUsd(s.avgCost)} avg · ${bonFmtUsd(s.medianCost)} median · ${bonFmtUsd(s.maxCost)} max`
    );
    addStat(
      grid,
      "Spend last 7d",
      bonFmtUsd(s.recentCost),
      s.recentCost > 0
        ? `~${bonFmtUsd(s.recentCost / s.recentDays)} / day`
        : "no activity this week"
    );
    addStat(
      grid,
      "API requests",
      String(s.totalApiCalls + s.totalWebSearches),
      `${s.totalApiCalls} Claude · ${s.totalWebSearches} web search`
    );
    addStat(
      grid,
      "Total tokens",
      bonFmtThousands(s.totalTokens),
      `${bonFmtThousands(s.totalOutput)} output · ${bonFmtPercent(s.cacheHitRate)} cached`
    );
    addStat(
      grid,
      "Median duration",
      bonFmtDuration(s.medianDuration),
      `p95 ${bonFmtDuration(s.p95Duration)} · ${bonFmtDuration(s.totalDuration)} total compute`
    );
    addStat(
      grid,
      "Cache savings",
      bonFmtUsd(s.cacheSavingsUsd),
      "vs. paying full input rate on cached reads"
    );
    addStat(
      grid,
      "Reddit fetched",
      bonFmtThousands(s.totalPosts + s.totalComments),
      `${bonFmtThousands(s.totalPosts)} posts · ${bonFmtThousands(s.totalComments)} comments`
    );
    addStat(
      grid,
      "Cost per Reddit item",
      s.totalPosts + s.totalComments > 0
        ? bonFmtUsd(s.totalCost / (s.totalPosts + s.totalComments))
        : "—",
      "post/comment analyzed"
    );

    return grid;
  }

  function addStat(parent, label, value, sub) {
    const card = document.createElement("div");
    card.className = "bon-analytics-stat";
    const l = document.createElement("div");
    l.className = "bon-stat-label";
    l.textContent = label;
    const v = document.createElement("div");
    v.className = "bon-stat-value";
    v.textContent = value;
    card.appendChild(l);
    card.appendChild(v);
    if (sub) {
      const sb = document.createElement("div");
      sb.className = "bon-stat-sub";
      sb.textContent = sub;
      card.appendChild(sb);
    }
    parent.appendChild(card);
  }

  function buildChartCard(title, subtitle, contentEl) {
    const card = document.createElement("div");
    card.className = "bon-chart-card";
    const head = document.createElement("div");
    head.className = "bon-chart-head";
    const h = document.createElement("div");
    h.className = "bon-chart-title";
    h.textContent = title;
    head.appendChild(h);
    if (subtitle) {
      const s = document.createElement("div");
      s.className = "bon-chart-sub";
      s.textContent = subtitle;
      head.appendChild(s);
    }
    card.appendChild(head);
    card.appendChild(contentEl);
    return card;
  }

  function buildFootnote(s) {
    const p = document.createElement("p");
    p.className = "bon-analytics-footnote";
    const parts = [];
    if (s.firstRunAt) {
      parts.push(`Earliest run ${new Date(s.firstRunAt).toLocaleDateString()}`);
    }
    if (s.lastRunAt) {
      parts.push(`latest ${new Date(s.lastRunAt).toLocaleDateString()}`);
    }
    parts.push(
      "Costs are estimated from per-token pricing; check your Anthropic console for billed amounts"
    );
    p.textContent = parts.join(" · ") + ".";
    return p;
  }

  // ---------- SVG helpers ----------

  function svgRoot(w, h, classes) {
    const el = document.createElementNS(SVG_NS, "svg");
    el.setAttribute("viewBox", `0 0 ${w} ${h}`);
    el.setAttribute("preserveAspectRatio", "none");
    el.setAttribute("class", classes || "bon-chart-svg");
    return el;
  }

  function svgEl(name, attrs) {
    const e = document.createElementNS(SVG_NS, name);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        e.setAttribute(k, v);
      }
    }
    return e;
  }

  function svgText(x, y, text, cls, anchor) {
    const t = svgEl("text", { x, y, class: cls || "bon-chart-tick" });
    if (anchor) {
      t.setAttribute("text-anchor", anchor);
    }
    t.textContent = text;
    return t;
  }

  // ---------- Chart: cumulative cost over time ----------

  function renderCumulativeCost(runs, summary) {
    const W = 600;
    const H = 200;
    const PAD = { t: 12, r: 12, b: 28, l: 52 };
    const iw = W - PAD.l - PAD.r;
    const ih = H - PAD.t - PAD.b;
    const root = svgRoot(W, H);

    const sorted = runs
      .filter((r) => r.runAt)
      .sort((a, b) => a.runAt - b.runAt);
    if (!sorted.length) {
      root.appendChild(emptyChartText(W, H, "No timestamped runs to plot."));
      return root;
    }

    const first = sorted[0].runAt;
    const last = sorted[sorted.length - 1].runAt;
    const span = Math.max(last - first, 1);

    let cum = 0;
    const points = sorted.map((r) => {
      cum += r.totalCost;
      return {
        x: PAD.l + ((r.runAt - first) / span) * iw,
        cum,
        cost: r.totalCost,
        runAt: r.runAt,
        username: r.username,
      };
    });
    const maxCum = cum || 1;

    // Y gridlines + ticks
    for (let i = 0; i <= 4; i++) {
      const frac = i / 4;
      const y = PAD.t + ih - frac * ih;
      root.appendChild(
        svgEl("line", {
          x1: PAD.l,
          y1: y,
          x2: PAD.l + iw,
          y2: y,
          class: "bon-chart-grid",
        })
      );
      root.appendChild(
        svgText(PAD.l - 8, y + 3, bonFmtUsd(maxCum * frac), null, "end")
      );
    }

    // Area + line
    const lineCoords = points
      .map(
        (p) =>
          `${p.x.toFixed(2)},${(PAD.t + ih - (p.cum / maxCum) * ih).toFixed(2)}`
      )
      .join(" L ");
    const area = `M ${PAD.l},${PAD.t + ih} L ${lineCoords} L ${(PAD.l + iw).toFixed(2)},${PAD.t + ih} Z`;
    root.appendChild(svgEl("path", { d: area, class: "bon-chart-area" }));
    root.appendChild(
      svgEl("path", { d: `M ${lineCoords}`, class: "bon-chart-line" })
    );

    // Highlight the most expensive single run
    let maxIdx = 0;
    for (let i = 1; i < points.length; i++) {
      if (sorted[i].totalCost > sorted[maxIdx].totalCost) {
        maxIdx = i;
      }
    }
    const mp = points[maxIdx];
    const my = PAD.t + ih - (mp.cum / maxCum) * ih;
    const marker = svgEl("circle", {
      cx: mp.x,
      cy: my,
      r: 3.5,
      class: "bon-chart-marker",
    });
    const markerTitle = svgEl("title");
    markerTitle.textContent = `Most expensive: u/${mp.username} — ${bonFmtUsd(mp.cost)} (${new Date(mp.runAt).toLocaleString()})`;
    marker.appendChild(markerTitle);
    root.appendChild(marker);

    // X axis time labels — switch to time-of-day when all runs fall within a
    // single day, otherwise three identical date labels would render.
    const xFormatter = makeTimeAxisFormatter(last - first);
    if (last - first < 60_000 || points.length === 1) {
      root.appendChild(
        svgText(
          PAD.l + iw / 2,
          PAD.t + ih + 18,
          xFormatter(first),
          null,
          "middle"
        )
      );
    } else {
      [
        { frac: 0, anchor: "start" },
        { frac: 0.5, anchor: "middle" },
        { frac: 1, anchor: "end" },
      ].forEach(({ frac, anchor }) => {
        const t = first + frac * span;
        const x = PAD.l + frac * iw;
        root.appendChild(
          svgText(x, PAD.t + ih + 18, xFormatter(t), null, anchor)
        );
      });
    }

    // Final value label
    const lastP = points[points.length - 1];
    const lastY = PAD.t + ih - (lastP.cum / maxCum) * ih;
    const cap = svgEl("circle", {
      cx: lastP.x,
      cy: lastY,
      r: 3,
      class: "bon-chart-endpoint",
    });
    root.appendChild(cap);

    // Add hover hit-rects spanning each segment
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const prev = i > 0 ? points[i - 1] : null;
      const next = i < points.length - 1 ? points[i + 1] : null;
      const x = prev ? (prev.x + p.x) / 2 : PAD.l;
      const x2 = next ? (next.x + p.x) / 2 : PAD.l + iw;
      const hit = svgEl("rect", {
        x,
        y: PAD.t,
        width: Math.max(1, x2 - x),
        height: ih,
        fill: "transparent",
      });
      const t = svgEl("title");
      t.textContent = `u/${p.username} · ${new Date(p.runAt).toLocaleString()}\nthis run: ${bonFmtUsd(p.cost)} · cumulative: ${bonFmtUsd(p.cum)}`;
      hit.appendChild(t);
      root.appendChild(hit);
    }

    return root;
  }

  // ---------- Chart: daily activity bars ----------

  function renderDailyActivity(runs) {
    const W = 600;
    const H = 200;
    const PAD = { t: 12, r: 8, b: 28, l: 36 };
    const iw = W - PAD.l - PAD.r;
    const ih = H - PAD.t - PAD.b;
    const root = svgRoot(W, H);

    const runsWithTime = runs.filter((r) => r.runAt);
    if (!runsWithTime.length) {
      root.appendChild(emptyChartText(W, H, "No timestamped runs to plot."));
      return root;
    }

    const buckets = new Map();
    let earliest = Infinity;
    for (const r of runsWithTime) {
      const d = new Date(r.runAt);
      d.setHours(0, 0, 0, 0);
      const ts = d.getTime();
      earliest = Math.min(earliest, ts);
      const b = buckets.get(ts) || { count: 0, cost: 0 };
      b.count++;
      b.cost += r.totalCost;
      buckets.set(ts, b);
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayTs = today.getTime();
    const maxSpan = 30 * MS_PER_DAY;
    const startTs = Math.max(earliest, todayTs - maxSpan);
    const totalDays = Math.round((todayTs - startTs) / MS_PER_DAY) + 1;
    const maxCount = Math.max(
      1,
      ...Array.from(buckets.values(), (b) => b.count)
    );
    const barW = iw / totalDays;

    // Y gridlines
    const yTicks = Math.min(4, maxCount);
    for (let i = 0; i <= yTicks; i++) {
      const frac = i / yTicks;
      const y = PAD.t + ih - frac * ih;
      const val = Math.round(maxCount * frac);
      root.appendChild(
        svgEl("line", {
          x1: PAD.l,
          y1: y,
          x2: PAD.l + iw,
          y2: y,
          class: "bon-chart-grid",
        })
      );
      root.appendChild(svgText(PAD.l - 6, y + 3, String(val), null, "end"));
    }

    for (let i = 0; i < totalDays; i++) {
      const ts = startTs + i * MS_PER_DAY;
      const b = buckets.get(ts);
      if (!b) {
        continue;
      }
      const h = (b.count / maxCount) * ih;
      const x = PAD.l + i * barW + 1;
      const y = PAD.t + ih - h;
      const rect = svgEl("rect", {
        x: x.toFixed(2),
        y: y.toFixed(2),
        width: Math.max(1, barW - 2).toFixed(2),
        height: h.toFixed(2),
        rx: 1.5,
        class: "bon-chart-bar bon-chart-bar--blue",
      });
      const t = svgEl("title");
      t.textContent = `${new Date(ts).toLocaleDateString()} — ${b.count} run${b.count === 1 ? "" : "s"} · ${bonFmtUsd(b.cost)}`;
      rect.appendChild(t);
      root.appendChild(rect);
    }

    if (totalDays === 1) {
      root.appendChild(
        svgText(
          PAD.l + iw / 2,
          PAD.t + ih + 18,
          new Date(startTs).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
          }),
          null,
          "middle"
        )
      );
    } else {
      [
        { frac: 0, anchor: "start" },
        { frac: 0.5, anchor: "middle" },
        { frac: 1, anchor: "end" },
      ].forEach(({ frac, anchor }) => {
        const ts = startTs + frac * (totalDays - 1) * MS_PER_DAY;
        root.appendChild(
          svgText(
            PAD.l + frac * iw,
            PAD.t + ih + 18,
            new Date(ts).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
            }),
            null,
            anchor
          )
        );
      });
    }

    return root;
  }

  // ---------- Chart: duration histogram ----------

  function renderDurationHistogram(runs) {
    const W = 600;
    const H = 200;
    const PAD = { t: 10, r: 10, b: 38, l: 32 };
    const iw = W - PAD.l - PAD.r;
    const ih = H - PAD.t - PAD.b;
    const root = svgRoot(W, H);

    const durations = runs
      .map((r) => r.durationMs)
      .filter((d) => typeof d === "number");
    if (!durations.length) {
      root.appendChild(emptyChartText(W, H, "No duration data."));
      return root;
    }

    const buckets = [
      { label: "<15s", max: 15_000 },
      { label: "15–30s", max: 30_000 },
      { label: "30–60s", max: 60_000 },
      { label: "1–1.5m", max: 90_000 },
      { label: "1.5–2m", max: 120_000 },
      { label: "2–3m", max: 180_000 },
      { label: "3m+", max: Infinity },
    ];
    const counts = new Array(buckets.length).fill(0);
    for (const d of durations) {
      let idx = buckets.findIndex((b) => d < b.max);
      if (idx === -1) {
        idx = buckets.length - 1;
      }
      counts[idx]++;
    }
    const maxCount = Math.max(1, ...counts);
    const barW = iw / buckets.length;

    const yTicks = Math.min(4, maxCount);
    for (let i = 0; i <= yTicks; i++) {
      const frac = i / yTicks;
      const y = PAD.t + ih - frac * ih;
      root.appendChild(
        svgEl("line", {
          x1: PAD.l,
          y1: y,
          x2: PAD.l + iw,
          y2: y,
          class: "bon-chart-grid",
        })
      );
      root.appendChild(
        svgText(
          PAD.l - 6,
          y + 3,
          String(Math.round(maxCount * frac)),
          null,
          "end"
        )
      );
    }

    for (let i = 0; i < buckets.length; i++) {
      const c = counts[i];
      const x = PAD.l + i * barW + 5;
      const w = barW - 10;
      if (c > 0) {
        const h = (c / maxCount) * ih;
        const y = PAD.t + ih - h;
        const rect = svgEl("rect", {
          x: x.toFixed(2),
          y: y.toFixed(2),
          width: w.toFixed(2),
          height: h.toFixed(2),
          rx: 2,
          class: "bon-chart-bar bon-chart-bar--teal",
        });
        const t = svgEl("title");
        t.textContent = `${buckets[i].label}: ${c} run${c === 1 ? "" : "s"} (${bonFmtPercent(c / durations.length)} of total)`;
        rect.appendChild(t);
        root.appendChild(rect);
      }
      root.appendChild(
        svgText(
          PAD.l + i * barW + barW / 2,
          PAD.t + ih + 18,
          buckets[i].label,
          null,
          "middle"
        )
      );
    }

    // Median marker line — value lives in the card subtitle, so the line is
    // unlabeled to avoid overlapping the bar-count number on tall bars. A
    // tooltip keeps the exact median discoverable.
    const medianMs = bonPercentile(
      [...durations].sort((a, b) => a - b),
      0.5
    );
    let medianBucket = buckets.findIndex((b) => medianMs < b.max);
    if (medianBucket === -1) {
      medianBucket = buckets.length - 1;
    }
    const medianX = PAD.l + medianBucket * barW + barW / 2;
    const medianLine = svgEl("line", {
      x1: medianX,
      y1: PAD.t,
      x2: medianX,
      y2: PAD.t + ih,
      class: "bon-chart-median-line",
    });
    const medianTitle = svgEl("title");
    medianTitle.textContent = `Median run: ${bonFmtDuration(medianMs)}`;
    medianLine.appendChild(medianTitle);
    root.appendChild(medianLine);

    return root;
  }

  // ---------- Chart: token mix stacked bar ----------

  function renderTokenMix(s) {
    const W = 600;
    const H = 200;
    const root = svgRoot(W, H);

    const segments = [
      { label: "Fresh input", value: s.totalInput, color: "#3b82f6" },
      { label: "Cache read", value: s.totalCacheRead, color: "#16a085" },
      { label: "Cache write", value: s.totalCacheWrite, color: "#f59e0b" },
      { label: "Output", value: s.totalOutput, color: "#8b5cf6" },
    ];
    const total = segments.reduce((a, b) => a + b.value, 0);
    if (total === 0) {
      root.appendChild(emptyChartText(W, H, "No token usage recorded."));
      return root;
    }

    const BAR_Y = 60;
    const BAR_H = 42;
    const PAD = 24;
    const innerW = W - PAD * 2;

    // Caption above the bar
    root.appendChild(
      svgText(
        W / 2,
        32,
        "Cache reads cost 10× less than fresh input — more green = better economy",
        "bon-chart-caption",
        "middle"
      )
    );

    let x = PAD;
    for (const seg of segments) {
      const w = (seg.value / total) * innerW;
      if (w <= 0) {
        continue;
      }
      const rect = svgEl("rect", {
        x: x.toFixed(2),
        y: BAR_Y,
        width: w.toFixed(2),
        height: BAR_H,
        fill: seg.color,
      });
      const title = svgEl("title");
      title.textContent = `${seg.label}: ${bonFmtThousands(seg.value)} tokens (${bonFmtPercent(seg.value / total, 1)})`;
      rect.appendChild(title);
      root.appendChild(rect);

      if (w > 60) {
        root.appendChild(
          svgText(
            x + w / 2,
            BAR_Y + BAR_H / 2 + 5,
            bonFmtPercent(seg.value / total, 0),
            "bon-chart-inbar",
            "middle"
          )
        );
      }
      x += w;
    }

    // Legend grid (2x2)
    const legendStartY = BAR_Y + BAR_H + 28;
    const legendColW = innerW / 2;
    segments.forEach((seg, i) => {
      const lx = PAD + (i % 2) * legendColW;
      const ly = legendStartY + Math.floor(i / 2) * 22;
      root.appendChild(
        svgEl("rect", {
          x: lx,
          y: ly - 8,
          width: 11,
          height: 11,
          rx: 2,
          fill: seg.color,
        })
      );
      root.appendChild(
        svgText(
          lx + 18,
          ly + 1,
          `${seg.label} — ${bonFmtThousands(seg.value)} (${bonFmtPercent(seg.value / total, 0)})`,
          "bon-chart-legend"
        )
      );
    });

    return root;
  }

  function emptyChartText(w, h, text) {
    return svgText(w / 2, h / 2, text, "bon-chart-empty", "middle");
  }

  // Picks date vs. time-of-day formatting based on how much wall-clock the
  // chart actually spans, so axes stay informative whether the runs are spread
  // across weeks or clustered in a single afternoon.
  function makeTimeAxisFormatter(spanMs) {
    if (spanMs < MS_PER_DAY) {
      return (t) =>
        new Date(t).toLocaleTimeString(undefined, {
          hour: "numeric",
          minute: "2-digit",
        });
    }
    return (t) =>
      new Date(t).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      });
  }

  // ---------- Per-model table ----------

  function buildModelTable(runs) {
    const wrap = document.createElement("div");
    wrap.className = "bon-analytics-table-card";

    const title = document.createElement("h3");
    title.className = "bon-analytics-section-title";
    title.textContent = "Per-model breakdown";
    wrap.appendChild(title);

    const byModel = new Map();
    const durationsByModel = new Map();
    for (const r of runs) {
      for (const c of r.calls) {
        const key = c.model || "(unknown)";
        const row = byModel.get(key) || {
          model: key,
          calls: 0,
          cost: 0,
          in: 0,
          out: 0,
          cacheRead: 0,
          cacheWrite: 0,
        };
        row.calls++;
        row.cost += c.costUsd || 0;
        const u = c.usage || {};
        row.in += u.input_tokens || 0;
        row.out += u.output_tokens || 0;
        row.cacheRead += u.cache_read_input_tokens || 0;
        row.cacheWrite += u.cache_creation_input_tokens || 0;
        byModel.set(key, row);

        if (typeof r.durationMs === "number") {
          if (!durationsByModel.has(key)) {
            durationsByModel.set(key, []);
          }
          durationsByModel.get(key).push(r.durationMs);
        }
      }
    }

    const rows = Array.from(byModel.values()).sort((a, b) => b.cost - a.cost);
    if (!rows.length) {
      return wrap;
    }

    const table = document.createElement("table");
    table.className = "bon-analytics-table";

    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    [
      { label: "Model", align: "left" },
      { label: "Calls" },
      { label: "Input" },
      { label: "Output" },
      { label: "Cache read" },
      { label: "Cache write" },
      { label: "Cache hit" },
      { label: "Avg duration" },
      { label: "Avg / call" },
      { label: "Total cost" },
    ].forEach((c) => {
      const th = document.createElement("th");
      th.textContent = c.label;
      if (c.align) {
        th.style.textAlign = c.align;
      }
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    for (const r of rows) {
      const tr = document.createElement("tr");
      const hit =
        r.in + r.cacheRead > 0 ? r.cacheRead / (r.in + r.cacheRead) : 0;
      const durs = durationsByModel.get(r.model) || [];
      const avgDur = durs.length
        ? durs.reduce((a, b) => a + b, 0) / durs.length
        : null;

      const tdModel = document.createElement("td");
      const code = document.createElement("code");
      code.textContent = r.model;
      tdModel.appendChild(code);
      tr.appendChild(tdModel);

      [
        String(r.calls),
        bonFmtThousands(r.in),
        bonFmtThousands(r.out),
        bonFmtThousands(r.cacheRead),
        bonFmtThousands(r.cacheWrite),
        bonFmtPercent(hit),
        bonFmtDuration(avgDur),
        bonFmtUsd(r.cost / Math.max(1, r.calls)),
        bonFmtUsd(r.cost),
      ].forEach((val) => {
        const td = document.createElement("td");
        td.textContent = val;
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);

    const scroll = document.createElement("div");
    scroll.className = "bon-analytics-table-scroll";
    scroll.appendChild(table);
    wrap.appendChild(scroll);

    return wrap;
  }

  // ---------- Top spenders list ----------

  function buildTopList(runs) {
    const wrap = document.createElement("div");
    wrap.className = "bon-analytics-table-card";
    const title = document.createElement("h3");
    title.className = "bon-analytics-section-title";
    title.textContent = "Most expensive investigations";
    wrap.appendChild(title);

    const top = [...runs]
      .filter((r) => r.totalCost > 0)
      .sort((a, b) => b.totalCost - a.totalCost)
      .slice(0, 10);
    if (!top.length) {
      const p = document.createElement("p");
      p.className = "bon-analytics-empty-small";
      p.textContent = "No cost data on the completed investigations.";
      wrap.appendChild(p);
      return wrap;
    }

    const maxCost = top[0].totalCost;
    const list = document.createElement("ol");
    list.className = "bon-analytics-top-list";
    for (const r of top) {
      const li = document.createElement("li");

      const name = document.createElement("a");
      name.className = "bon-analytics-top-name";
      name.href = `https://www.reddit.com/user/${encodeURIComponent(r.username)}`;
      name.target = "_blank";
      name.rel = "noopener noreferrer";
      name.textContent = `u/${r.username}`;
      li.appendChild(name);

      const meta = document.createElement("span");
      meta.className = "bon-analytics-top-meta";
      const metaBits = [];
      if (r.verdict) {
        metaBits.push(r.verdict.replace(/-/g, " "));
      }
      if (r.durationMs != null) {
        metaBits.push(bonFmtDuration(r.durationMs));
      }
      metaBits.push(`${r.calls.length} call${r.calls.length === 1 ? "" : "s"}`);
      if (r.runAt) {
        metaBits.push(new Date(r.runAt).toLocaleDateString());
      }
      meta.textContent = metaBits.join(" · ");
      li.appendChild(meta);

      const bar = document.createElement("div");
      bar.className = "bon-analytics-top-bar";
      const fill = document.createElement("div");
      fill.className = "bon-analytics-top-bar-fill";
      fill.style.width = `${(r.totalCost / maxCost) * 100}%`;
      bar.appendChild(fill);
      li.appendChild(bar);

      const cost = document.createElement("span");
      cost.className = "bon-analytics-top-cost";
      cost.textContent = bonFmtUsd(r.totalCost);
      li.appendChild(cost);

      list.appendChild(li);
    }
    wrap.appendChild(list);
    return wrap;
  }

  // ---------- Run log table ----------
  //
  // One row per completed investigation — the raw per-run record behind the
  // aggregations above. Newest first. Cap at MAX_RUN_ROWS so a chatty user
  // doesn't blow up the page; older runs are still counted in the summary.

  const MAX_RUN_ROWS = 100;

  function buildRunsTable(runs) {
    const wrap = document.createElement("div");
    wrap.className = "bon-analytics-table-card";

    const title = document.createElement("h3");
    title.className = "bon-analytics-section-title";
    title.textContent = "Run log";
    wrap.appendChild(title);

    if (!runs.length) {
      const p = document.createElement("p");
      p.className = "bon-analytics-empty-small";
      p.textContent = "No runs to list.";
      wrap.appendChild(p);
      return wrap;
    }

    const sorted = [...runs].sort((a, b) => (b.runAt || 0) - (a.runAt || 0));
    const rows = sorted.slice(0, MAX_RUN_ROWS);

    const table = document.createElement("table");
    table.className = "bon-analytics-table";

    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    [
      "When",
      "User",
      "Verdict",
      "Persona",
      "Model",
      "Duration",
      "Calls",
      "Tokens",
      "Cost",
    ].forEach((label) => {
      const th = document.createElement("th");
      th.textContent = label;
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    for (const r of rows) {
      const tr = document.createElement("tr");

      const tdWhen = document.createElement("td");
      tdWhen.textContent = r.runAt ? bonFmtTimestamp(r.runAt) : "—";
      tr.appendChild(tdWhen);

      const tdUser = document.createElement("td");
      const a = document.createElement("a");
      a.className = "bon-analytics-top-name";
      a.href = `https://www.reddit.com/user/${encodeURIComponent(r.username)}`;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = `u/${r.username}`;
      tdUser.appendChild(a);
      tr.appendChild(tdUser);

      const tdVerdict = document.createElement("td");
      tdVerdict.textContent = formatVerdictCell(r);
      tr.appendChild(tdVerdict);

      const tdPersona = document.createElement("td");
      tdPersona.textContent = r.persona || "—";
      tr.appendChild(tdPersona);

      const tdModel = document.createElement("td");
      const primaryModel = r.calls[0]?.model || null;
      if (primaryModel) {
        const code = document.createElement("code");
        code.textContent = shortModelName(primaryModel);
        tdModel.appendChild(code);
      } else {
        tdModel.textContent = "—";
      }
      tr.appendChild(tdModel);

      const tdDuration = document.createElement("td");
      tdDuration.textContent = bonFmtDuration(r.durationMs);
      tr.appendChild(tdDuration);

      const tdCalls = document.createElement("td");
      tdCalls.textContent = String(r.calls.length);
      tr.appendChild(tdCalls);

      const tdTokens = document.createElement("td");
      const tokenTotal = sumRunTokens(r);
      tdTokens.textContent = tokenTotal > 0 ? bonFmtThousands(tokenTotal) : "—";
      tr.appendChild(tdTokens);

      const tdCost = document.createElement("td");
      tdCost.textContent = bonFmtUsd(r.totalCost);
      tr.appendChild(tdCost);

      if (r.summary) {
        tr.title = r.summary;
      }

      tbody.appendChild(tr);
    }
    table.appendChild(tbody);

    const scroll = document.createElement("div");
    scroll.className = "bon-analytics-table-scroll";
    scroll.appendChild(table);
    wrap.appendChild(scroll);

    if (sorted.length > rows.length) {
      const note = document.createElement("p");
      note.className = "bon-analytics-empty-small";
      note.style.marginTop = "0.75em";
      note.textContent = `Showing ${rows.length} most recent of ${sorted.length} runs.`;
      wrap.appendChild(note);
    }

    return wrap;
  }

  function sumRunTokens(r) {
    let total = 0;
    for (const c of r.calls) {
      const u = c.usage || {};
      total +=
        (u.input_tokens || 0) +
        (u.output_tokens || 0) +
        (u.cache_read_input_tokens || 0) +
        (u.cache_creation_input_tokens || 0);
    }
    return total;
  }

  function formatVerdictCell(r) {
    if (!r.verdict) {
      return "—";
    }
    const label = r.verdict.replace(/-/g, " ");
    if (typeof r.botProbability === "number") {
      return `${label} · ${bonFmtPercent(r.botProbability)} bot`;
    }
    if (typeof r.confidence === "number") {
      return `${label} · ${bonFmtPercent(r.confidence)} conf`;
    }
    return label;
  }

  function shortModelName(model) {
    return model.replace(/^claude-/, "").replace(/-\d{8}$/, "");
  }

  globalThis.bonRenderAnalytics = bonRenderAnalytics;
})();
