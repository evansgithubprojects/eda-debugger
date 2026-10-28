import { describe, expect, it } from 'vitest';
import { createRecorder, type Recording } from '@eda-debugger/core';
import { activeAt, activityOf, buildIndex, callChain, chainOf, edgeId, isProblemRun, parseRunId, runById, runId, throwId, throwIdFor, errorCode, notifications } from '../src/replay';

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
    const during = activeAt(index, threw + 10, opts);
    expect(during.flashingNodes.has(charge)).toBe(true);
    expect(during.thrownNodes.get(charge)).toBe(1);

    const after = activeAt(index, threw + 1000, opts);
    expect(after.flashingNodes.size).toBe(0);
    expect(after.thrownNodes.get(charge)).toBe(1);
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

describe('callChain', () => {
  it('puts the emitting handler between events', () => {
    const rec = recordShop();
    const index = buildIndex(rec);
    const last = index.items[index.items.length - 1]!;
    const { steps, truncated } = callChain(index, last.occ.id);
    const label = (s: (typeof steps)[number]) => (s.kind === 'event' ? s.item.template.eventName : rec.nodes.find((n) => n.id === s.nodeId)!.label);
    expect(steps.map(label)).toEqual(['go', expect.stringContaining('start'), 'pay']);
    expect(truncated).toBe(false);
  });

  it('is a single step for a root event', () => {
    const index = buildIndex(recordShop());
    expect(callChain(index, index.items[0]!.occ.id).steps).toHaveLength(1);
  });

  it('flags a chain whose parent was evicted', () => {
    const index = buildIndex(recordShop());
    const last = index.items[index.items.length - 1]!;
    index.byId.delete(last.occ.parentId!);
    const { steps, truncated } = callChain(index, last.occ.id);
    expect(steps).toHaveLength(1);
    expect(truncated).toBe(true);
  });
});

describe('external nodes', () => {
  it('marks only the handlers that deliver to an external system', () => {
    let t = 0;
    const rec = createRecorder({ now: () => (t += 10) });
    const a = {};
    rec.labelEmitter(a, 'A');
    const post = function postToApi() { /* external */ };
    const local = function local() { /* internal */ };
    rec.markExternal(post);
    rec.dispatch({ emitter: a, eventName: 'save', handlers: [post, local], payload: { n: 1 } }, (invoke) => [post, local].forEach((h) => invoke(h, () => h())));
    const recording = rec.export();
    const index = buildIndex(recording);
    const id = (label: string) => recording.nodes.find((n) => n.label.startsWith(label))!.id;
    expect(index.externalNodes.has(id('postToApi'))).toBe(true);
    expect(index.externalNodes.has(id('local'))).toBe(false);
  });
});

describe('handler activity', () => {
  const rec = recordShop();
  const index = buildIndex(rec);
  const nodeId = (label: string) => rec.nodes.find((n) => n.label.startsWith(label))!.id;
  const window: [number, number] = [index.start, index.end];

  it('lists what a handler handled and emitted, and which runs are problems', () => {
    const runs = activityOf(index, window, nodeId('start'));
    expect(runs.map((r) => r.dir)).toEqual(['handled', 'emitted']);
    expect(runs.some((r) => isProblemRun(index, r))).toBe(false);
    const charge = activityOf(index, window, nodeId('charge'));
    expect(charge).toHaveLength(1);
    expect(charge[0]).toMatchObject({ dir: 'handled', error: 'declined' });
    expect(isProblemRun(index, charge[0]!)).toBe(true);
  });

  it('finds a run again from its id, even when the ids contain odd characters', () => {
    const [run] = activityOf(index, window, nodeId('charge'));
    expect(runById(index, run!.id)).toMatchObject({ id: run!.id, dir: 'handled', error: 'declined' });
    const odd = runId(run!.item.occ.id, 'a|"b', 'emitted');
    expect(parseRunId(index, odd)).toEqual({ occurrenceId: run!.item.occ.id, nodeId: 'a|"b', dir: 'emitted' });
    expect(parseRunId(index, 'not json')).toBeNull();
    expect(parseRunId(index, runId('gone', 'x', 'handled'))).toBeNull();
  });
});

describe('throwIdFor', () => {
  const rec = recordShop();
  const index = buildIndex(rec);
  const [go, pay] = index.items;
  const nodeId = (label: string) => rec.nodes.find((n) => n.label.startsWith(label))!.id;

  it('names the error only where that handler threw', () => {
    expect(throwIdFor(index, pay!.occ.id, nodeId('charge'))).toBe(throwId(pay!.occ.id, nodeId('charge')));
    expect(throwIdFor(index, go!.occ.id, nodeId('start'))).toBeNull();
    expect(throwIdFor(index, go!.occ.id, nodeId('charge'))).toBeNull();
  });
});

describe('errorCode', () => {
  it('is short, stable and tells different errors apart', () => {
    expect(errorCode('o1|h1')).toMatch(/^[0-9A-Z]{6}$/);
    expect(errorCode('o1|h1')).toBe(errorCode('o1|h1'));
    expect(errorCode('o1|h1')).not.toBe(errorCode('o1|h2'));
  });
});

describe('an error that propagates', () => {
  function recordPropagation(): Recording {
    let t = 0;
    const rec = createRecorder({ now: () => (t += 10) });
    const a = {};
    const b = {};
    rec.labelEmitter(a, 'A');
    rec.labelEmitter(b, 'B');
    const send = (e: object, name: string, handlers: Function[]) =>
      rec.dispatch({ emitter: e, eventName: name, handlers, payload: undefined }, (invoke) => handlers.forEach((h) => invoke(h, () => h())));
    const inner = function inner() { throw new Error('gateway timeout'); };
    const outer = function outer() { send(b, 'charge', [inner]); };
    try { send(a, 'checkout', [outer]); } catch { /* both threw */ }
    return rec.export();
  }
  const rec = recordPropagation();
  const index = buildIndex(rec);
  const nodeId = (label: string) => rec.nodes.find((n) => n.label.startsWith(label))!.id;
  const [checkout, charge] = index.items;

  it('is one error in every handler it passed through', () => {
    const origin = throwId(charge!.occ.id, nodeId('inner'));
    expect(throwIdFor(index, charge!.occ.id, nodeId('inner'))).toBe(origin);
    expect(throwIdFor(index, checkout!.occ.id, nodeId('outer'))).toBe(origin);
    expect(index.propagations.get(origin)).toEqual([{ occurrenceId: checkout!.occ.id, handlerId: nodeId('outer') }]);
  });

  it('is announced once and marks only the handler that first threw it', () => {
    expect(notifications(index, index.items).filter((n) => n.kind === 'throw')).toHaveLength(1);
    const active = activeAt(index, index.end + 1000, { fadeMs: 100, flashMs: 50 });
    expect([...active.thrownNodes.keys()]).toEqual([nodeId('inner')]);
  });
});
