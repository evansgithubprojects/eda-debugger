import type { Finding, GraphNode, Occurrence, Recording, Template } from '@eda-debugger/core';

/** A route an occurrence travelled: source node -> one receiving node. */
export interface Hop {
  src: string;
  dst: string;
}

export interface IndexedOccurrence {
  occ: Occurrence;
  template: Template;
  hops: Hop[];
  /** Error times (per throwing handler) in recording ms. */
  throws: { at: number; handlerId: string; message: string }[];
}

export interface ReplayIndex {
  recording: Recording;
  items: IndexedOccurrence[];
  byId: Map<string, IndexedOccurrence>;
  nodes: Map<string, GraphNode>;
  processLabel: Map<string, string>;
  findingsByOcc: Map<string, Finding[]>;
  start: number;
  end: number;
}

/** Resolves a raw node id to the id shown at the current zoom level, or null to hide it. */
export type MapNode = (nodeId: string) => string | null;

export function buildIndex(recording: Recording): ReplayIndex {
  const templates = new Map(recording.templates.map((t) => [t.id, t]));
  const nodes = new Map(recording.nodes.map((n) => [n.id, n]));
  const findingsByOcc = new Map<string, Finding[]>();
  for (const f of recording.findings ?? []) {
    findingsByOcc.set(f.occurrenceId, [...(findingsByOcc.get(f.occurrenceId) ?? []), f]);
  }
  const items: IndexedOccurrence[] = [];
  for (const occ of [...recording.occurrences].sort((a, b) => a.ts - b.ts)) {
    const template = templates.get(occ.templateId);
    if (!template) continue;
    // Events nobody listens to dead-end at their own emitter so they still show up.
    const targets = template.handlerIds.length ? template.handlerIds : [template.emitterId];
    items.push({
      occ, template,
      hops: targets.map((dst) => ({ src: occ.sourceNodeId, dst })),
      throws: occ.handlerResults
        .filter((r) => r.error)
        .map((r) => ({ at: r.ts + r.durationMs, handlerId: r.handlerId, message: r.error!.message })),
    });
  }
  const start = items.length ? (items[0] as IndexedOccurrence).occ.ts : 0;
  const end = items.reduce((m, i) => Math.max(m, i.occ.ts + i.occ.durationMs), start);
  return {
    recording, items, byId: new Map(items.map((i) => [i.occ.id, i])), nodes,
    processLabel: new Map(recording.processes.map((p) => [p.id, p.label])),
    findingsByOcc, start, end,
  };
}

export const edgeId = (src: string, dst: string) => `${src}>${dst}`;

export interface ActiveOptions {
  /** How long a lit pathway takes to fade, in recording ms. */
  fadeMs: number;
  /** How long the red flash on a throw lasts, in recording ms. */
  flashMs: number;
  window?: [number, number];
  mapNode?: MapNode;
}

export interface Active {
  /** 0..1 brightness. */
  litEdges: Map<string, number>;
  litNodes: Map<string, number>;
  /** Throws that just happened: grab attention. */
  flashingNodes: Set<string>;
  flashingEdges: Set<string>;
  /** Throws at or before the playhead: persistent indicator after the flash fades. */
  thrownNodes: Map<string, number>;
  thrownEdges: Map<string, number>;
  /** Suspected-corrupt payloads at or before the playhead. */
  flaggedEdges: Map<string, { count: number; high: boolean }>;
  flaggedNodes: Map<string, { count: number; high: boolean }>;
  /** Flagged payloads lighting up right now. */
  litFlaggedEdges: Set<string>;
}

