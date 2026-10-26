import { isTag } from '../json';
import type { DiffEntry, Reason } from '../types';

const MAX_PATH_DEPTH = 4;
const BAD_TAGS = new Set(['tag:undefined', 'tag:NaN', 'tag:Infinity', 'tag:-Infinity']);
const STRONG = new Set(['missing-field', 'bad-value', 'type-change']);
const ID_KEY = /(^|_)id$|Id$|uuid|key$/i;

export interface CheckResult {
  reasons: Reason[];
  diff: DiffEntry[];
  confidence: 'high' | 'medium' | 'low';
}

const pretty = (t: string) => t.replace(/^tag:/, '');

export function typeOf(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (isTag(v)) return `tag:${v.$eda}`;
  return typeof v;
}

function flatten(v: unknown, path = '', depth = 0, out = new Map<string, unknown>()): Map<string, unknown> {
  const plain = typeof v === 'object' && v !== null && !Array.isArray(v) && !isTag(v);
  if (!plain || depth >= MAX_PATH_DEPTH) {
    out.set(path, v);
    return out;
  }
  for (const [k, child] of Object.entries(v as Record<string, unknown>)) {
    flatten(child, path ? `${path}.${k}` : k, depth + 1, out);
  }
  return out;
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

const signature = (s: string) => s.replace(/[A-Z]/g, 'A').replace(/[a-z]/g, 'a').replace(/[0-9]/g, '9');

function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return (sorted[lo] as number) + ((sorted[hi] as number) - (sorted[lo] as number)) * (pos - lo);
}

function finish(reasons: Reason[], diff: DiffEntry[], sampleCount: number): CheckResult {
  const strong = reasons.filter((r) => STRONG.has(r.code)).length;
  const score = strong * 2 + (reasons.length - strong);
  let confidence: CheckResult['confidence'] = score >= 4 ? 'high' : score >= 2 ? 'medium' : 'low';
  if (sampleCount < 5 && confidence === 'high') confidence = 'medium';
  if (sampleCount < 3) confidence = 'low';
  return { reasons, diff, confidence };
}

/** Deep check: the payload (JSON-safe) against earlier untainted full payloads for the same event. */
export function checkAgainstSamples(payload: unknown, samples: unknown[]): CheckResult | null {
  if (samples.length < 2) return null;
  const reasons: Reason[] = [];
  const diff: DiffEntry[] = [];
  const add = (code: Reason['code'], path: string, message: string, baseline: unknown, actual: unknown) => {
    reasons.push({ code, path, message });
    diff.push({ path, baseline, actual });
  };

  const rootTypes = new Set(samples.map(typeOf));
  const rootType = typeOf(payload);
  if (!rootTypes.has(rootType)) {
    add(BAD_TAGS.has(rootType) || rootType === 'null' ? 'bad-value' : 'type-change', '',
      `payload is ${pretty(rootType)}, expected ${[...rootTypes].map(pretty).join('|')}`, samples[samples.length - 1], payload);
    return finish(reasons, diff, samples.length);
  }

  const baseFlat = samples.map((s) => flatten(s));
  const actual = flatten(payload);
  const first = baseFlat[0] as Map<string, unknown>;
  const commonPaths = [...first.keys()].filter((p) => baseFlat.every((m) => m.has(p)));

  for (const path of commonPaths) {
    const values = baseFlat.map((m) => m.get(path));
    const label = path || 'payload';
    if (!actual.has(path)) {
      add('missing-field', path, `${label} was always present before but is missing`, values[values.length - 1], undefined);
      continue;
    }
    const value = actual.get(path);
    const types = new Set(values.map(typeOf));
    const type = typeOf(value);

    if (!types.has(type)) {
      const bad = BAD_TAGS.has(type) || type === 'null';
      add(bad ? 'bad-value' : 'type-change', path, `${label} is ${pretty(type)}, was ${[...types].map(pretty).join('|')}`, values[values.length - 1], value);
    } else if (
      (Array.isArray(value) && value.length === 0 && values.every((x) => Array.isArray(x) && x.length > 0)) ||
      (value === '' && values.every((x) => typeof x === 'string' && x !== ''))
    ) {
      add('empty-value', path, `${label} is empty but never was before`, values[values.length - 1], value);
    } else if (typeof value === 'number' && values.length >= 5 && values.every((x) => typeof x === 'number')) {
      const sorted = (values as number[]).slice().sort((a, b) => a - b);
      const q1 = quantile(sorted, 0.25);
      const q3 = quantile(sorted, 0.75);
      const iqr = q3 - q1;
      if (iqr > 0 && (value < q1 - 3 * iqr || value > q3 + 3 * iqr)) {
        add('outlier', path, `${label}=${value} is far outside the usual range ${sorted[0]}..${sorted[sorted.length - 1]}`,
          [sorted[0], sorted[sorted.length - 1]], value);
      }
    } else if (typeof value === 'string' && ID_KEY.test(path.split('.').pop() ?? '') && values.every((x) => typeof x === 'string')) {
      const known = new Set((values as string[]).map(signature));
      if (!known.has(signature(value))) {
        add('format-change', path, `${label} has a different format than before`, values[values.length - 1], value);
      }
    }
  }

  if (samples.length >= 3 && deepEqual(payload, samples[samples.length - 1]) && !samples.every((s) => deepEqual(s, samples[0]))) {
    add('stale-payload', '', 'payload is identical to the previous one although payloads normally vary', samples[samples.length - 1], payload);
  }

  return reasons.length ? finish(reasons, diff, samples.length) : null;
}

/** Shape-only check: used when deep logging is off, so only shapes (not values) are known. */
export function checkShapes(shape: string, knownShapes: string[]): CheckResult | null {
  if (knownShapes.length === 0 || knownShapes.includes(shape)) return null;
  const reasons: Reason[] = [];
  const diff: DiffEntry[] = [];
  const knownTokens = new Set(knownShapes.flatMap((s) => s.match(/NaN|undefined|null/g) ?? []));
  for (const token of new Set(shape.match(/NaN|undefined|null/g) ?? [])) {
    if (!knownTokens.has(token)) reasons.push({ code: 'bad-value', path: '', message: `shape now contains ${token}` });
  }
  reasons.push({ code: 'shape-changed', path: '', message: 'payload shape differs from every shape seen before' });
  diff.push({ path: '', baseline: knownShapes.slice(-3), actual: shape });
  return { reasons, diff, confidence: 'low' };
}
