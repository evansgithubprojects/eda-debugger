import { describe, expect, it, vi } from 'vitest';
import { analyze, createRecorder, type Recorder } from '../src';

/** A tiny synchronous emitter on top of recorder.dispatch, so core is tested without an adapter. */
class Bus {
  private map = new Map<string, Function[]>();
  constructor(private rec: Recorder, public label: string) {}
  on(name: string, fn: Function) { this.map.set(name, [...(this.map.get(name) ?? []), fn]); }
  emit(name: string, payload?: unknown) {
    const handlers = this.map.get(name) ?? [];
    return this.rec.dispatch({ emitter: this, label: this.label, eventName: name, handlers, payload }, (invoke) => {
      for (const h of handlers) invoke(h, () => h(payload));
    });
  }
}

describe('recorder', () => {
  it('links nested emits to the event and handler that caused them', () => {
    const rec = createRecorder();
    const a = new Bus(rec, 'A');
    const b = new Bus(rec, 'B');
    const onStart = () => b.emit('mid', 1);
    const onMid = () => {};
    a.on('start', onStart);
    b.on('mid', onMid);
    a.emit('start', { n: 1 });

    const r = rec.export();
    const [start, mid] = r.occurrences;
    expect(start!.parentId).toBeNull();
    expect(mid!.parentId).toBe(start!.id);
    const handlerNode = r.nodes.find((n) => n.label === 'onStart')!;
    expect(mid!.sourceNodeId).toBe(handlerNode.id);
    expect(start!.sourceNodeId).toBe(r.nodes.find((n) => n.kind === 'emitter' && n.label === 'A')!.id);
    expect(r.processes.map((p) => p.label).sort()).toEqual(['A', 'B']);
  });

  it('groups repeated events into one template and stores template-only by default', () => {
    const rec = createRecorder();
    const a = new Bus(rec, 'A');
    a.on('tick', () => {});
    a.emit('tick', { v: 1 });
    a.emit('tick', { v: 2 });
    a.emit('tick', { v: 'x' });
    const r = rec.export();
    expect(r.templates).toHaveLength(2);
    expect(r.occurrences.every((o) => o.capture === 'template' && o.payload === undefined)).toBe(true);
  });

  it('opts in to full capture per event', () => {
    const rec = createRecorder({ deepLogging: { events: ['keep'] } });
    const a = new Bus(rec, 'A');
    a.emit('keep', { v: NaN });
    a.emit('drop', { v: 1 });
    const [keep, drop] = rec.export().occurrences;
    expect(keep!.capture).toBe('full');
    expect(keep!.payload).toEqual({ v: { $eda: 'NaN' } });
    expect(drop!.capture).toBe('template');
  });

  it('records handler errors and rethrows', () => {
    const rec = createRecorder();
    const a = new Bus(rec, 'A');
    a.on('boom', function bad() { throw new Error('nope'); });
    expect(() => a.emit('boom')).toThrow('nope');
    const [o] = rec.export().occurrences;
    expect(o!.handlerResults[0]!.error).toMatchObject({ name: 'Error', message: 'nope' });
  });

  it('evicts old occurrences and their templates, and survives a JSON round trip', () => {
    const rec = createRecorder({ maxEvents: 2 });
    const a = new Bus(rec, 'A');
    a.emit('one', 1);
    a.emit('two', 2);
    a.emit('three', 3);
    const r = rec.export();
    expect(r.occurrences).toHaveLength(2);
    expect(r.templates.map((t) => t.eventName).sort()).toEqual(['three', 'two']);
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
  });

  it('does nothing while stopped and streams messages to subscribers', () => {
    const rec = createRecorder();
    const a = new Bus(rec, 'A');
    const seen: string[] = [];
    rec.subscribe((m) => seen.push(m.type));
    rec.stop();
    a.emit('x');
    expect(rec.export().occurrences).toHaveLength(0);
    rec.start();
    a.emit('x');
    expect(seen).toEqual(['occurrence']);
  });
});

