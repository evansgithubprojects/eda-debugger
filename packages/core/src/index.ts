import { createRecorder, type Recorder, type RecorderOptions } from './recorder';

// Setup
export { createRecorder } from './recorder';
export type { CorruptionOptions, FindingNotifier, Policy, Recorder, RecorderOptions } from './recorder';
export type { CaptureRule } from './capture';

// The recording format
export * from './types';
export { isTag } from './json';
export { analyze, SuspectedCorruptionError } from './corruption';

// Customization: template grouping and causality tracking
export { payloadShape, defaultTemplateKey } from './templates';
export type { TemplateKeyFn, TemplateParts } from './templates';
export { SyncStackContext } from './causality';
export type { CausalityContext } from './causality';

// For adapter authors
export type { DispatchInfo, Frame, Invoke } from './recorder';

let shared: Recorder | undefined;

/**
 * One-line setup: creates (once) and returns the shared recorder that adapters attach to by default.
 * `opts` only apply to the first call; later calls return the same recorder and ignore them.
 * @example
 * const recorder = enable({ windowMs: 60_000 });
 */
export function enable(opts?: RecorderOptions): Recorder {
  return (shared ??= createRecorder(opts));
}

/** The shared recorder created by `enable()`, or `undefined` if it hasn't been called. */
export function getRecorder(): Recorder | undefined {
  return shared;
}
