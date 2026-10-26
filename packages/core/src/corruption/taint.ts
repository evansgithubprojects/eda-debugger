export interface TaintSource {
  occurrenceId: string;
  handlerId: string;
}

export interface TaintOptions {
  /** How long a failure keeps the failing handler/emitter suspect. */
  taintWindowMs: number;
  /** ...or for this many of its next emits, whichever runs out first. */
  taintCount: number;
  /** How many hops a flagged payload keeps tainting the events emitted because of it. */
  taintDepth: number;
}

export const defaultTaintOptions: TaintOptions = { taintWindowMs: 1000, taintCount: 5, taintDepth: 1 };

interface Entry {
  until: number;
  remaining: number;
  source: TaintSource;
}

export interface TaintInfo {
  source: TaintSource;
  depth: number;
}

export interface EmitFacts {
  sourceNodeId: string;
  emitterId: string;
  parentId: string | null;
  ts: number;
}

const MAX_FLAGGED = 2000;

export class TaintTracker {
  private handlers = new Map<string, Entry>();
  private emitters = new Map<string, Entry>();
  private flagged = new Map<string, TaintInfo>();

  constructor(private opts: TaintOptions = defaultTaintOptions) {}

  /** A handler threw, or an `error` event was emitted from it. */
  onError(handlerId: string | null, emitterId: string, occurrenceId: string, ts: number): void {
    const source = { occurrenceId, handlerId: handlerId ?? emitterId };
    const entry = (): Entry => ({ until: ts + this.opts.taintWindowMs, remaining: this.opts.taintCount, source });
    if (handlerId) this.handlers.set(handlerId, entry());
    this.emitters.set(emitterId, entry());
  }

  /** Is this emit suspect? Consumes one of the remaining taint emits. `forced` marks it as emitted during a failed invocation. */
  check(facts: EmitFacts, forced?: TaintSource): TaintInfo | null {
    if (forced) return { source: forced, depth: 0 };
    const h = this.live(this.handlers, facts.sourceNodeId, facts.ts);
    const e = this.live(this.emitters, facts.emitterId, facts.ts);
    for (const entry of [h, e]) if (entry) entry.remaining--;
    const direct = h ?? e;
    if (direct) return { source: direct.source, depth: 0 };
    const parent = facts.parentId ? this.flagged.get(facts.parentId) : undefined;
    if (parent && parent.depth + 1 <= this.opts.taintDepth) return { source: parent.source, depth: parent.depth + 1 };
    return null;
  }

  /** Only flagged payloads taint what is emitted because of them. */
  markFlagged(occurrenceId: string, info: TaintInfo): void {
    this.flagged.set(occurrenceId, info);
    if (this.flagged.size > MAX_FLAGGED) this.flagged.delete(this.flagged.keys().next().value as string);
  }

  clear(): void {
    this.handlers.clear();
    this.emitters.clear();
    this.flagged.clear();
  }

  private live(map: Map<string, Entry>, id: string, ts: number): Entry | undefined {
    const entry = map.get(id);
    if (!entry) return undefined;
    if (entry.remaining <= 0 || ts > entry.until) {
      map.delete(id);
      return undefined;
    }
    return entry;
  }
}
