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

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { getConfig, getPlugins, getSchema, saveConfig } from "./client";
import type { AppConfig } from "./contract";

const FOREVER = { staleTime: Infinity, gcTime: Infinity } as const;

/**
 * The settings, cached but not forever.
 *
 * Unlike the plugin list these can change while the page is open — that is what
 * the settings panel is for — so they are refetched rather than pinned.
 */
export function useAppConfig() {
  return useQuery({ queryKey: ["config"], queryFn: getConfig, staleTime: 30_000 });
}

export function useSaveConfig() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (config: AppConfig) => saveConfig(config),
    // Seeded with the answer rather than refetched: the response is the file
    // as written, so asking again would be asking a question already answered.
    onSuccess: (saved) => client.setQueryData(["config"], saved),
  });
}

export function usePlugins() {
  return useQuery({ queryKey: ["plugins"], queryFn: getPlugins, ...FOREVER });
}

export function useConfigSchema() {
  return useQuery({ queryKey: ["schema"], queryFn: getSchema, ...FOREVER });
}


/**
 * The numeric bounds the backend declares, per field.
 *
 * The form used to carry its own idea of what is allowed, duplicated by hand
 * from the models. That is a copy that can drift: tighten a bound in
 * `settings.py` and the interface would go on offering values the server now
 * refuses, and the reader would meet a 422 for a slider that let them get
 * there.
 *
 * Reading it from `/schema` closes that gap. The *presentation* range stays a
 * choice — γ is allowed up to 1 but a run at total decay is not worth a third
 * of the slider — so a caller intersects its preferred range with this one and
 * can never end up outside what the backend accepts.
 */
export interface Bounds {
  min?: number;
  max?: number;
}

interface SchemaNode {
  minimum?: number;
  maximum?: number;
  anyOf?: SchemaNode[];
  properties?: Record<string, SchemaNode>;
}

function boundsOf(node: SchemaNode | undefined): Bounds {
  if (!node) return {};
  // A nullable field arrives as anyOf[type, null]; the bounds live on the
  // branch that is not null.
  const candidates = [node, ...(node.anyOf ?? [])];
  for (const candidate of candidates) {
    if (candidate.minimum !== undefined || candidate.maximum !== undefined) {
      return { min: candidate.minimum, max: candidate.maximum };
    }
  }
  return {};
}

export function useSchemaBounds(): (path: string) => Bounds {
  const schema = useConfigSchema();

  return (path: string) => {
    const document = schema.data as
      | { properties?: Record<string, SchemaNode>; $defs?: Record<string, SchemaNode> }
      | undefined;
    if (!document) return {};

    // Either "n_qubits" at the top level, or "SecurityPolicy.qber_threshold"
    // inside one of the nested models.
    const [head, tail] = path.split(".");
    if (!tail) return boundsOf(document.properties?.[head!]);
    return boundsOf(document.$defs?.[head!]?.properties?.[tail]);
  };
}

/** The tighter of a preferred range and what the backend actually allows. */
export function within(preferred: { min: number; max: number }, allowed: Bounds) {
  return {
    min: Math.max(preferred.min, allowed.min ?? -Infinity),
    max: Math.min(preferred.max, allowed.max ?? Infinity),
  };
}
