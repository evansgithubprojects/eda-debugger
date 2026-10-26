import type { Finding } from '@eda-debugger/core';
import { useMemo } from 'react';
import { useModel } from '../hooks';
import { chainOf, countFired, eventLabel, inWindow, type IndexedOccurrence, type ReplayIndex } from '../replay';
import { TRAIL_MAX, useStore, type Selection } from '../store';
import { Badge, CaptureBadge, FindingBadges, fmtMs, Json, Section } from './common';

export function Inspector() {
  const index = useStore((s) => s.index)!;
  const selection = useStore((s) => s.selection);
  return (
    <aside className="inspector">
      <Crumbs index={index} />
      {!selection && <Overview index={index} />}
      {selection?.type === 'node' && <NodeDetail index={index} id={selection.id} />}
      {selection?.type === 'edge' && <EdgeDetail index={index} id={selection.id} />}
      {selection?.type === 'occurrence' && <OccurrenceDetail index={index} id={selection.id} />}
    </aside>
  );
}

/** The level being looked at, then everything inspected on it so far. The first crumb returns to the level overview. */
function Crumbs({ index }: { index: ReplayIndex }) {
  const model = useModel();
  const level = useStore((s) => s.level);
  const trail = useStore((s) => s.trail);
  const selection = useStore((s) => s.selection);
  const select = useStore((s) => s.select);
  const nodeLabel = (id: string) => model?.nodes.find((n) => n.id === id)?.label ?? index.nodes.get(id)?.label ?? id;
  const label = (t: NonNullable<Selection>) => {
    if (t.type === 'node') return nodeLabel(t.id);
    if (t.type === 'edge') {
      const e = model?.edges.find((x) => x.id === t.id);
      return e ? `${nodeLabel(e.source)} → ${nodeLabel(e.target)}` : t.id;
    }
    const item = index.byId.get(t.id);
    return item ? eventLabel(index, item) : t.id;
  };
  const root = level.kind === 'handlers' ? index.processLabel.get(level.processId) ?? level.processId : 'Processes';
  return (
    <nav className="inspector-crumbs" aria-label="Inspection trail">
      <button className={selection ? '' : 'current'} onClick={() => select(null)} title="Overview of this level">{root}</button>
      {trail.length >= TRAIL_MAX && <span className="muted">› …</span>}
      {trail.map((t, k) => (
        <span key={`${t.type}:${t.id}`} className="crumb">
          <span className="muted">›</span>
          {k === trail.length - 1 ? <span className="current" title={label(t)}>{label(t)}</span> : <button onClick={() => select(t)} title={label(t)}>{label(t)}</button>}
        </span>
      ))}
    </nav>
  );
}

function Overview({ index }: { index: ReplayIndex }) {
  const model = useModel();
  const level = useStore((s) => s.level);
  const seek = useStore((s) => s.seekToOccurrence);
  const window = useStore((s) => s.window);
  // Inside a process, the overview covers only the traffic that touches that process.
  const items = useMemo(() => {
    const all = inWindow(index, window);
    if (level.kind !== 'handlers' || !model) return all;
    const inside = (id: string) => !model.mapNode(id)?.startsWith('p:');
    return all.filter((i) => i.hops.some((h) => inside(h.src) || inside(h.dst)));
  }, [index, window, level, model]);
  const attention = useMemo(() => {
    const rows = items.flatMap((i) => {
      const out: { i: IndexedOccurrence; kind: 'threw' | 'suspect'; high: boolean; text: string }[] = [];
      for (const th of i.throws) out.push({ i, kind: 'threw', high: false, text: `${index.nodes.get(th.handlerId)?.label} threw: ${th.message}` });
      for (const f of index.findingsByOcc.get(i.occ.id) ?? []) out.push({ i, kind: 'suspect', high: f.priority === 'high', text: f.summary });
      return out;
    });
    // External-system findings first, then by time.
    return rows.sort((a, b) => Number(b.high) - Number(a.high) || a.i.occ.ts - b.i.occ.ts);
  }, [items, index]);

  return (
    <>
      <Section title="Recording">
        <dl className="facts">
          <dt>Events</dt><dd>{items.length} in window ({index.items.length} total)</dd>
          <dt>Processes</dt><dd>{index.recording.processes.length}</dd>
          <dt>Handlers</dt><dd>{index.recording.nodes.filter((n) => n.kind === 'handler').length}</dd>
          <dt>Templates</dt><dd>{index.recording.templates.length}</dd>
        </dl>
        <p className="hint">Click a node or pathway to inspect it. Double-click a process to zoom in, or a handler to see its activity.</p>
      </Section>
      <Section title="Needs attention" aside={attention.length}>
        {attention.length === 0 && <p className="hint">No throws or suspected corrupt payloads in this window.</p>}
        <ul className="list">
          {attention.map((a, k) => (
            <li key={k}>
              <button className={`row ${a.high ? 'row-high' : ''}`} onClick={() => seek(a.i.occ.id)}>
                <span className="row-head">
                  {a.kind === 'threw' ? <Badge tone="error">✕ threw</Badge> : <Badge tone="warn">⚠ suspect</Badge>}
                  {a.high && <Badge tone="external">EXTERNAL</Badge>}
                  <span className="muted">{fmtMs(a.i.occ.ts - index.start)}</span>
                </span>
                <span className="row-text">{a.text}</span>
              </button>
            </li>
          ))}
        </ul>
      </Section>
    </>
  );
}

