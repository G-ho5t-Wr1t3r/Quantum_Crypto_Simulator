/**
 * WebSocket client for a run's event stream.
 *
 * The backend replays everything that already happened before following the run
 * live, so a subscriber that connects late — or reloads the page mid-run — is
 * brought up to date and then continues. This client relies on that: it does no
 * catch-up of its own, because doing both would deliver every early event
 * twice.
 *
 * The socket closes on its own once the run is over and everything has been
 * delivered. A close is therefore normal and is not, by itself, a failure.
 */

import type { AnyEvent } from "./contract";
import { isTerminal } from "./contract";

export interface StreamHandlers {
  onEvent: (event: AnyEvent) => void;
  /**
   * Called once, when the run reached a terminal event or the socket closed.
   * `reason` is set only when it ended badly.
   */
  onClose?: (reason?: string) => void;
}

export interface Subscription {
  close: () => void;
}

function socketUrl(runId: string): string {
  // Derived from the page's own origin so that the same build works against the
  // dev proxy and behind the compose reverse proxy. The scheme has to be
  // swapped: an https page cannot open a ws:// socket.
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/api/runs/${runId}/stream`;
}

/**
 * Follow a run until it ends.
 *
 * There is no reconnection logic on purpose. The stream is finite and the
 * backend keeps every event, so the honest recovery from a dropped connection
 * is to subscribe again — which replays from the beginning — or to poll
 * `getEvents(runId, since)`. Silently reconnecting underneath the caller would
 * hide the gap while re-delivering events it had already drawn.
 */
export function subscribe(runId: string, handlers: StreamHandlers): Subscription {
  const socket = new WebSocket(socketUrl(runId));
  // Guards the difference between "we closed it" and "it closed on us": only
  // the second is worth reporting, and only once.
  let done = false;

  const finish = (reason?: string) => {
    if (done) return;
    done = true;
    handlers.onClose?.(reason);
  };

  socket.onmessage = (message) => {
    const event = JSON.parse(message.data as string) as AnyEvent;
    handlers.onEvent(event);
    if (isTerminal(event)) {
      finish(event.kind === "error" ? (event.payload as { detail: string }).detail : undefined);
    }
  };

  // An error here is a transport failure — the server went away, the proxy
  // dropped the upgrade. A run that fails for its own reasons arrives as an
  // `error` event on a socket that is working fine, and is handled above.
  socket.onerror = () => finish("connection lost");
  socket.onclose = () => finish();

  return {
    close: () => {
      done = true;
      socket.close();
    },
  };
}