describe('corruption detection (live)', () => {
  /** Payments handler fails after Cart's order events have established a baseline. */
  function setup(opts: Parameters<typeof createRecorder>[0] = {}) {
    let t = 0;
    const rec = createRecorder({ deepLogging: { events: ['order:confirmed'] }, now: () => (t += 1), ...opts });
    const bus = new Bus(rec, 'Payments');
    const order = (i: number) => ({ id: `ord_${1000 + i}`, total: 10 + i, items: ['a'] });
    for (let i = 0; i < 6; i++) bus.emit('order:confirmed', order(i));
    return { rec, bus, order };
  }

  it('flags a payload emitted before the handler threw (retroactive)', () => {
    const { rec, bus, order } = setup();
    const downstream = vi.fn();
    const found: string[] = [];
    const rec2 = rec;
    rec2.subscribe((m) => m.type === 'finding' && found.push(m.finding.reasons.map((r) => r.code).join()));
    bus.on('pay', function charge() {
      bus.emit('order:confirmed', { ...order(7), total: undefined });
      throw new Error('gateway down');
    });
    bus.on('order:confirmed', downstream);
    expect(() => bus.emit('pay')).toThrow('gateway down');
    const findings = rec.export().findings!;
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ retroactive: true, basis: 'deep' });
    expect(found[0]).toContain('bad-value');
  });

  it('flags an emit that follows an error event, before handlers run, and can block it', () => {
    const calls: string[] = [];
    const { bus, order } = setup({ corruption: { notify: (f) => calls.push(`notify:${f.confidence}`), policy: 'block' } });
    const handler = () => calls.push('handler');
    bus.on('order:confirmed', handler);
    bus.emit('error', new Error('card declined'));
    expect(() => bus.emit('order:confirmed', { ...order(8), total: NaN })).toThrow(/Blocked emit/);
    expect(calls[0]).toMatch(/^notify:/);
    expect(calls).not.toContain('handler');
  });

  it('notifies before handlers run when policy is notify', () => {
    const calls: string[] = [];
    const { bus, order } = setup({ corruption: { notify: (f) => calls.push('notify') } });
    bus.on('order:confirmed', () => calls.push('handler'));
    bus.emit('error', new Error('x'));
    bus.emit('order:confirmed', { id: 'bad', total: 5 });
    expect(calls).toEqual(['notify', 'handler']);
    void order;
  });

  it('does not flag clean payloads after an error, or emits outside the taint window', () => {
    let t = 0;
    const { bus, order, rec } = setup({ now: () => (t += 1), corruption: { taintWindowMs: 5 } });
    bus.emit('error', new Error('x'));
    bus.emit('order:confirmed', order(9));
    expect(rec.export().findings).toHaveLength(0);
    bus.emit('error', new Error('y'));
    for (let i = 0; i < 20; i++) bus.emit('noop');
    bus.emit('order:confirmed', { id: 'bad' });
    expect(rec.export().findings).toHaveLength(0);
  });

  it('prints nothing when notify is off', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { bus } = setup();
    bus.emit('error', new Error('x'));
    bus.emit('order:confirmed', { id: 'bad' });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('falls back to low-confidence shape comparison when deep logging is off', () => {
    const rec = createRecorder();
    const bus = new Bus(rec, 'P');
    for (let i = 0; i < 3; i++) bus.emit('done', { id: 'a', total: i });
    bus.emit('error', new Error('x'));
    bus.emit('done', { id: 'a', total: NaN });
    const [f] = rec.export().findings!;
    expect(f).toMatchObject({ basis: 'shape', confidence: 'low' });
  });
});

describe('external systems', () => {
  function build(extra: Parameters<typeof createRecorder>[0] = {}) {
    let t = 0;
    const rec = createRecorder({ deepLogging: { events: ['order'] }, now: () => (t += 1), ...extra });
    const bus = new Bus(rec, 'Shop');
    for (let i = 0; i < 4; i++) bus.emit('order', { id: `o${i}`, total: 10 + i });
    return { rec, bus };
  }

  it('ranks a corrupt payload headed to an external handler as high priority', () => {
    const calls: string[] = [];
    const callApi = function postToBilling() {};
    const { rec, bus } = build({ corruption: { notify: (f) => calls.push(f.priority), external: { handlers: [callApi] } } });
    bus.on('order', callApi);
    bus.emit('error', new Error('x'));
    bus.emit('order', { id: 'o9', total: NaN });
    const [f] = rec.export().findings!;
    expect(f).toMatchObject({ priority: 'high', externalTargets: ['postToBilling'] });
    expect(calls).toEqual(['high']);
    // analyze() agrees, using what the recording carries
    expect(analyze(rec.export())[0]).toMatchObject({ priority: 'high' });
  });

  it('keeps internal-only payloads at normal priority, and blocks external ones independently', () => {
    const { rec, bus } = build({ corruption: { policy: 'notify', externalPolicy: 'block' } });
    rec.markExternal(bus);
    bus.emit('error', new Error('x'));
    expect(() => bus.emit('order', { id: 'o9', total: NaN })).toThrow(/Blocked emit/);
    const { rec: r2, bus: b2 } = build({ corruption: { policy: 'notify', externalPolicy: 'block' } });
    b2.emit('error', new Error('x'));
    b2.emit('order', { id: 'o9', total: NaN });
    expect(r2.export().findings![0]!.priority).toBe('normal');
  });
});