function NodeDetail({ index, id }: { index: ReplayIndex; id: string }) {
  const model = useModel();
  const window = useStore((s) => s.window);
  const openActivity = useStore((s) => s.openActivity);
  const setLevel = useStore((s) => s.setLevel);
  const m = model?.nodes.find((n) => n.id === id);
  const items = useMemo(() => inWindow(index, window).filter((i) => i.hops.some((h) => model?.mapNode(h.dst) === id) || model?.mapNode(i.occ.sourceNodeId) === id), [index, window, model, id]);
  if (!m) return null;
  const threw = items.reduce((n, i) => n + i.throws.filter((t) => model?.mapNode(t.handlerId) === id).length, 0);
  const templates = new Map<string, { name: string; shape: string; n: number }>();
  for (const i of items) {
    const e = templates.get(i.template.id) ?? { name: eventLabel(index, i), shape: i.template.payloadShape, n: 0 };
    e.n++;
    templates.set(i.template.id, e);
  }
  return (
    <>
      <Section title={m.label} aside={<Badge tone="muted">{m.kind}</Badge>}>
        <dl className="facts">
          <dt>Process</dt><dd>{index.processLabel.get(m.processId)}</dd>
          <dt>Traffic</dt><dd>{m.detail}</dd>
          <dt>Throws</dt><dd>{threw ? <Badge tone="error">✕ {threw}</Badge> : 'none'}</dd>
        </dl>
        {m.kind === 'handler' && m.rawId && <button className="primary" onClick={() => openActivity(m.rawId!)}>Open activity</button>}
        {(m.kind === 'process' || m.kind === 'stub') && <button className="primary" onClick={() => setLevel({ kind: 'handlers', processId: m.processId })}>Zoom into process</button>}
      </Section>
      <Section title="Event templates" aside={templates.size}>
        <ul className="list">
          {[...templates.values()].map((t) => (
            <li key={t.name + t.shape} className="tpl"><strong>{t.name}</strong><code>{t.shape}</code><span className="muted">{t.n}×</span></li>
          ))}
        </ul>
      </Section>
    </>
  );
}

