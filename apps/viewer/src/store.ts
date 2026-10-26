import type { Finding, RecorderMessage, Recording } from '@eda-debugger/core';
import { create } from 'zustand';
import type { Level } from './graph/model';
import { buildIndex, type ReplayIndex } from './replay';

export const SPEEDS = [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 4];
/** Wall-clock lengths of the lit fade and the red flash, scaled to recording time by playback speed. */
export const FADE_WALL_MS = 700;
export const FLASH_WALL_MS = 900;

/** How many steps of the inspection trail the inspector keeps. */
export const TRAIL_MAX = 8;

export type Selection = { type: 'node'; id: string } | { type: 'edge'; id: string } | { type: 'occurrence'; id: string } | null;

export interface Toast {
  id: number;
  finding: Finding;
  summary: string;
  /** External-system findings stay until dismissed. */
  sticky: boolean;
  /** The same finding repeating folds into one toast with a counter. */
  count: number;
}

type LiveStatus = 'off' | 'connecting' | 'on' | 'error';

interface State {
  recording: Recording | null;
  index: ReplayIndex | null;
  sourceName: string;
  t: number;
  playing: boolean;
  speed: number;
  window: [number, number];
  level: Level;
  activityNodeId: string | null;
  selection: Selection;
  /** Everything inspected at this zoom level, oldest first; `selection` is always its last entry. */
  trail: NonNullable<Selection>[];
  toasts: Toast[];
  live: LiveStatus;
  following: boolean;

  load(recording: Recording, name: string): void;
  setT(t: number): void;
  togglePlay(): void;
  pause(): void;
  tick(wallMs: number): void;
  setSpeed(speed: number): void;
  setWindow(window: [number, number]): void;
  setLevel(level: Level): void;
  openActivity(rawNodeId: string): void;
  closeActivity(): void;
  select(selection: Selection): void;
  seekToOccurrence(id: string): void;
  dismissToast(id: number): void;
  dismissAllToasts(): void;
  connectLive(url: string): void;
  disconnectLive(): void;
}

const sameSelection = (a: NonNullable<Selection>, b: NonNullable<Selection>) => a.type === b.type && a.id === b.id;

/** Inspecting something already on the trail goes back to it; anything new is added to the end. */
export function extendTrail(trail: NonNullable<Selection>[], next: NonNullable<Selection>): NonNullable<Selection>[] {
  const at = trail.findIndex((t) => sameSelection(t, next));
  return at >= 0 ? trail.slice(0, at + 1) : [...trail, next].slice(-TRAIL_MAX);
}

export function pickSpeed(rangeMs: number): number {
  const fit = SPEEDS.filter((s) => rangeMs / s >= 8000);
  return fit.length ? (fit[fit.length - 1] as number) : (SPEEDS[0] as number);
}

let toastSeq = 0;
let source: EventSource | null = null;

