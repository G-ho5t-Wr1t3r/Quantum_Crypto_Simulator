/**
 * REST client for the simulator API.
 *
 * Every path is relative and prefixed with `/api`, which the dev server proxies
 * and the compose reverse proxy will serve directly. There is deliberately no
 * base-URL configuration: a build that has to be told where its backend lives
 * is a build that can be pointed at the wrong one.
 */

import type {
  Plugins,
  RunHandle,
  RunResult,
  RunSummary,
  SimulationConfig,
  SimulationEvent,
  SweepRequest,
} from "./contract";

const API = "/api";

/**
 * An error carrying the status the backend answered with.
 *
 * The status is part of the meaning here, not noise to log: 422 says the
 * configuration is impossible and the form should say which field, 413 says the
 * run is too large for the synchronous path and should be started with
 * `startRun` instead, 429 says the server is already at its ceiling and the
 * right response is to wait rather than to retry immediately.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
  ) {
    super(detail);
    this.name = "ApiError";
  }

  /** The configuration cannot be run — the attacker's placement, usually. */
  get isInvalidConfig(): boolean {
    return this.status === 422;
  }

  /** Too large to run synchronously; use the asynchronous endpoint. */
  get isTooLarge(): boolean {
    return this.status === 413;
  }

  /** The server is at its concurrency ceiling. Nothing was started. */
  get isBusy(): boolean {
    return this.status === 429;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });

  if (!response.ok) {
    // FastAPI answers with {detail: ...}, where detail is a string for the
    // errors raised by hand and a list of field errors for a validation
    // failure. Both are flattened to one sentence: a form shows the sentence,
    // and nothing downstream has to know which shape it came from.
    const body = await response.json().catch(() => null);
    throw new ApiError(response.status, describeDetail(body) ?? response.statusText);
  }

  return response.json() as Promise<T>;
}

function describeDetail(body: unknown): string | null {
  if (body === null || typeof body !== "object") return null;
  const detail = (body as { detail?: unknown }).detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((item) => {
        const { loc, msg } = item as { loc?: unknown[]; msg?: string };
        const field = Array.isArray(loc) ? loc.slice(1).join(".") : "";
        return field ? `${field}: ${msg}` : (msg ?? "");
      })
      .filter(Boolean)
      .join("; ");
  }
  return null;
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

/**
 * What this build can simulate, including how each protocol is wired.
 *
 * Worth fetching before anything else: it is what lets the interface offer only
 * the legal combinations, and what lets the network map be drawn before a run
 * exists.
 */
export const getPlugins = () => request<Plugins>("/plugins");

/**
 * The JSON Schema of a configuration.
 *
 * The control panel is generated from this rather than written by hand, so the
 * form cannot drift away from what the backend accepts.
 */
export const getSchema = () => request<Record<string, unknown>>("/schema");

// ---------------------------------------------------------------------------
// Running
// ---------------------------------------------------------------------------

/** Start a run. Returns as soon as it is accepted, not when it finishes. */
export const startRun = (config: SimulationConfig) =>
  request<RunHandle>("/simulate", { method: "POST", body: JSON.stringify(config) });

/** Start a sweep. Each point is a full run, so this is the long case. */
export const startSweep = (sweep: SweepRequest) =>
  request<RunHandle>("/sweep", { method: "POST", body: JSON.stringify(sweep) });

/**
 * Run something small and get the answer in the same response.
 *
 * The "fast run" path: no identifier, no socket, nothing to clean up. Above the
 * server's qubit ceiling it fails with 413 rather than holding the connection
 * open, and the caller is expected to fall back to `startRun`.
 */
export const runSync = (config: SimulationConfig) =>
  request<RunResult>("/simulate/sync", { method: "POST", body: JSON.stringify(config) });

export const getRun = (runId: string) => request<RunSummary>(`/runs/${runId}`);

/**
 * Events recorded so far, from `since` onwards.
 *
 * The polling counterpart of the socket, and the way to catch up after a
 * dropped connection without replaying what has already been drawn.
 */
export const getEvents = (runId: string, since = 0) =>
  request<{ run_id: string; status: string; events: SimulationEvent[] }>(
    `/runs/${runId}/events?since=${since}`,
  );

/** Where a browser should point to download the run as CSV or JSON. */
export const exportUrl = (runId: string, format: "csv" | "json" = "csv") =>
  `${API}/runs/${runId}/export?format=${format}`;
