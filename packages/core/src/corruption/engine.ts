import { checkAgainstSamples, checkShapes, type CheckResult } from './checks';
import { defaultTaintOptions, TaintTracker, type TaintOptions, type TaintSource } from './taint';
import type { Finding, JsonValue } from '../types';

const MAX_SAMPLES = 20;
const MAX_EVENT_KEYS = 500;
/** Clean observations an event needs before a payload with no failure behind it is compared to its baseline. */
const MIN_UNTAINTED_BASELINE = 3;

export interface EngineOptions extends Partial<TaintOptions> {
  /**
   * Also flag suspect payloads that no failure points to; these findings have `taintSource: null`.
   * @default true
   */
  detectUntainted?: boolean;
}

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
 * Emits made by a recently failed handler/emitter, or forwarded from a flagged payload, are compared against
 * their baseline. Everything else is compared only under stricter rules (see `detectUntainted`) and otherwise
 * just feeds the baseline.
 * @internal
 */
export class CorruptionEngine {
  readonly taint: TaintTracker;
  private samples = new Map<string, Sample[]>();
  private shapes = new Map<string, string[]>();
  private clean = new Map<string, number>();
  private flaggedIds = new Set<string>();
  private unattributed = new Set<string>();
  private detectUntainted: boolean;
  private seq = 0;

  constructor({ detectUntainted = true, ...taint }: EngineOptions = {}) {
    this.taint = new TaintTracker({ ...defaultTaintOptions, ...taint });
    this.detectUntainted = detectUntainted;
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
    if (!info && !(this.detectUntainted && (this.clean.get(eventKey) ?? 0) >= MIN_UNTAINTED_BASELINE)) {
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

    // Without a failure behind it, a changed shape alone is normal variation; it takes a clearly bad value.
    if (!info && basis === 'shape' && !result?.reasons.some((r) => r.code === 'bad-value')) result = null;

    if (!result) {
      this.learn(eventKey, o);
      return null;
    }

    if (info) this.taint.markFlagged(o.occurrenceId, info);
    else this.unattributed.add(o.occurrenceId);
    this.flaggedIds.add(o.occurrenceId);
    return {
      id: `f${++this.seq}`,
      kind: 'suspected-corrupt',
      occurrenceId: o.occurrenceId,
      ts: o.ts,
      confidence: basis === 'shape' ? 'low' : !info && result.confidence === 'high' ? 'medium' : result.confidence,
      basis,
      reasons: result.reasons,
      diff: result.diff,
      taintSource: info?.source ?? null,
      retroactive: false,
      priority: o.externalTargets?.length ? 'high' : 'normal',
      externalTargets: o.externalTargets ?? [],
      summary: `${o.externalTargets?.length ? `EXTERNAL (${o.externalTargets.join(', ')}) ` : ''}suspected corrupt payload for ${o.label}${info ? '' : ' (no error thrown)'}: ${result.reasons.map((r) => r.message).join('; ')}`,
    };
  }

  /**
   * A payload flagged with no error behind it turns out to have been emitted inside an invocation that then threw.
   * Returns the finding re-pointed at that failure, or null when `finding` wasn't waiting for one.
   */
  attribute(finding: Finding, source: TaintSource): Finding | null {
    if (!this.unattributed.delete(finding.occurrenceId)) return null;
    this.taint.markFlagged(finding.occurrenceId, { source, depth: 0 });
    return { ...finding, taintSource: source, retroactive: true, summary: finding.summary.replace(' (no error thrown)', '') };
  }

  clear(): void {
    this.taint.clear();
    this.samples.clear();
    this.shapes.clear();
    this.flaggedIds.clear();
    this.unattributed.clear();
    this.clean.clear();
  }

  private learn(eventKey: string, o: Observation): void {
    if (!this.samples.has(eventKey) && !this.shapes.has(eventKey) && this.shapes.size >= MAX_EVENT_KEYS) {
      const oldest = this.shapes.keys().next().value as string;
      this.shapes.delete(oldest);
      this.samples.delete(oldest);
      this.clean.delete(oldest);
    }
    this.clean.set(eventKey, (this.clean.get(eventKey) ?? 0) + 1);
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
