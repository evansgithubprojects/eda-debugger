import { createRecorder, type Recorder, type RecorderOptions } from './recorder';

export * from './types';
export { createRecorder } from './recorder';
export type {
  CorruptionOptions, DispatchInfo, FindingNotifier, Frame, Invoke, Recorder, RecorderOptions,
} from './recorder';
export { payloadShape, defaultTemplateKey, TemplateRegistry } from './templates';
export type { TemplateKeyFn, TemplateParts } from './templates';
export { RingBuffer } from './buffer';
export { SyncStackContext } from './causality';
export type { CausalityContext } from './causality';
export type { CaptureRule } from './capture';
export { toJsonSafe, isTag } from './json';
export { analyze, SuspectedCorruptionError, CorruptionEngine } from './corruption';

let shared: Recorder | undefined;

/** One-line setup: creates (once) and returns the shared recorder that adapters attach to by default. */
export function enable(opts?: RecorderOptions): Recorder {
  return (shared ??= createRecorder(opts));
}

export function getRecorder(): Recorder | undefined {
  return shared;
}