export const useStore = create<State>()((set, get) => {
  const toastFor = (finding: Finding): Toast => ({
    id: ++toastSeq,
    finding,
    summary: finding.summary,
    sticky: finding.priority === 'high',
    count: 1,
  });

  const pushToast = (finding: Finding) => {
    const toast = toastFor(finding);
    const same = get().toasts.find((t) => t.summary === toast.summary);
    if (same) {
      // Newest occurrence wins so "Jump to it" goes to the latest one.
      set((s) => ({ toasts: s.toasts.map((t) => (t.id === same.id ? { ...t, finding, count: t.count + 1 } : t)) }));
      return;
    }
    // High priority first, and only high priority stays; the rest clear themselves.
    set((s) => ({ toasts: [toast, ...s.toasts].sort((a, b) => Number(b.sticky) - Number(a.sticky)).slice(0, 20) }));
    if (!toast.sticky) setTimeout(() => get().dismissToast(toast.id), 8000);
  };

  let pending: Recording | null = null;
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    flushTimer = null;
    if (!pending) return;
    const rec = pending;
    pending = null;
    applyRecording(rec, true);
  };
  const schedule = () => {
    if (!flushTimer) flushTimer = setTimeout(flush, 250);
  };

  function applyRecording(recording: Recording, live: boolean, name?: string) {
    const index = buildIndex(recording);
    const s = get();
    const keepView = live && s.index !== null;
    const following = keepView ? s.following : true;
    const full: [number, number] = [index.start, index.end];
    set({
      recording, index,
      sourceName: name ?? s.sourceName,
      window: keepView && !following ? s.window : full,
      t: keepView && !following ? Math.min(Math.max(s.t, index.start), index.end) : following && live ? index.end : index.start,
      speed: keepView ? s.speed : pickSpeed(index.end - index.start),
      level: keepView ? s.level : { kind: 'process' },
      activityNodeId: keepView ? s.activityNodeId : null,
      selection: keepView ? s.selection : null,
      trail: keepView ? s.trail : [],
      playing: false,
      following,
    });
  }

  return {
    recording: null, index: null, sourceName: '', t: 0, playing: false, speed: 1, window: [0, 0],
    level: { kind: 'process' }, activityNodeId: null, selection: null, trail: [], toasts: [], live: 'off', following: true,

    load(recording, name) {
      get().disconnectLive();
      applyRecording(recording, false, name);
    },
    setT(t) {
      const [w0, w1] = get().window;
      set({ t: Math.min(Math.max(t, w0), w1), following: false });
    },
    togglePlay() {
      const { playing, t, window } = get();
      if (playing) return set({ playing: false });
      set({ playing: true, t: t >= window[1] ? window[0] : t, following: false });
    },
    pause() { set({ playing: false }); },
    tick(wallMs) {
      const { t, speed, window, playing } = get();
      if (!playing) return;
      const next = t + wallMs * speed;
      if (next >= window[1]) set({ t: window[1], playing: false });
      else set({ t: next });
    },
    setSpeed(speed) { set({ speed }); },
    setWindow(window) {
      const [a, b] = window;
      const { t } = get();
      set({ window: [Math.min(a, b), Math.max(a, b)], t: Math.min(Math.max(t, Math.min(a, b)), Math.max(a, b)), following: false });
    },
    setLevel(level) { set({ level, selection: null, trail: [], activityNodeId: null }); },
    openActivity(rawNodeId) { set({ activityNodeId: rawNodeId }); },
    closeActivity() { set({ activityNodeId: null }); },
    select(selection) { set((s) => ({ selection, trail: selection ? extendTrail(s.trail, selection) : [] })); },
    seekToOccurrence(id) {
      const item = get().index?.byId.get(id);
      if (!item) return;
      const [w0, w1] = get().window;
      set({
        t: item.occ.ts, playing: false, following: false,
        window: [Math.min(w0, item.occ.ts), Math.max(w1, item.occ.ts)],
        selection: { type: 'occurrence', id },
        trail: extendTrail(get().trail, { type: 'occurrence', id }),
      });
    },
    dismissToast(id) { set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })); },
    dismissAllToasts() { set({ toasts: [] }); },

    connectLive(url) {
      get().disconnectLive();
      set({ live: 'connecting' });
      const es = new EventSource(url);
      source = es;
      es.onopen = () => set({ live: 'on' });
      es.onerror = () => set({ live: es.readyState === EventSource.CLOSED ? 'error' : 'connecting' });
      es.onmessage = (ev) => {
        const msg = JSON.parse(ev.data) as RecorderMessage;
        if (msg.type === 'snapshot') {
          pending = msg.recording;
          flush();
          set({ sourceName: `live · ${url}` });
        } else if (msg.type === 'finding') {
          pushToast(msg.finding);
          const base = pending ?? get().recording;
          if (base && !(base.findings ?? []).some((f) => f.id === msg.finding.id)) {
            pending = { ...base, findings: [...(base.findings ?? []), msg.finding] };
            schedule();
          }
        } else if (msg.type === 'occurrence') {
          const base = pending ?? get().recording;
          if (!base) return;
          const have = <T extends { id: string }>(list: T[], item: T) => list.some((x) => x.id === item.id);
          pending = {
            ...base,
            processes: [...base.processes, ...msg.processes.filter((p) => !have(base.processes, p))],
            nodes: [...base.nodes, ...msg.nodes.filter((n) => !have(base.nodes, n))],
            templates: have(base.templates, msg.template)
              ? base.templates.map((t) => (t.id === msg.template.id ? msg.template : t))
              : [...base.templates, msg.template],
            occurrences: have(base.occurrences, msg.occurrence)
              ? base.occurrences.map((o) => (o.id === msg.occurrence.id ? msg.occurrence : o))
              : [...base.occurrences, msg.occurrence],
          };
          schedule();
        }
      };
    },
    disconnectLive() {
      source?.close();
      source = null;
      if (flushTimer) clearTimeout(flushTimer);
      flushTimer = null;
      pending = null;
      if (get().live !== 'off') set({ live: 'off' });
    },
  };
});
