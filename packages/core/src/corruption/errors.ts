import type { Finding } from '../types';

/**
 * Thrown from `emit` when `policy` (or `externalPolicy`) is `'block'` and the payload is suspect. No handler ran.
 * The `finding` says why.
 * @example
 * try { bus.emit('order:confirmed', order); } catch (e) { if (e instanceof SuspectedCorruptionError) log(e.finding.reasons); }
 */
export class SuspectedCorruptionError extends Error {
  constructor(public readonly finding: Finding) {
    super(`Blocked emit: ${finding.summary}`);
    this.name = 'SuspectedCorruptionError';
  }
}
