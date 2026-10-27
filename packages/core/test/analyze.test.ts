import { describe, expect, it } from 'vitest';
import { analyze, createRecorder } from '../src';

function build() {
  let t = 0;
  const rec = createRecorder({ deepLogging: { events: ['ok'] }, now: () => (t += 1) });
  const emitter = {};
  const send = (name: string, payload?: unknown, handlers: Function[] = []) =>
    rec.dispatch({ emitter, label: 'P', eventName: name, handlers, payload }, (invoke) => handlers.forEach((h) => invoke(h, () => h(payload))));
  for (let i = 0; i < 6; i++) send('ok', { id: `a${100 + i}`, n: i, tags: ['x'] });
  return { rec, send };
}

describe('analyze', () => {
  it('reproduces live findings from the exported recording', () => {
    const { rec, send } = build();
    const bad = function failing() {
      send('ok', { id: 'zzz', n: 'seven', tags: [] });
      throw new Error('late');
    };
    expect(() => send('trigger', undefined, [bad])).toThrow();
    const live = rec.export().findings!;
    const again = analyze(JSON.parse(JSON.stringify(rec.export())));
    expect(again.map((f) => f.occurrenceId)).toEqual(live.map((f) => f.occurrenceId));
    expect(again[0]!.reasons.map((r) => r.code)).toContain('type-change');
    expect(again[0]!.retroactive).toBe(true);
  });

  it('flags a corrupt payload with no error thrown, without a source error', () => {
    const { rec, send } = build();
    send('ok', { id: 'weird', n: 'nine', tags: [] });
    const [f] = rec.export().findings!;
    expect(f!.taintSource).toBeNull();
    expect(f!.confidence).not.toBe('high');
    expect(f!.summary).toContain('no error thrown');
    expect(analyze(rec.export()).map((x) => x.occurrenceId)).toEqual([f!.occurrenceId]);
  });

  it('does not flag clean traffic or events without enough baseline', () => {
    const { rec, send } = build();
    send('ok', { id: 'a200', n: 7, tags: ['x'] });
    send('fresh', { whatever: true });
    expect(rec.export().findings ?? []).toEqual([]);
  });

  it('can leave untainted payloads alone', () => {
    let t = 0;
    const rec = createRecorder({ deepLogging: { events: ['ok'] }, now: () => (t += 1), corruption: { detectUntainted: false } });
    const emitter = {};
    const send = (payload: unknown) => rec.dispatch({ emitter, label: 'P', eventName: 'ok', handlers: [], payload }, () => {});
    for (let i = 0; i < 6; i++) send({ id: `a${100 + i}`, n: i, tags: ['x'] });
    send({ id: 'weird', n: 'nine', tags: [] });
    expect(analyze(rec.export(), { detectUntainted: false })).toEqual([]);
  });

  it('detects missing fields, empties, outliers, formats and stale payloads after an error event', () => {
    const { rec, send } = build();
    send('error', new Error('x'));
    send('ok', { n: 1000000, tags: [] });
    const codes = rec.export().findings!.flatMap((f) => f.reasons.map((r) => r.code));
    expect(codes).toEqual(expect.arrayContaining(['missing-field', 'empty-value', 'outlier']));
    const { rec: r2, send: s2 } = build();
    s2('error', new Error('x'));
    s2('ok', { id: 'a105', n: 5, tags: ['x'] });
    expect(r2.export().findings!.flatMap((f) => f.reasons.map((r) => r.code))).toContain('stale-payload');
    const { rec: r3, send: s3 } = build();
    s3('error', new Error('x'));
    s3('ok', { id: 'ZZ-1', n: 3, tags: ['x'] });
    expect(r3.export().findings!.flatMap((f) => f.reasons.map((r) => r.code))).toContain('format-change');
  });
});
