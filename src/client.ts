// Client transport adapter — the seam UI surfaces (content scripts, the
// reports page) use to reach the backend. Today the backend is the
// background service worker and the transport is `browser.runtime.*`; the
// same interface could be implemented against HTTP fetch + WebSocket/SSE
// to host the same UI code against a real server.

export interface ClientMessage {
  type: string;
  [key: string]: unknown;
}

export type ClientEvent =
  | { type: "reports-changed" }
  | { type: "subreddits-changed" }
  | { type: "api-key-changed" }
  | { type: "llm-selection-changed" }
  | { type: "hide-pii-changed" }
  | { type: "reddit-pause-changed" };

export type ClientListener = (event: ClientEvent) => void;

export interface ClientAdapter {
  send<T = unknown>(message: ClientMessage): Promise<T>;
  subscribe(listener: ClientListener): () => void;
}

// One investigation lifecycle fires ~5 separate storage writes (queued →
// running → activityData → done → profileHidden/botBouncer). Without
// coalescing, every subscriber re-renders for each write, and the reports
// page slideshow + uplot canvases get rebuilt 5× per investigation step.
// 250ms is short enough that user-driven actions still feel immediate.
const CLIENT_COALESCE_MS = 250;

// Reports now live under per-record `report:<username>` keys (see
// storage.ts). A storage change touches one such key, so detect the prefix
// rather than a single `reports` key. `reports` is still matched for the
// brief window before the reports_per_key migration removes the legacy blob.
const REPORT_KEY_PREFIX = "report:";

class ExtensionClient implements ClientAdapter {
  // One storage.onChanged listener fans out to every subscriber in this
  // context. Each feature used to register its own listener (≈7 per Reddit
  // tab), so every write paid the per-listener dispatch + coalescing-timer
  // overhead N times for the same change.
  private listeners = new Set<ClientListener>();
  private pending = new Map<
    ClientEvent["type"],
    ReturnType<typeof setTimeout>
  >();
  private storageListenerActive = false;

  send<T = unknown>(message: ClientMessage): Promise<T> {
    return browser.runtime.sendMessage(message) as Promise<T>;
  }

  private emit(type: ClientEvent["type"]): void {
    const existing = this.pending.get(type);
    if (existing) {
      clearTimeout(existing);
    }

    const timer = setTimeout(() => {
      this.pending.delete(type);

      for (const listener of this.listeners) {
        listener({ type } as ClientEvent);
      }
    }, CLIENT_COALESCE_MS);
    this.pending.set(type, timer);
  }

  private handleStorageChange = (
    changes: Record<string, browser.storage.StorageChange>,
    area: string
  ): void => {
    if (area !== "local") {
      return;
    }

    const keys = Object.keys(changes);

    if (
      keys.some((key) => key === "reports" || key.startsWith(REPORT_KEY_PREFIX))
    ) {
      this.emit("reports-changed");
    }

    if (changes.subreddits) {
      this.emit("subreddits-changed");
    }

    if (changes.apiKeys || changes.claudeApiKey) {
      // `claudeApiKey` is the legacy single-vendor slot; once the migration
      // runs it becomes `apiKeys`. Match both so the UI stays in sync
      // regardless of which slot the change came from.
      this.emit("api-key-changed");
    }

    if (changes.llmVendor || changes.llmModel) {
      this.emit("llm-selection-changed");
    }

    if (changes.hidePii) {
      this.emit("hide-pii-changed");
    }

    if (changes.redditPauseUntil) {
      this.emit("reddit-pause-changed");
    }
  };

  subscribe(listener: ClientListener): () => void {
    this.listeners.add(listener);

    if (!this.storageListenerActive) {
      browser.storage.onChanged.addListener(this.handleStorageChange);
      this.storageListenerActive = true;
    }

    return () => {
      this.listeners.delete(listener);
    };
  }
}

const client: ClientAdapter = new ExtensionClient();

export function clientSend<T = unknown>(message: ClientMessage): Promise<T> {
  return client.send<T>(message);
}

export function clientSubscribe(listener: ClientListener): () => void {
  return client.subscribe(listener);
}
