import { describe, expect, it } from 'vitest';
import { extendTrail, TRAIL_MAX, useStore, type Selection } from '../src/store';

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

  it('replaces the last step with a sibling of the same kind', () => {
    const trail = [node('a'), edge('a>b'), node('b')];
    expect(extendTrail(trail, node('c')).map((t) => t.id)).toEqual(['a', 'a>b', 'c']);
    expect(extendTrail([edge('a>b'), { type: 'occurrence', id: 'o1' }], { type: 'occurrence', id: 'o2' }).map((t) => t.id)).toEqual(['a>b', 'o2']);
  });

  it('keeps only the most recent steps', () => {
    let trail: Sel[] = [];
    for (let i = 0; i < TRAIL_MAX + 3; i++) trail = extendTrail(trail, i % 2 ? edge(`n${i}`) : node(`n${i}`));
    expect(trail).toHaveLength(TRAIL_MAX);
    expect(trail[trail.length - 1]!.id).toBe(`n${TRAIL_MAX + 2}`);
  });

  it('starts a new trail from a graph click, since everything on the graph is a sibling', () => {
    const { select } = useStore.getState();
    select(node('a'), { fromGraph: true });
    select(node('b'));
    select(edge('a>b'), { fromGraph: true });
    expect(useStore.getState().trail.map((t) => t.id)).toEqual(['a>b']);
    select(null);
  });
});
