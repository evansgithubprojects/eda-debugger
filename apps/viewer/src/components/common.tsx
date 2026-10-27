import type { Finding, Occurrence } from '@eda-debugger/core';
import type { ReactNode } from 'react';

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