function EdgeDetail({ index, id }: { index: ReplayIndex; id: string }) {
  const model = useModel();
  const window = useStore((s) => s.window);
  const select = useStore((s) => s.select);
  const seek = useStore((s) => s.seekToOccurrence);
  const t = useStore((s) => s.t);
  const edge = model?.edges.find((e) => e.id === id);
  const items = useMemo(
    () => (model ? inWindow(index, window).filter((i) => i.hops.some((h) => `${model.mapNode(h.src)}>${model.mapNode(h.dst)}` === id)) : []),
    [index, window, model, id],
  );
  if (!edge || !model) return null;
  const label = (nid: string) => model.nodes.find((n) => n.id === nid)?.label ?? nid;
  return (
    <>
      <Section title="Pathway">
        <p className="route"><button className="link" onClick={() => select({ type: 'node', id: edge.source })}>{label(edge.source)}</button> → <button className="link" onClick={() => select({ type: 'node', id: edge.target })}>{label(edge.target)}</button></p>
        <dl className="facts"><dt>Events</dt><dd>{edge.events.join(', ')}</dd><dt>Fired</dt><dd>{countFired(edge.times, t, window[1])} of {edge.count}×</dd></dl>
      </Section>
      <Section title="Occurrences" aside={items.length}>
        <ul className="list">
          {items.slice(0, 200).map((i) => (
            <li key={i.occ.id}>
              <button className="row" onClick={() => seek(i.occ.id)}>
                <span className="row-head">
                  <span>{eventLabel(index, i)}</span>
                  <span className="muted">{fmtMs(i.occ.ts - index.start)}</span>
                </span>
                <span className="row-badges">
                  <CaptureBadge occ={i.occ} />
                  {i.throws.length > 0 && <Badge tone="error">✕ threw</Badge>}
                  <FindingBadges findings={index.findingsByOcc.get(i.occ.id)} />
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Section>
    </>
  );
}

export function OccurrenceDetail({ index, id }: { index: ReplayIndex; id: string }) {
  const seek = useStore((s) => s.seekToOccurrence);
  const item = index.byId.get(id);
  if (!item) return <p className="hint">That event is no longer in the recording.</p>;
  const chain = chainOf(index, id);
  const findings = index.findingsByOcc.get(id);
  const nodeLabel = (nid: string) => index.nodes.get(nid)?.label ?? nid;
  return (
    <>
      <Section title={eventLabel(index, item)} aside={<CaptureBadge occ={item.occ} />}>
        <dl className="facts">
          <dt>At</dt><dd>{fmtMs(item.occ.ts - index.start)} · took {fmtMs(item.occ.durationMs)}</dd>
          <dt>Emitted by</dt><dd>{nodeLabel(item.occ.sourceNodeId)}</dd>
          <dt>Causality</dt><dd>{item.occ.causality}</dd>
        </dl>
        <div className="chain" aria-label="Causal chain">
          {chain.map((c, k) => (
            <span key={c.occ.id}>
              {k > 0 && <span className="muted"> ▸ </span>}
              <button className={`link ${c.occ.id === id ? 'current' : ''}`} onClick={() => seek(c.occ.id)}>{eventLabel(index, c)}</button>
            </span>
          ))}
        </div>
      </Section>
      {findings?.map((f) => <FindingCard key={f.id} index={index} finding={f} />)}
      <Section title="Payload">
        {item.occ.capture === 'full' ? (
          <Json value={item.occ.payload} />
        ) : (
          <>
            <p className="hint">Template-only: values were not stored. The shape of every occurrence of this template is:</p>
            <code className="shape">{item.template.payloadShape}</code>
          </>
        )}
      </Section>
      <Section title="Handlers" aside={item.occ.handlerResults.length}>
        {item.occ.blocked && <p className="hint">Blocked by policy: no handler was called.</p>}
        <ul className="list">
          {item.occ.handlerResults.map((r, k) => (
            <li key={k} className="tpl">
              <strong>{nodeLabel(r.handlerId)}</strong>
              <span className="muted">{fmtMs(r.durationMs)}</span>
              {r.error && <span className="err">✕ {r.error.name}: {r.error.message}</span>}
            </li>
          ))}
        </ul>
      </Section>
    </>
  );
}

function FindingCard({ index, finding }: { index: ReplayIndex; finding: Finding }) {
  const seek = useStore((s) => s.seekToOccurrence);
  const src = index.byId.get(finding.taintSource.occurrenceId);
  return (
    <Section title="Suspected corrupt payload" aside={<Badge tone="muted">{finding.confidence}</Badge>}>
      <div className="row-badges">
        {finding.priority === 'high' && <Badge tone="external" title={finding.externalTargets.join(', ')}>EXTERNAL · {finding.externalTargets.join(', ')}</Badge>}
        <Badge tone="muted">{finding.basis === 'deep' ? 'compared against logged payloads' : 'shape comparison only'}</Badge>
        {finding.retroactive && <Badge tone="muted">found after the fact</Badge>}
      </div>
      <ul className="reasons">{finding.reasons.map((r, k) => <li key={k}>{r.message}</li>)}</ul>
      {finding.diff.length > 0 && (
        <table className="diff">
          <thead><tr><th>Field</th><th>Before</th><th>Now</th></tr></thead>
          <tbody>
            {finding.diff.map((d, k) => (
              <tr key={k}><td>{d.path || '(payload)'}</td><td><code>{short(d.baseline)}</code></td><td><code>{short(d.actual)}</code></td></tr>
            ))}
          </tbody>
        </table>
      )}
      {src && (
        <p className="hint">
          Tainted by a failure in <strong>{index.nodes.get(finding.taintSource.handlerId)?.label}</strong>:{' '}
          <button className="link" onClick={() => seek(src.occ.id)}>{eventLabel(index, src)}</button>
        </p>
      )}
    </Section>
  );
}

const short = (v: unknown) => {
  // Values JSON cannot carry are stored as { $eda: 'NaN' | 'undefined' | ... }.
  if (typeof v === 'object' && v !== null && typeof (v as { $eda?: unknown }).$eda === 'string') return (v as { $eda: string }).$eda;
  const s = v === undefined ? 'undefined' : JSON.stringify(v);
  return s.length > 60 ? s.slice(0, 57) + '…' : s;
};
