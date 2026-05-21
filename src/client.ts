// Client transport adapter — the seam UI surfaces (content scripts, the
// reports page) use to reach the backend. Today the backend is the
// background service worker and the transport is `browser.runtime.*`; the
// same interface could be implemented against HTTP fetch + WebSocket/SSE
// to host the same UI code against a real server.

export interface BonClientMessage {
  type: string;
  [key: string]: unknown;
}

export type BonClientEvent =
  | { type: "reports-changed" }
  | { type: "api-key-changed" };

export type BonClientListener = (event: BonClientEvent) => void;

export interface BonClient {
  send<T = unknown>(message: BonClientMessage): Promise<T>;
  subscribe(listener: BonClientListener): () => void;
}

class BonExtensionClient implements BonClient {
  send<T = unknown>(message: BonClientMessage): Promise<T> {
    return browser.runtime.sendMessage(message) as Promise<T>;
  }

  subscribe(listener: BonClientListener): () => void {
    const handler = (
      changes: Record<string, browser.storage.StorageChange>,
      area: string
    ): void => {
      if (area !== "local") {
        return;
      }

      if (changes.reports) {
        listener({ type: "reports-changed" });
      }

      if (changes.claudeApiKey) {
        listener({ type: "api-key-changed" });
      }
    };

    browser.storage.onChanged.addListener(handler);
    return () => browser.storage.onChanged.removeListener(handler);
  }
}

const bonClient: BonClient = new BonExtensionClient();

export function bonClientSend<T = unknown>(
  message: BonClientMessage
): Promise<T> {
  return bonClient.send<T>(message);
}

export function bonClientSubscribe(listener: BonClientListener): () => void {
  return bonClient.subscribe(listener);
}