/** Everything that should be drawn at time `t`. Pure: replay never re-runs user code. */
export function activeAt(index: ReplayIndex, t: number, opts: ActiveOptions): Active {
  const map = opts.mapNode ?? ((id: string) => id);
  const [w0, w1] = opts.window ?? [-Infinity, Infinity];
  const out: Active = {
    litEdges: new Map(), litNodes: new Map(), flashingNodes: new Set(), flashingEdges: new Set(),
    thrownNodes: new Map(), thrownEdges: new Map(), flaggedEdges: new Map(), flaggedNodes: new Map(),
    litFlaggedEdges: new Set(),
  };
  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
  const bumpFlag = (m: Map<string, { count: number; high: boolean }>, k: string, high: boolean) => {
    const cur = m.get(k) ?? { count: 0, high: false };
    m.set(k, { count: cur.count + 1, high: cur.high || high });
  };

  for (const { occ, hops, throws } of index.items) {
    if (occ.ts > t) break; // sorted by ts: nothing later can have happened yet
    if (occ.ts < w0 || occ.ts > w1) continue;
    const flags = index.findingsByOcc.get(occ.id);
    const high = !!flags?.some((f) => f.priority === 'high');
    const age = t - occ.ts;

    for (const hop of hops) {
      const src = map(hop.src);
      const dst = map(hop.dst);
      if (!src || !dst || src === dst) continue;
      const id = edgeId(src, dst);

      if (age >= 0 && age < opts.fadeMs) {
        const v = 1 - age / opts.fadeMs;
        out.litEdges.set(id, Math.max(out.litEdges.get(id) ?? 0, v));
        out.litNodes.set(src, Math.max(out.litNodes.get(src) ?? 0, v));
        out.litNodes.set(dst, Math.max(out.litNodes.get(dst) ?? 0, v));
        if (flags) out.litFlaggedEdges.add(id);
      }
      if (age >= 0 && flags) {
        bumpFlag(out.flaggedEdges, id, high);
        bumpFlag(out.flaggedNodes, dst, high);
      }
      for (const th of throws) {
        if (th.handlerId !== hop.dst || th.at > t) continue;
        bump(out.thrownEdges, id);
        bump(out.thrownNodes, dst);
        if (t - th.at < opts.flashMs) {
          out.flashingEdges.add(id);
          out.flashingNodes.add(dst);
        }
      }
    }
  }
  return out;
}

/** Items inside the replay window, for lists and the histogram. */
export function inWindow(index: ReplayIndex, window: [number, number]): IndexedOccurrence[] {
  return index.items.filter((i) => i.occ.ts >= window[0] && i.occ.ts <= window[1]);
}

/**
 * How many of the ascending `times` have fired by playhead `t`. The playhead starts on the first event, so
 * counting is strict (an event at `t` hasn't ticked yet) and every counter starts at zero; at the end of the
 * window everything counts, so the counters finish on their totals.
 */
export function countFired(times: number[], t: number, end: number): number {
  if (t >= end) return times.length;
  let lo = 0;
  let hi = times.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid]! < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** "Auth.login ▸ Cart.cart:load": the chain of events that led to this one, root first. */
export function chainOf(index: ReplayIndex, occurrenceId: string): IndexedOccurrence[] {
  const chain: IndexedOccurrence[] = [];
  const seen = new Set<string>();
  let cur = index.byId.get(occurrenceId);
  while (cur && !seen.has(cur.occ.id)) {
    seen.add(cur.occ.id);
    chain.unshift(cur);
    cur = cur.occ.parentId ? index.byId.get(cur.occ.parentId) : undefined;
  }
  return chain;
}

export type ChainStep = { kind: 'event'; item: IndexedOccurrence } | { kind: 'handler'; nodeId: string };

/**
 * The chain of events leading to `occurrenceId` with the handler that emitted each next event
 * between them, root first. `truncated` means the root's parent was evicted from the buffer.
 */
export function callChain(index: ReplayIndex, occurrenceId: string): { steps: ChainStep[]; truncated: boolean } {
  const chain = chainOf(index, occurrenceId);
  const steps: ChainStep[] = [];
  chain.forEach((item, k) => {
    // A root's source is its own emitter, which the event label already names.
    if (k > 0) steps.push({ kind: 'handler', nodeId: item.occ.sourceNodeId });
    steps.push({ kind: 'event', item });
  });
  const parentId = chain[0]?.occ.parentId;
  return { steps, truncated: !!parentId && !index.byId.has(parentId) };
}

export function eventLabel(index: ReplayIndex, item: IndexedOccurrence): string {
  const em = index.nodes.get(item.template.emitterId);
  return `${em?.label ?? '?'}.${item.template.eventName}`;
}
