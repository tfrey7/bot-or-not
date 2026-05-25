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

class ExtensionClient implements ClientAdapter {
  send<T = unknown>(message: ClientMessage): Promise<T> {
    return browser.runtime.sendMessage(message) as Promise<T>;
  }

  subscribe(listener: ClientListener): () => void {
    const pending = new Map<
      ClientEvent["type"],
      ReturnType<typeof setTimeout>
    >();

    const emit = (type: ClientEvent["type"]): void => {
      const existing = pending.get(type);
      if (existing) {
        clearTimeout(existing);
      }

      const timer = setTimeout(() => {
        pending.delete(type);
        listener({ type } as ClientEvent);
      }, CLIENT_COALESCE_MS);
      pending.set(type, timer);
    };

    const handler = (
      changes: Record<string, browser.storage.StorageChange>,
      area: string
    ): void => {
      if (area !== "local") {
        return;
      }

      if (changes.reports) {
        emit("reports-changed");
      }

      if (changes.subreddits) {
        emit("subreddits-changed");
      }

      if (changes.apiKeys || changes.claudeApiKey) {
        // `claudeApiKey` is the legacy single-vendor slot; once the
        // migration runs it becomes `apiKeys`. Subscribe to both so the
        // UI stays in sync regardless of which slot the change came from.
        emit("api-key-changed");
      }

      if (changes.llmVendor || changes.llmModel) {
        emit("llm-selection-changed");
      }

      if (changes.hidePii) {
        emit("hide-pii-changed");
      }

      if (changes.redditPauseUntil) {
        emit("reddit-pause-changed");
      }
    };

    browser.storage.onChanged.addListener(handler);
    return () => {
      for (const timer of pending.values()) {
        clearTimeout(timer);
      }

      pending.clear();
      browser.storage.onChanged.removeListener(handler);
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
