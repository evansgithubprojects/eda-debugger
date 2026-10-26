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

export function Json({ value }: { value: unknown }) {
  return <pre className="json">{JSON.stringify(value, null, 2)}</pre>;
}

export function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="section">
      <h3>{title}{aside && <span className="aside">{aside}</span>}</h3>
      {children}
    </section>
  );
}
