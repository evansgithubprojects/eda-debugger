import { CorruptionEngine, type Observation } from './engine';
import type { TaintOptions } from './taint';
import type { Finding, Recording } from '../types';

/**
 * Retroactive pass over a recording. Replays the same rules as the live guard in time order,
 * so it also finds payloads that were emitted before their handler threw.
 */
export function analyze(recording: Recording, opts: Partial<TaintOptions> = {}): Finding[] {
  const engine = new CorruptionEngine(opts);
  const templates = new Map(recording.templates.map((t) => [t.id, t]));
  const nodes = new Map(recording.nodes.map((n) => [n.id, n]));
  const findings: Finding[] = [];

  const observation = (o: Recording['occurrences'][number]): Observation | null => {
    const t = templates.get(o.templateId);
    if (!t) return null;
    const process = nodes.get(t.emitterId)?.label ?? t.emitterId;
    return {
      occurrenceId: o.id, parentId: o.parentId, sourceNodeId: o.sourceNodeId, emitterId: t.emitterId,
      eventName: t.eventName, label: `${process} → ${t.eventName}`, shape: t.payloadShape,
      payload: o.capture === 'full' ? o.payload : undefined, ts: o.ts, externalTargets: t.external,
    };
  };

  type Step =
    | { at: number; order: number; kind: 'emit'; occ: Recording['occurrences'][number] }
    | { at: number; order: number; kind: 'fail'; occ: Recording['occurrences'][number]; handlerId: string };

  // Handler failures happen after the emits made inside them, so they get their own timeline entry.
  const steps: Step[] = [];
  const children = new Map<string, Recording['occurrences']>();
  recording.occurrences.forEach((occ, i) => {
    steps.push({ at: occ.ts, order: i * 2, kind: 'emit', occ });
    for (const r of occ.handlerResults) {
      if (r.error) steps.push({ at: r.ts + r.durationMs, order: i * 2 + 1, kind: 'fail', occ, handlerId: r.handlerId });
    }
    if (occ.parentId) {
      const key = `${occ.parentId}|${occ.sourceNodeId}`;
      children.set(key, [...(children.get(key) ?? []), occ]);
    }
  });
  steps.sort((a, b) => a.at - b.at || a.order - b.order);

  for (const step of steps) {
    const t = templates.get(step.occ.templateId);
    if (!t) continue;
    if (step.kind === 'emit') {
      const obs = observation(step.occ);
      const finding = obs && engine.observe(obs);
      if (finding) findings.push(finding);
      if (step.occ.signalsError) {
        const handler = nodes.get(step.occ.sourceNodeId)?.kind === 'handler' ? step.occ.sourceNodeId : null;
        engine.onError(handler, t.emitterId, step.occ.id, step.occ.ts);
      }
      continue;
    }
    engine.onError(step.handlerId, t.emitterId, step.occ.id, step.at);
    for (const child of children.get(`${step.occ.id}|${step.handlerId}`) ?? []) {
      if (engine.isFlagged(child.id)) continue;
      const obs = observation(child);
      const finding = obs && engine.observe(obs, { occurrenceId: step.occ.id, handlerId: step.handlerId });
      if (finding) findings.push({ ...finding, retroactive: true });
    }
  }
  return findings;
}
