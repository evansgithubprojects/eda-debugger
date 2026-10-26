import { RingBuffer } from './buffer';
import { matchesCapture, type CaptureRule } from './capture';
import { SyncStackContext, type CausalityContext } from './causality';
import { CorruptionEngine, SuspectedCorruptionError, type Observation, type TaintOptions } from './corruption';
import { Registry } from './ids';
import { toJsonSafe } from './json';
import { payloadShape, TemplateRegistry, type TemplateKeyFn } from './templates';
import {
  RECORDING_VERSION, type ErrorInfo, type Finding, type HandlerResult, type Occurrence,
  type RecorderMessage, type Recording,
} from './types';

export type FindingNotifier = (finding: Finding) => void;

export interface CorruptionOptions extends Partial<TaintOptions> {
  /** Off by default. 'console' prints a warning; a function receives the finding; pass an array for both. */
  notify?: 'console' | FindingNotifier | Array<'console' | FindingNotifier>;
  /** 'notify' lets the event continue; 'block' throws from emit instead of calling any handler. */
  policy?: 'notify' | 'block';
  /** Policy for payloads headed to an external system. Defaults to `policy`. */
  externalPolicy?: 'notify' | 'block';
  /**
   * What counts as an external system (HTTP APIs, databases, third parties). Corrupt payloads reaching these are
   * reported as high priority. Also see `recorder.markExternal()`.
   */
  external?: {
    events?: string[] | ((eventName: string, emitterLabel: string) => boolean);
    handlers?: Function[];
    emitters?: object[];
  };
}

export interface RecorderOptions {
  windowMs?: number;
  maxEvents?: number;
  /** Deep logging: events listed here keep their full payload; all others are template-only. */
  deepLogging?: CaptureRule;
  /** Alias of deepLogging. */
  capture?: CaptureRule;
  templateKey?: TemplateKeyFn;
  corruption?: CorruptionOptions;
  context?: CausalityContext<Frame>;
  autoStart?: boolean;
  now?: () => number;
}

export interface DispatchInfo {
  emitter: object;
  /** Display name hint for the emitter's process, e.g. "Payments" or "button#save". */
  label?: string;
  eventName: string;
  handlers: Function[];
  payload: unknown;
}

/** Run one handler under the current event so emits inside it point back at it. */
export type Invoke = <R>(handler: Function, call: () => R) => R;

export interface Frame {
  eventId: string;
  handlerId: string;
  /** Emits made while this handler ran, kept so they can be flagged if it throws afterwards. */
  children: Observation[];
}

export interface Recorder {
  dispatch<T>(info: DispatchInfo, run: (invoke: Invoke) => T): T;
  start(): void;
  stop(): void;
  readonly recording: boolean;
  export(): Recording;
  clear(): void;
  subscribe(listener: (message: RecorderMessage) => void): () => void;
  labelEmitter(emitter: object, label: string): void;
  labelHandler(fn: Function, label: string): void;
  /** Mark a handler function or a whole emitter as delivering to an external system. */
  markExternal(target: object | Function): void;
}

const toErrorInfo = (err: unknown): ErrorInfo =>
  err instanceof Error
    ? { name: err.name, message: err.message, stack: err.stack }
    : { name: 'Error', message: String(err) };

const looksLikeError = (v: unknown): boolean =>
  v instanceof Error || (typeof v === 'object' && v !== null && 'message' in v && 'stack' in v);

function normalizeNotify(n: CorruptionOptions['notify']): FindingNotifier[] {
  return (Array.isArray(n) ? n : n ? [n] : []).map((x) =>
    x === 'console'
      ? (f: Finding) => (f.priority === 'high' ? console.error : console.warn)(
          `[eda-debugger] ${f.priority === 'high' ? 'HIGH PRIORITY ' : ''}${f.confidence} confidence${f.retroactive ? ' (retroactive)' : ''}: ${f.summary}`,
        )
      : x,
  );
}

