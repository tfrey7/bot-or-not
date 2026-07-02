// Detail-pane host — the bridge between the Preact tab and the vanilla
// dossier widgets (investigation detail, charts, heatmaps, notes form).
// Those widgets carry timers, animations, and form state, so they are
// rebuilt imperatively and only when the summary-derived fingerprint
// changes — a poll tick or sibling-row transition leaves them untouched.

import { useEffect, useRef } from "preact/hooks";
import { clientSend } from "../../client.ts";
import type { Report } from "../../types.ts";
import { settingsOpen } from "../settings";
import { redditorsDetailEmpty, redditorsDetailPane } from "./detail_pane.ts";
import { redditorsDetailFingerprint, type ReportRow } from "./logic.ts";

export interface DetailHostProps {
  selected: ReportRow | null;
  queueAhead: number;
  hasAnyReports: boolean;
  getExpectedDurationMs: () => number | null;
  onInvestigate: () => void;
}

export function DetailHost(props: DetailHostProps) {
  const paneRef = useRef<HTMLElement>(null);
  const lastFingerprintRef = useRef<string | null>(null);

  // Tracks which selection the pane last animated for, so data-driven
  // rebuilds don't re-fire the swap animation. `undefined` means "no render
  // yet" — the first render is silent so deep-linked loads don't fade in.
  const lastAnimatedRef = useRef<string | null | undefined>(undefined);

  // Latest selection, readable after the async full-report fetch resolves —
  // the operator may have clicked another row while it was in flight.
  const selectedUsernameRef = useRef<string | null>(null);
  selectedUsernameRef.current = props.selected?.username ?? null;

  useEffect(() => {
    const report = props.selected;

    const fingerprint = redditorsDetailFingerprint(
      report,
      props.queueAhead,
      props.hasAnyReports
    );

    if (fingerprint === lastFingerprintRef.current) {
      return;
    }

    lastFingerprintRef.current = fingerprint;

    if (!report) {
      paneRef.current?.replaceChildren(
        redditorsDetailEmpty(
          props.hasAnyReports
            ? "Select a user from the list to see the dossier."
            : "No reports yet. Flag a Reddit user from their profile to start tracking."
        )
      );

      maybeAnimateSwap();
      return;
    }

    void renderFullDossier(report, props.queueAhead);
  });

  // The list runs off slim summaries, so the dossier's heavy fields come
  // from a per-record fetch. The fingerprint gate above means this runs once
  // per meaningful change, not on every poll tick. The old content stays up
  // until the fetch resolves to avoid an empty-pane flash.
  async function renderFullDossier(
    summary: ReportRow,
    queueAhead: number
  ): Promise<void> {
    let full: Report | null = null;

    try {
      const response = await clientSend<{ report?: Report | null }>({
        type: "get-user-report",
        username: summary.username,
      });
      full = response?.report ?? null;
    } catch (error) {
      console.error("[Bot or Not] failed to load dossier", error);
    }

    if (selectedUsernameRef.current !== summary.username) {
      return;
    }

    const report: ReportRow = full
      ? { username: summary.username, ...full }
      : summary;

    paneRef.current?.replaceChildren(
      redditorsDetailPane(report, {
        expectedDurationMs: props.getExpectedDurationMs(),
        queueAhead,
        onNoApiKey: settingsOpen,
        onInvestigate: props.onInvestigate,
      })
    );

    maybeAnimateSwap();
  }

  function maybeAnimateSwap(): void {
    const isFirstRender = lastAnimatedRef.current === undefined;
    const changed = lastAnimatedRef.current !== selectedUsernameRef.current;
    lastAnimatedRef.current = selectedUsernameRef.current;

    if (isFirstRender || !changed) {
      return;
    }

    const reduced = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    if (reduced) {
      return;
    }

    paneRef.current?.animate(
      [
        { opacity: 0, transform: "translateY(4px)" },
        { opacity: 1, transform: "translateY(0)" },
      ],
      { duration: 200, easing: "ease-out" }
    );
  }

  return (
    <aside
      class="bon-split-detail"
      id="bon-detail-pane"
      aria-live="polite"
      ref={paneRef}
    />
  );
}
