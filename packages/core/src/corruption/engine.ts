import { checkAgainstSamples, checkShapes, type CheckResult } from './checks';
import { defaultTaintOptions, TaintTracker, type TaintOptions, type TaintSource } from './taint';
import type { Finding, JsonValue } from '../types';

const MAX_SAMPLES = 20;
const MAX_EVENT_KEYS = 500;

/** Everything the detector needs to know about one emit. */
export interface Observation {
  occurrenceId: string;
  parentId: string | null;
  sourceNodeId: string;
  emitterId: string;
  eventName: string;
  /** Pre-formatted for messages: "Payments → order:confirmed". */
  label: string;
  shape: string;
  /** Only present when the event is deep-logged. */
  payload?: JsonValue;
  ts: number;
  /** Labels of external systems this event is delivered to, if any. */
  externalTargets?: string[];
}

interface Sample {
  occurrenceId: string;
  payload: JsonValue;
}

/**
 * Shared by the live guard (runs before handlers are called) and the retroactive `analyze()`.
 * Only emits made by a recently failed handler/emitter, or forwarded from a flagged payload, are compared;
 * everything else just feeds the baseline.
 */
export class CorruptionEngine {
  readonly taint: TaintTracker;
  private samples = new Map<string, Sample[]>();
  private shapes = new Map<string, string[]>();
  private flaggedIds = new Set<string>();
  private seq = 0;

  constructor(opts: Partial<TaintOptions> = {}) {
    this.taint = new TaintTracker({ ...defaultTaintOptions, ...opts });
  }

  onError(handlerId: string | null, emitterId: string, occurrenceId: string, ts: number): void {
    this.taint.onError(handlerId, emitterId, occurrenceId, ts);
  }

  isFlagged(occurrenceId: string): boolean {
    return this.flaggedIds.has(occurrenceId);
  }

  /**
   * `forced` is set for emits that happened inside an invocation that later threw. Those were observed as clean
   * when they were emitted, so they are removed from the baseline before being compared.
   */
  observe(o: Observation, forced?: TaintSource): Finding | null {
    const eventKey = `${o.emitterId}|${o.eventName}`;
    if (forced) this.forget(eventKey, o.occurrenceId);

    const info = this.taint.check(o, forced);
    if (!info) {
      this.learn(eventKey, o);
      return null;
    }

    const samples = (this.samples.get(eventKey) ?? []).map((s) => s.payload);
    let basis: Finding['basis'] = 'deep';
    let result: CheckResult | null = null;
    if (o.payload !== undefined && samples.length >= 2) {
      result = checkAgainstSamples(o.payload, samples);
    } else {
      basis = 'shape';
      result = checkShapes(o.shape, this.shapes.get(eventKey) ?? []);
    }

    if (!result) {
      this.learn(eventKey, o);
      return null;
    }

    this.taint.markFlagged(o.occurrenceId, info);
    this.flaggedIds.add(o.occurrenceId);
    return {
      id: `f${++this.seq}`,
      kind: 'suspected-corrupt',
      occurrenceId: o.occurrenceId,
      ts: o.ts,
      confidence: basis === 'shape' ? 'low' : result.confidence,
      basis,
      reasons: result.reasons,
      diff: result.diff,
      taintSource: info.source,
      retroactive: false,
      priority: o.externalTargets?.length ? 'high' : 'normal',
      externalTargets: o.externalTargets ?? [],
      summary: `${o.externalTargets?.length ? `EXTERNAL (${o.externalTargets.join(', ')}) ` : ''}suspected corrupt payload for ${o.label}: ${result.reasons.map((r) => r.message).join('; ')}`,
    };
  }

  clear(): void {
    this.taint.clear();
    this.samples.clear();
    this.shapes.clear();
    this.flaggedIds.clear();
  }

  private learn(eventKey: string, o: Observation): void {
    if (!this.samples.has(eventKey) && !this.shapes.has(eventKey) && this.shapes.size >= MAX_EVENT_KEYS) {
      const oldest = this.shapes.keys().next().value as string;
      this.shapes.delete(oldest);
      this.samples.delete(oldest);
    }
    const shapes = this.shapes.get(eventKey) ?? [];
    if (!shapes.includes(o.shape)) shapes.push(o.shape);
    this.shapes.set(eventKey, shapes.slice(-20));
    if (o.payload !== undefined) {
      const list = this.samples.get(eventKey) ?? [];
      list.push({ occurrenceId: o.occurrenceId, payload: o.payload });
      this.samples.set(eventKey, list.slice(-MAX_SAMPLES));
    }
  }

  private forget(eventKey: string, occurrenceId: string): void {
    const list = this.samples.get(eventKey);
    if (list) this.samples.set(eventKey, list.filter((s) => s.occurrenceId !== occurrenceId));
  }
}
