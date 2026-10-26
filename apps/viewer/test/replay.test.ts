import { describe, expect, it } from 'vitest';
import { createRecorder, type Recording } from '@eda-debugger/core';
import { activeAt, buildIndex, chainOf, edgeId } from '../src/replay';

function recordShop(): Recording {
  let t = 0;
  const rec = createRecorder({ now: () => (t += 10), deepLogging: { events: ['pay'] } });
  const a = {};
  const b = {};
  rec.labelEmitter(a, 'A');
  rec.labelEmitter(b, 'B');
  const send = (e: object, name: string, handlers: Function[], payload?: unknown) =>
    rec.dispatch({ emitter: e, eventName: name, handlers, payload }, (invoke) => handlers.forEach((h) => invoke(h, () => h())));
  const charge = function charge() { throw new Error('declined'); };
  const start = function start() {
    try { send(b, 'pay', [charge], { n: 1 }); } catch { /* swallowed */ }
  };
  send(a, 'go', [start]);
  return rec.export();
}

const opts = { fadeMs: 100, flashMs: 50 };

describe('activeAt', () => {
  const rec = recordShop();
  const index = buildIndex(rec);
  const [go, pay] = index.items;
  const nodeId = (label: string) => rec.nodes.find((n) => n.label.startsWith(label))!.id;
  const start = nodeId('start');
  const charge = nodeId('charge');
  const emitterA = nodeId('A');

  it('lights the pathway an event travelled and fades it out', () => {
    const at = go!.occ.ts;
    expect(activeAt(index, at, opts).litEdges.get(edgeId(emitterA, start))).toBe(1);
    expect(activeAt(index, at + 50, opts).litEdges.get(edgeId(emitterA, start))).toBeCloseTo(0.5);
    expect(activeAt(index, at + 500, opts).litEdges.has(edgeId(emitterA, start))).toBe(false);
  });

  it('shows nothing from the future (scrubbing back)', () => {
    expect(activeAt(index, go!.occ.ts - 1, opts).litEdges.size).toBe(0);
  });

  it('flashes red at the throw, then keeps a persistent indicator', () => {
    const threw = pay!.throws[0]!.at;
    const edge = edgeId(start, charge);
    const during = activeAt(index, threw + 10, opts);
    expect(during.flashingNodes.has(charge)).toBe(true);
    expect(during.flashingEdges.has(edge)).toBe(true);
    expect(during.thrownNodes.get(charge)).toBe(1);

    const after = activeAt(index, threw + 1000, opts);
    expect(after.flashingNodes.size).toBe(0);
    expect(after.thrownNodes.get(charge)).toBe(1);
    expect(after.thrownEdges.get(edge)).toBe(1);
  });

  it('has no indicator before the throw, and none when scrubbing back past it', () => {
    const threw = pay!.throws[0]!.at;
    expect(activeAt(index, threw - 1, opts).thrownNodes.size).toBe(0);
    expect(activeAt(index, threw + 1000, opts).thrownNodes.size).toBe(1);
    expect(activeAt(index, threw - 1, opts).thrownNodes.size).toBe(0);
  });

  it('only considers occurrences inside the replay window', () => {
    const a = activeAt(index, pay!.occ.ts, { ...opts, window: [0, go!.occ.ts] });
    expect(a.litEdges.has(edgeId(start, charge))).toBe(false);
  });

  it('projects nodes through mapNode and drops self-edges', () => {
    const toProcess = (id: string) => rec.nodes.find((n) => n.id === id)!.processId;
    const a = activeAt(index, pay!.occ.ts, { ...opts, mapNode: toProcess });
    const procA = toProcess(emitterA);
    const procB = toProcess(charge);
    expect(a.litEdges.get(edgeId(procA, procB))).toBeDefined();
    expect([...a.litEdges.keys()].every((k) => { const [s, d] = k.split('>'); return s !== d; })).toBe(true);
  });
});

describe('chainOf', () => {
  it('walks parent links root first', () => {
    const index = buildIndex(recordShop());
    const last = index.items[index.items.length - 1]!;
    expect(chainOf(index, last.occ.id).map((i) => i.template.eventName)).toEqual(['go', 'pay']);
  });
});
