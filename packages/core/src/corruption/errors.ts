import type { Finding } from '../types';

export class SuspectedCorruptionError extends Error {
  constructor(public readonly finding: Finding) {
    super(`Blocked emit: ${finding.summary}`);
    this.name = 'SuspectedCorruptionError';
  }
}
