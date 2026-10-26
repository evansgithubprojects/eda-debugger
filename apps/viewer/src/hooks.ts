import { useEffect, useMemo } from 'react';
import { buildModel, type GraphModel, type Level } from './graph/model';
import { activeAt, inWindow, type Active } from './replay';
import { FADE_WALL_MS, FLASH_WALL_MS, useStore } from './store';

/** The graph at `level`, or at the store's current level. A level passed in stays put while a zoom transition plays. */
export function useModel(levelOverride?: Level): GraphModel | null {
  const index = useStore((s) => s.index);
  const current = useStore((s) => s.level);
  const level = levelOverride ?? current;
  const window = useStore((s) => s.window);
  return useMemo(() => (index ? buildModel(index, level, inWindow(index, window)) : null), [index, level, window]);
}

export function useActive(model: GraphModel | null): Active | null {
  const index = useStore((s) => s.index);
  const t = useStore((s) => s.t);
  const speed = useStore((s) => s.speed);
  const window = useStore((s) => s.window);
  return useMemo(
    () =>
      index && model
        ? activeAt(index, t, { fadeMs: FADE_WALL_MS * speed, flashMs: FLASH_WALL_MS * speed, window, mapNode: model.mapNode })
        : null,
    [index, model, t, speed, window],
  );
}

/** Advances the playhead with requestAnimationFrame while playing. */
export function usePlayback(): void {
  const playing = useStore((s) => s.playing);
  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    let raf = requestAnimationFrame(function frame(now) {
      useStore.getState().tick(now - last);
      last = now;
      raf = requestAnimationFrame(frame);
    });
    return () => cancelAnimationFrame(raf);
  }, [playing]);
}
