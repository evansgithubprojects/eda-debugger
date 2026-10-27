import { EventEmitter } from 'node:events';
import { Server as NetServer } from 'node:net';
import { Stream } from 'node:stream';
import { enable, type Recorder } from '@eda-debugger/core';

export interface EventEmitterAdapterOptions {
  /** Return false to leave an emitter unrecorded. Runs after the built-in ignore list. */
  include?: (emitter: EventEmitter) => boolean;
  /** Also record Node internals (streams, sockets, servers, `process`). Noisy; off by default. */
  includeInternals?: boolean;
}

// Emitters Node creates for its own plumbing (fs handles, worker threads, child processes, ...).
const INTERNAL_CLASSES = new Set([
  'FileHandle', 'Worker', 'MessagePort', 'BroadcastChannel', 'ChildProcess', 'FSWatcher', 'StatWatcher',
]);

const isInternal = (e: EventEmitter): boolean =>
  e instanceof Stream || e instanceof NetServer || e === (process as unknown as EventEmitter) ||
  INTERNAL_CLASSES.has((e as { constructor?: { name?: string } }).constructor?.name ?? '');

/**
 * Patches `EventEmitter.prototype.emit` so every emit is recorded with its handlers, timings, errors and cause.
 * Behavior is unchanged: listeners run in the same order and errors propagate. Returns `uninstall()`.
 */
export function enableEventEmitterRecording(recorder: Recorder = enable(), options: EventEmitterAdapterOptions = {}): () => void {
  const proto = EventEmitter.prototype;
  const original = proto.emit;

  proto.emit = function patchedEmit(this: EventEmitter, name: string | symbol, ...args: unknown[]): boolean {
    if (!recorder.recording || (!options.includeInternals && isInternal(this)) || (options.include && !options.include(this))) {
      return original.call(this, name, ...args);
    }
    const raw = this.rawListeners(name) as Array<Function & { listener?: Function }>;
    const info = {
      emitter: this,
      eventName: String(name),
      handlers: raw.map((l) => l.listener ?? l),
      payload: args.length > 1 ? args : args[0],
    };
    // No listeners: nothing to time, and the original keeps Node's 'error' throwing semantics.
    if (raw.length === 0) return recorder.dispatch(info, () => original.call(this, name, ...args));
    return recorder.dispatch(info, (invoke) => {
      for (const l of raw) invoke(l.listener ?? l, () => l.apply(this, args));
      return true;
    });
  };

  return () => {
    if (proto.emit !== original) proto.emit = original;
  };
}

export { enable };
