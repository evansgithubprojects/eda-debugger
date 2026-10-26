import { describe, expect, it } from 'vitest';
import { layout, NODE_H, NODE_W } from '../src/graph/layout';
import type { GraphModel, ModelNode } from '../src/graph/model';

const node = (id: string, kind: ModelNode['kind'] = 'handler'): ModelNode => ({ id, label: id, kind, processId: 'a', detail: '' });
const model = (nodes: ModelNode[], links: [string, string][] = []): GraphModel => ({
  nodes,
  edges: links.map(([source, target]) => ({ id: `${source}>${target}`, source, target, count: 1, times: [], events: [] })),
  mapNode: (id) => id,
});
const centre = (l: ReturnType<typeof layout>, id: string) => {
  const p = l.positions.get(id)!;
  return { x: p.x + NODE_W / 2, y: p.y + NODE_H / 2 };
};

describe('circular layout', () => {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
  const m = model(ids.map((i) => node(i)), [['a', 'b'], ['b', 'c'], ['c', 'd']]);
  const l = layout(m, false);

  it('puts every node the same distance from the origin', () => {
    const radii = ids.map((id) => Math.hypot(centre(l, id).x, centre(l, id).y));
    for (const r of radii) expect(r).toBeCloseTo(radii[0]!, 6);
  });

  it('keeps neighbours at least a card width apart', () => {
    const order = ids.map((id) => centre(l, id)).sort((p, q) => Math.atan2(p.y, p.x) - Math.atan2(q.y, q.x));
    for (let i = 0; i < order.length; i++) {
      const p = order[i]!;
      const q = order[(i + 1) % order.length]!;
      expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeGreaterThanOrEqual(NODE_W);
    }
  });

  it('is deterministic and follows the edges clockwise from the root', () => {
    expect([...layout(m, false).positions]).toEqual([...l.positions]);
    const angle = (id: string) => (Math.atan2(centre(l, id).y, centre(l, id).x) + Math.PI / 2 + 2 * Math.PI) % (2 * Math.PI);
    expect(angle('a')).toBeCloseTo(0, 6);
    expect(angle('a')).toBeLessThan(angle('b'));
    expect(angle('b')).toBeLessThan(angle('c'));
  });

  it('centres a lone node', () => {
    const c = centre(layout(model([node('x')]), false), 'x');
    expect(c.x).toBeCloseTo(0);
    expect(c.y).toBeCloseTo(0);
  });

  it('has no ring at the process level and a ring around the nodes at the handler level', () => {
    expect(l.ring).toBeNull();
    const withRing = layout(m, true);
    const r = Math.hypot(centre(withRing, 'a').x, centre(withRing, 'a').y);
    expect(withRing.ring!.radius).toBeGreaterThan(r + NODE_W / 2);
  });

  it('places other processes on an outer circle, clear of the ring', () => {
    const withStubs = layout(model([node('h1'), node('h2'), node('p:x', 'stub'), node('p:y', 'stub')], [['h1', 'p:x'], ['p:y', 'h2']]), true);
    for (const id of ['p:x', 'p:y']) {
      const c = centre(withStubs, id);
      expect(Math.hypot(c.x, c.y)).toBeGreaterThan(withStubs.ring!.radius + NODE_W / 2);
    }
  });
});
