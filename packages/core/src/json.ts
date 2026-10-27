import type { JsonValue } from './types';

/** Values JSON cannot carry are encoded as `{ "$eda": <kind> }` so they survive export and stay comparable. */
export const TAG = '$eda';

export function isTag(v: unknown, kind?: string): v is { $eda: string } {
  return (
    typeof v === 'object' && v !== null && !Array.isArray(v) &&
    typeof (v as Record<string, unknown>)[TAG] === 'string' &&
    (kind === undefined || (v as Record<string, unknown>)[TAG] === kind)
  );
}

/** @internal */
export interface JsonSafeOptions {
  maxDepth?: number;
  maxKeys?: number;
  maxItems?: number;
  maxString?: number;
}

/**
 * Converts any value to JSON-safe data, tagging what JSON can't carry and capping depth and size.
 * @internal
 */
export function toJsonSafe(value: unknown, opts: JsonSafeOptions = {}): JsonValue {
  const { maxDepth = 6, maxKeys = 100, maxItems = 100, maxString = 2000 } = opts;
  const ancestors = new Set<object>();

  const walk = (v: unknown, depth: number): JsonValue => {
    switch (typeof v) {
      case 'undefined': return { [TAG]: 'undefined' };
      case 'boolean': return v;
      case 'string': return v.length > maxString ? v.slice(0, maxString) + '…' : v;
      case 'number':
        if (Number.isNaN(v)) return { [TAG]: 'NaN' };
        if (v === Infinity) return { [TAG]: 'Infinity' };
        if (v === -Infinity) return { [TAG]: '-Infinity' };
        return v;
      case 'bigint': return { [TAG]: 'bigint', v: v.toString() };
      case 'symbol': return { [TAG]: 'symbol', v: v.toString() };
      case 'function': return { [TAG]: 'Function', v: v.name || 'anonymous' };
    }
    if (v === null) return null;
    const obj = v as object;
    if (ancestors.has(obj)) return { [TAG]: 'Circular' };
    if (depth >= maxDepth) return { [TAG]: 'Truncated' };
    if (obj instanceof Date) return { [TAG]: 'Date', v: Number.isNaN(obj.getTime()) ? 'Invalid' : obj.toISOString() };
    if (obj instanceof Error) return { [TAG]: 'Error', name: obj.name, message: obj.message };
    ancestors.add(obj);
    try {
      if (Array.isArray(obj)) return obj.slice(0, maxItems).map((x) => walk(x, depth + 1));
      if (obj instanceof Set) return { [TAG]: 'Set', v: [...obj].slice(0, maxItems).map((x) => walk(x, depth + 1)) };
      if (obj instanceof Map) {
        return { [TAG]: 'Map', v: [...obj].slice(0, maxItems).map(([k, x]) => [walk(k, depth + 1), walk(x, depth + 1)]) };
      }
      const out: { [k: string]: JsonValue } = {};
      for (const key of Object.keys(obj).slice(0, maxKeys)) {
        let child: unknown;
        try { child = (obj as Record<string, unknown>)[key]; } catch { child = { [TAG]: 'Unreadable' }; }
        out[key] = walk(child, depth + 1);
      }
      return out;
    } finally {
      ancestors.delete(obj);
    }
  };

  return walk(value, 0);
}
