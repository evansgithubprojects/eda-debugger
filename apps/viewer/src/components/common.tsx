import type { Finding, Occurrence } from '@eda-debugger/core';
import type { ReactNode } from 'react';
import { callChain, eventLabel, type ReplayIndex } from '../replay';

export const fmtMs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms.toFixed(ms < 10 ? 2 : 0)}ms`);

export function Badge({ tone, children, title }: { tone: 'full' | 'template' | 'error' | 'warn' | 'external' | 'muted'; children: ReactNode; title?: string }) {
  return <span className={`badge badge-${tone}`} title={title}>{children}</span>;
}

/** Makes it obvious whether an occurrence's data is template-only or fully captured. */
export function CaptureBadge({ occ }: { occ: Occurrence }) {
  return occ.capture === 'full' ? (
    <Badge tone="full" title="The full payload was captured for this occurrence">full capture</Badge>
  ) : (
    <Badge tone="template" title="Only the template (payload shape) is stored; values were not captured">template-only</Badge>
  );
}

export function FindingBadges({ findings }: { findings?: Finding[] }) {
  if (!findings?.length) return null;
  const high = findings.some((f) => f.priority === 'high');
  return (
    <>
      <Badge tone="warn" title="Suspected corrupt payload">⚠ suspect</Badge>
      {high && <Badge tone="external" title="Reaches an external system">EXTERNAL</Badge>}
    </>
  );
}

const ICON_PATHS = {
  // lightning bolt: something fired
  event: <path d="M8.5 1 3 8.5h3.2L5.5 15 13 6.8H9.4z" />,
  // receiving socket: something that handles
  handler: <path d="M2 3h12v4.5H2zM2 9h12v4H2zM4 5.2h2M4 11h2" />,
} as const;

/** Small colored marker that tells events (violet bolt) and handlers (teal block) apart at a glance. */
export function EntityIcon({ kind }: { kind: keyof typeof ICON_PATHS }) {
  return (
    <svg className={`entity-icon entity-${kind}`} viewBox="0 0 16 16" width="12" height="12" role="img" aria-label={kind}>
      <title>{kind === 'event' ? 'Event' : 'Handler'}</title>
      {ICON_PATHS[kind]}
    </svg>
  );
}

export function EventRef({ children }: { children: ReactNode }) {
  return <span className="entity-ref"><EntityIcon kind="event" />{children}</span>;
}

export function HandlerRef({ children }: { children: ReactNode }) {
  return <span className="entity-ref"><EntityIcon kind="handler" />{children}</span>;
}

export function Json({ value }: { value: unknown }) {
  return <pre className="json">{JSON.stringify(value, null, 2)}</pre>;
}

export function Section({ title, children, aside }: { title: ReactNode; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="section">
      <h3>{title}{aside && <span className="aside">{aside}</span>}</h3>
      {children}
    </section>
  );
}

/**
 * Events with the handler that emitted each next one between them, root first. `threw` marks the handler (or, when
 * it isn't a step, the emitter) that threw with a ✕ after its name.
 */
export function CallChain({ index, occurrenceId, threw, tail }: { index: ReplayIndex; occurrenceId: string; threw?: string; tail?: ReactNode[] }) {
  const { steps, truncated } = callChain(index, occurrenceId);
  const marked = steps.findIndex((s) => s.kind === 'handler' && s.nodeId === threw);
  const markAt = marked >= 0 ? marked : steps.findIndex((s) => s.kind === 'event' && s.item.template.emitterId === threw);
  const error = <span className="chain-error" title="Threw the error this is traced to"> ✕</span>;
  const parts: ReactNode[] = steps.map((s, n) => (
    <span key={n} className={n === steps.length - 1 && s.kind === 'event' ? 'current-step' : ''}>
      {s.kind === 'handler'
        ? <HandlerRef>{index.nodes.get(s.nodeId)?.label ?? s.nodeId}</HandlerRef>
        : <EventRef>{eventLabel(index, s.item)}</EventRef>}
      {n === markAt && error}
    </span>
  ));
  parts.push(...(tail ?? []));
  return (
    <span className="call-chain">
      {truncated && <span className="muted" title="Earlier events were evicted from the buffer">… ▸ </span>}
      {parts.map((p, n) => <span key={n}>{n > 0 && <span className="muted"> ▸ </span>}{p}</span>)}
    </span>
  );
}

// Values JSON cannot carry are stored as { $eda: 'NaN' | 'undefined' | ... }.
export const shortValue = (v: unknown) => {
  if (typeof v === 'object' && v !== null && typeof (v as { $eda?: unknown }).$eda === 'string') return (v as { $eda: string }).$eda;
  const s = v === undefined ? 'undefined' : JSON.stringify(v);
  return s.length > 60 ? s.slice(0, 57) + '…' : s;
};

/**
 * A flagged payload: each flagged field with the value that was sent, then the call chain it travelled (✕ on the
 * method that threw, if any) out to its recipients. The external badge is shown separately.
 */
export function FindingSummary({ index, finding }: { index: ReplayIndex; finding: Finding }) {
  const item = index.byId.get(finding.occurrenceId);
  const recipients = finding.externalTargets.length
    ? finding.externalTargets.map((t) => <span key={t}>{t}</span>)
    : (item?.template.handlerIds ?? []).map((id) => <HandlerRef key={id}>{index.nodes.get(id)?.label ?? id}</HandlerRef>);
  return (
    <span className="finding-summary">
      {finding.diff.length > 0 && (
        <code className="flagged">{finding.diff.map((d) => `${d.path || 'payload'}: ${shortValue(d.actual)}`).join('\n')}</code>
      )}
      {item
        ? <CallChain index={index} occurrenceId={item.occ.id} threw={finding.taintSource?.handlerId} tail={recipients} />
        : <span className="muted">event no longer recorded</span>}
    </span>
  );
}
