import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';
import { createRecorder } from '@eda-debugger/core';
import { enableNodeRecording } from '../src';

let uninstall: (() => void) | undefined;
afterEach(() => uninstall?.());

describe('node adapter', () => {
  it('records the parent chain across emitters', () => {
    const rec = createRecorder();
    uninstall = enableNodeRecording(rec);
    const a = new EventEmitter();
    const b = new EventEmitter();
    rec.labelEmitter(a, 'A');
    rec.labelEmitter(b, 'B');
    b.on('leaf', function onLeaf() {});
    a.on('root', function onRoot() { b.emit('leaf', 1); });
    a.emit('root', { x: 1 });
    const r = rec.export();
    expect(r.occurrences.map((o) => r.templates.find((t) => t.id === o.templateId)!.eventName)).toEqual(['root', 'leaf']);
    expect(r.occurrences[1]!.parentId).toBe(r.occurrences[0]!.id);
  });

  it('keeps emit semantics: order, return value, once, and error propagation', () => {
    const rec = createRecorder();
    uninstall = enableNodeRecording(rec);
    const e = new EventEmitter();
    const order: number[] = [];
    e.on('x', () => order.push(1));
    e.once('x', () => order.push(2));
    e.on('x', () => order.push(3));
    expect(e.emit('x')).toBe(true);
    expect(e.emit('x')).toBe(true);
    expect(order).toEqual([1, 2, 3, 1, 3]);
    expect(e.emit('nobody')).toBe(false);
    expect(() => e.emit('error', new Error('unhandled'))).toThrow('unhandled');
    e.on('bad', () => { throw new Error('in handler'); });
    expect(() => e.emit('bad')).toThrow('in handler');
    const bad = rec.export().occurrences.find((o) => o.handlerResults.some((h) => h.error));
    expect(bad).toBeDefined();
  });

  it('uninstall restores the original emit', () => {
    const original = EventEmitter.prototype.emit;
    const un = enableNodeRecording(createRecorder());
    expect(EventEmitter.prototype.emit).not.toBe(original);
    un();
    expect(EventEmitter.prototype.emit).toBe(original);
  });

  it('ignores Node internals such as streams by default', async () => {
    const { PassThrough } = await import('node:stream');
    const rec = createRecorder();
    uninstall = enableNodeRecording(rec);
    const s = new PassThrough();
    s.on('data', () => {});
    s.write('hi');
    expect(rec.export().occurrences).toHaveLength(0);
  });
});
