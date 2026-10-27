export const RECORDING_VERSION = 1;

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export interface Process {
  id: string;
  label: string;
}

/** A node in the web: either a handler, or the emitter itself (root of events fired outside any handler). */
export interface GraphNode {
  id: string;
  processId: string;
  label: string;
  kind: 'handler' | 'emitter';
}

export interface Template {
  id: string;
  key: string;
  emitterId: string;
  eventName: string;
  handlerIds: string[];
  payloadShape: string;
  sampleCount: number;
  /** Set when this event reaches an external system (API, DB, third party): who, by label. */
  external?: string[];
}

export interface ErrorInfo {
  name: string;
  message: string;
  stack?: string;
}

export interface HandlerResult {
  handlerId: string;
  /** Start of the handler call, same clock as Occurrence.ts. */
  ts: number;
  durationMs: number;
  error?: ErrorInfo;
}

export interface Occurrence {
  id: string;
  templateId: string;
  /** The event that was being handled when this one was emitted. */
  parentId: string | null;
  /** The handler that was running when this was emitted, or the emitter node for root events. */
  sourceNodeId: string;
  ts: number;
  durationMs: number;
  handlerResults: HandlerResult[];
  /** 'template' = only the template (shape) is known; 'full' = payload below was captured. */
  capture: 'template' | 'full';
  payload?: JsonValue;
  /** 'inferred' is reserved for async hops once async context tracking lands. */
  causality: 'sync' | 'inferred';
  /** Emitted as an `error` event carrying an Error: treated as a taint signal. */
  signalsError?: boolean;
  /** Suspected-corrupt and policy was 'block': no handler was called. */
  blocked?: boolean;
}

export interface DiffEntry {
  path: string;
  baseline: unknown;
  actual: unknown;
}

export interface Reason {
  code: ReasonCode;
  path: string;
  message: string;
}

export type ReasonCode =
  | 'missing-field'
  | 'bad-value'
  | 'type-change'
  | 'empty-value'
  | 'outlier'
  | 'format-change'
  | 'stale-payload'
  | 'shape-changed';

export interface Finding {
  id: string;
  kind: 'suspected-corrupt';
  occurrenceId: string;
  ts: number;
  confidence: 'high' | 'medium' | 'low';
  /** 'deep' compared payload values against logged baselines; 'shape' only compared payload shapes. */
  basis: 'deep' | 'shape';
  reasons: Reason[];
  diff: DiffEntry[];
  /** The failure this payload is suspected to come from; null when it was flagged with no error thrown. */
  taintSource: { occurrenceId: string; handlerId: string } | null;
  /** Found after the fact (the payload was emitted before the handler threw). */
  retroactive: boolean;
  summary: string;
  /** 'high' when the suspect payload goes to an external system, which warrants prompt attention. */
  priority: 'high' | 'normal';
  externalTargets: string[];
}

export interface Recording {
  version: number;
  startedAt: number;
  processes: Process[];
  nodes: GraphNode[];
  templates: Template[];
  occurrences: Occurrence[];
  findings?: Finding[];
}

export type RecorderMessage =
  | { type: 'occurrence'; occurrence: Occurrence; template: Template; nodes: GraphNode[]; processes: Process[] }
  | { type: 'finding'; finding: Finding }
  | { type: 'snapshot'; recording: Recording };
