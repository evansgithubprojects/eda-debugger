import { describe, expect, it } from 'vitest';
import { payloadShape, TemplateRegistry } from '../src/templates';
import { RingBuffer } from '../src/buffer';

describe('payloadShape', () => {
  it('ignores key order and values', () => {
    expect(payloadShape({ b: 1, a: 'x' })).toBe(payloadShape({ a: 'y', b: 2 }));
    expect(payloadShape({ a: 'x', b: 1 })).toBe('{a:string,b:number}');
  });
  it('handles nesting, arrays, null, NaN and cycles', () => {
    expect(payloadShape({ items: [1, 2], u: { n: null } })).toBe('{items:number[],u:{n:null}}');
    expect(payloadShape([])).toBe('[]');
    expect(payloadShape(NaN)).toBe('NaN');
    const a: any = { x: 1 };
    a.self = a;
    expect(payloadShape(a)).toBe('{self:[Circular],x:number}');
  });
  it('tells different shapes apart', () => {
    expect(payloadShape({ a: 1 })).not.toBe(payloadShape({ a: 'x' }));
    expect(payloadShape({ a: 1 })).not.toBe(payloadShape({ a: NaN }));
  });
});

describe('TemplateRegistry', () => {
  const parts = { emitterId: 'em1', eventName: 'x', handlerIds: ['h1'], payloadShape: 'number' };
  it('dedupes by key and counts samples', () => {
    const reg = new TemplateRegistry();
    const a = reg.intern(parts);
    const b = reg.intern({ ...parts, handlerIds: ['h1'] });
    expect(a).toBe(b);
    expect(a.sampleCount).toBe(2);
    expect(reg.intern({ ...parts, payloadShape: 'string' })).not.toBe(a);
  });
  it('drops a template when its last occurrence is released', () => {
    const reg = new TemplateRegistry();
    const t = reg.intern(parts);
    reg.intern(parts);
    reg.release(t.id);
    expect(reg.get(t.id)).toBeDefined();
    reg.release(t.id);
    expect(reg.get(t.id)).toBeUndefined();
  });
  it('accepts a coarser key function', () => {
    const reg = new TemplateRegistry((p) => `${p.emitterId}|${p.eventName}`);
    expect(reg.intern(parts)).toBe(reg.intern({ ...parts, payloadShape: 'string' }));
  });
});

describe('RingBuffer', () => {
  it('evicts by count', () => {
    const b = new RingBuffer<{ ts: number }>(2, Infinity);
    b.push({ ts: 1 });
    b.push({ ts: 2 });
    expect(b.push({ ts: 3 })).toEqual([{ ts: 1 }]);
    expect(b.size).toBe(2);
  });
  it('evicts by time window but always keeps the newest', () => {
    const b = new RingBuffer<{ ts: number }>(100, 10);
    b.push({ ts: 0 });
    b.push({ ts: 5 });
    expect(b.push({ ts: 20 }).map((x) => x.ts)).toEqual([0, 5]);
    expect(b.toArray()).toEqual([{ ts: 20 }]);
  });
});
