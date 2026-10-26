import { describe, expect, it } from 'vitest';
import { extendTrail, TRAIL_MAX, type Selection } from '../src/store';

type Sel = NonNullable<Selection>;
const node = (id: string): Sel => ({ type: 'node', id });
const edge = (id: string): Sel => ({ type: 'edge', id });

describe('inspection trail', () => {
  it('appends new selections in order', () => {
    let trail: Sel[] = [];
    for (const s of [node('a'), edge('a>b'), { type: 'occurrence', id: 'o1' } as Sel]) trail = extendTrail(trail, s);
    expect(trail.map((t) => t.id)).toEqual(['a', 'a>b', 'o1']);
  });

  it('goes back to a step that is already on the trail', () => {
    const trail = [node('a'), edge('a>b'), node('b')];
    expect(extendTrail(trail, edge('a>b')).map((t) => t.id)).toEqual(['a', 'a>b']);
  });

  it('treats the same id of a different kind as a different step', () => {
    expect(extendTrail([node('x')], edge('x'))).toHaveLength(2);
  });

  it('keeps only the most recent steps', () => {
    let trail: Sel[] = [];
    for (let i = 0; i < TRAIL_MAX + 3; i++) trail = extendTrail(trail, node(`n${i}`));
    expect(trail).toHaveLength(TRAIL_MAX);
    expect(trail[trail.length - 1]!.id).toBe(`n${TRAIL_MAX + 2}`);
  });
});