export function createRecorder(opts: RecorderOptions = {}): Recorder {
  const now = opts.now ?? (() => performance.now());
  const origin = now();
  const startedAt = Date.now();
  const deepRule = opts.deepLogging ?? opts.capture;
  const registry = new Registry();
  const templates = new TemplateRegistry(opts.templateKey);
  const buffer = new RingBuffer<Occurrence>(opts.maxEvents ?? 50_000, opts.windowMs ?? 5 * 60_000);
  const ctx: CausalityContext<Frame> = opts.context ?? new SyncStackContext<Frame>();
  const engine = new CorruptionEngine(opts.corruption);
  const notifiers = normalizeNotify(opts.corruption?.notify);
  const consoleOn = [opts.corruption?.notify].flat().includes('console');
  const policy = opts.corruption?.policy ?? 'notify';
  const externalPolicy = opts.corruption?.externalPolicy ?? policy;
  const externalRule = opts.corruption?.external;
  const externalHandlers = new WeakSet<object>(externalRule?.handlers ?? []);
  const externalEmitters = new WeakSet<object>(externalRule?.emitters ?? []);
  const listeners = new Set<(m: RecorderMessage) => void>();
  let findings: Finding[] = [];
  let recording = opts.autoStart !== false;
  let seq = 0;

  const emit = (m: RecorderMessage) => listeners.forEach((l) => l(m));

  const report = (finding: Finding) => {
    findings.push(finding);
    // External payloads are always surfaced on the console too (as an error) when any notification is on.
    if (finding.priority === 'high' && notifiers.length && !consoleOn) {
      console.error(`[eda-debugger] HIGH PRIORITY ${finding.summary}`);
    }
    for (const n of notifiers) n(finding);
    emit({ type: 'finding', finding });
  };

  const evict = (items: Occurrence[]) => items.forEach((o) => templates.release(o.templateId));

  function dispatch<T>(info: DispatchInfo, run: (invoke: Invoke) => T): T {
    if (!recording) return run((_h, call) => call());

    const frame = ctx.current();
    const emitter = registry.emitter(info.emitter, info.label);
    const handlerIds = info.handlers.map((h) => registry.handler(h, emitter).id);
    const shape = payloadShape(info.payload);
    const template = templates.intern({ emitterId: emitter.node.id, eventName: info.eventName, handlerIds, payloadShape: shape });
    const ev = externalRule?.events;
    const externalTargets: string[] = [];
    if (externalEmitters.has(info.emitter) || (typeof ev === 'function' ? ev(info.eventName, emitter.process.label) : ev?.includes(info.eventName))) {
      externalTargets.push(`${emitter.process.label} → ${info.eventName}`);
    }
    for (const h of info.handlers) if (externalHandlers.has(h)) externalTargets.push(registry.handler(h, emitter).label);
    if (externalTargets.length) template.external = externalTargets;
    const deep = matchesCapture(deepRule, info.eventName, emitter.process.label);
    const payload = deep ? toJsonSafe(info.payload) : undefined;
    const ts = now() - origin;
    const id = `e${++seq}`;

    const occurrence: Occurrence = {
      id, templateId: template.id, parentId: frame?.eventId ?? null,
      sourceNodeId: frame?.handlerId ?? emitter.node.id, ts, durationMs: 0, handlerResults: [],
      capture: deep ? 'full' : 'template', ...(deep ? { payload } : {}), causality: 'sync',
    };
    const observation: Observation = {
      occurrenceId: id, parentId: occurrence.parentId, sourceNodeId: occurrence.sourceNodeId,
      emitterId: emitter.node.id, eventName: info.eventName, label: `${emitter.process.label} → ${info.eventName}`,
      shape, payload, ts, externalTargets: externalTargets.length ? externalTargets : undefined,
    };
    frame?.children.push(observation);

    const finding = engine.observe(observation);
    if (info.eventName === 'error' && looksLikeError(info.payload)) {
      occurrence.signalsError = true;
      engine.onError(frame?.handlerId ?? null, emitter.node.id, id, ts);
    }

    const finalize = () => {
      occurrence.durationMs = now() - origin - ts;
      const fresh = registry.drainFresh();
      emit({ type: 'occurrence', occurrence, template, nodes: fresh.nodes, processes: fresh.processes });
    };
    evict(buffer.push(occurrence));

    if (finding) {
      report(finding);
      if ((finding.priority === 'high' ? externalPolicy : policy) === 'block') {
        occurrence.blocked = true;
        finalize();
        throw new SuspectedCorruptionError(finding);
      }
    }

    const invoke: Invoke = (handler, call) => {
      const node = registry.handler(handler, emitter);
      const handlerFrame: Frame = { eventId: id, handlerId: node.id, children: [] };
      const result: HandlerResult = { handlerId: node.id, ts: now() - origin, durationMs: 0 };
      try {
        return ctx.run(handlerFrame, call);
      } catch (err) {
        result.error = toErrorInfo(err);
        engine.onError(node.id, emitter.node.id, id, now() - origin);
        for (const child of handlerFrame.children) {
          if (engine.isFlagged(child.occurrenceId)) continue;
          const late = engine.observe(child, { occurrenceId: id, handlerId: node.id });
          if (late) report({ ...late, retroactive: true });
        }
        throw err;
      } finally {
        result.durationMs = now() - origin - result.ts;
        occurrence.handlerResults.push(result);
      }
    };

    try {
      return run(invoke);
    } finally {
      finalize();
    }
  }

  return {
    dispatch,
    start() { recording = true; },
    stop() { recording = false; },
    get recording() { return recording; },
    export(): Recording {
      const occurrences = buffer.toArray();
      const kept = new Set(occurrences.map((o) => o.id));
      return {
        version: RECORDING_VERSION,
        startedAt,
        processes: [...registry.processes.values()],
        nodes: [...registry.nodes.values()],
        templates: templates.all().map((t) => ({ ...t })),
        occurrences: occurrences.map((o) => ({ ...o, handlerResults: o.handlerResults.slice() })),
        findings: findings.filter((f) => kept.has(f.occurrenceId)),
      };
    },
    clear() {
      evict(buffer.clear());
      templates.clear();
      engine.clear();
      findings = [];
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    labelEmitter: (e, l) => registry.labelEmitter(e, l),
    labelHandler: (f, l) => registry.labelHandler(f, l),
    markExternal: (t) => { (typeof t === 'function' ? externalHandlers : externalEmitters).add(t); },
  };
}
