/**
 * The browser APIs jsdom does not implement.
 *
 * All three are things the interface genuinely uses — it measures itself, it
 * follows the system theme, and it animates — so stubbing them is what lets a
 * render test exercise the real components rather than a stripped-down variant
 * of them.
 */

import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

Object.defineProperty(window, "ResizeObserver", { writable: true, value: ResizeObserverStub });

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }),
});

// The stage and the globe both drive themselves from a frame loop. Left running
// under a fake clock they would spin forever; a single frame is enough to prove
// the first paint does not throw.
Object.defineProperty(window, "requestAnimationFrame", {
  writable: true,
  value: (callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 0),
});
Object.defineProperty(window, "cancelAnimationFrame", {
  writable: true,
  value: (handle: number) => window.clearTimeout(handle),
});

Object.defineProperty(window, "scrollTo", { writable: true, value: () => {} });

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
