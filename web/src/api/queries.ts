/**
 * React Query bindings for the endpoints that describe the backend.
 *
 * Discovery is exactly what a cache is for: `/plugins` and `/schema` describe
 * the build, not the run, and they cannot change while the page is open. They
 * are marked as never going stale for that reason.
 *
 * The run lifecycle is deliberately NOT modelled as a query. It is pushed over
 * a socket, so polling it would be re-fetching what has already arrived.
 */

import { useQuery } from "@tanstack/react-query";

import { getPlugins, getSchema } from "./client";

const FOREVER = { staleTime: Infinity, gcTime: Infinity } as const;

export function usePlugins() {
  return useQuery({ queryKey: ["plugins"], queryFn: getPlugins, ...FOREVER });
}

export function useConfigSchema() {
  return useQuery({ queryKey: ["schema"], queryFn: getSchema, ...FOREVER });
}
