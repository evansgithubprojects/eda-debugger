import type { Finding } from '@eda-debugger/core';
import { useMemo, useState } from 'react';
import { useModel } from '../hooks';
import { chainOf, countFired, eventLabel, inWindow, notifications, parseThrowId, recipientsOf, throwId, type IndexedOccurrence, type ReplayIndex, type Tier } from '../replay';
import { TRAIL_MAX, useStore, type Selection } from '../store';
import { Badge, CaptureBadge, EventRef, FindingSummary, fmtMs, HandlerRef, Json, Section, shortValue } from './common';

export function Inspector() {
  const index = useStore((s) => s.index)!;
  const selection = useStore((s) => s.selection);
  return (
    <aside className="inspector">
      <Crumbs index={index} />
      {!selection && <Overview index={index} />}
      {selection?.type === 'node' && <NodeDetail index={index} id={selection.id} />}
      {selection?.type === 'edge' && <EdgeDetail key={selection.id} index={index} id={selection.id} />}
      {selection?.type === 'occurrence' && <OccurrenceDetail index={index} id={selection.id} />}
      {selection?.type === 'throw' && <ErrorDetail index={index} id={selection.id} />}
      {selection?.type === 'finding' && <FindingSelection index={index} id={selection.id} />}
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
    if (t.type === 'throw') {
      const src = parseThrowId(index, t.id);
      return src ? `${nodeLabel(src.handlerId)} threw` : t.id;
    }
    if (t.type === 'finding') {
      const f = index.findingsById.get(t.id);
      const item = f && index.byId.get(f.occurrenceId);
      return item ? `suspect: ${eventLabel(index, item)}` : t.id;
    }
    const item = index.byId.get(t.id);
    return item ? eventLabel(index, item) : t.id;
  };
  const labelNode = (t: NonNullable<Selection>) => {
    if (t.type === 'node') return model?.nodes.find((n) => n.id === t.id)?.kind === 'process' ? label(t) : <HandlerRef>{label(t)}</HandlerRef>;
    if (t.type === 'edge' || t.type === 'throw' || t.type === 'finding') return label(t);
    return <EventRef>{label(t)}</EventRef>;
  };
  const root = level.kind === 'handlers' ? index.processLabel.get(level.processId) ?? level.processId : 'Processes';
  return (
    <nav className="inspector-crumbs" aria-label="Inspection trail">
      <button className={selection ? '' : 'current'} onClick={() => select(null)} title="Overview of this level">{root}</button>
      {trail.length >= TRAIL_MAX && <span className="muted">› …</span>}
      {trail.map((t, k) => (
        <span key={`${t.type}:${t.id}`} className="crumb">
          <span className="muted">›</span>
          {k === trail.length - 1 ? <span className="current" title={label(t)}>{labelNode(t)}</span> : <button onClick={() => select(t)} title={label(t)}>{labelNode(t)}</button>}
        </span>
      ))}
    </nav>
  );
}

function Overview({ index }: { index: ReplayIndex }) {
  const model = useModel();
  const level = useStore((s) => s.level);
  const selectIssue = useStore((s) => s.selectIssue);
  const window = useStore((s) => s.window);
  // Inside a process, the overview covers only the traffic that touches that process.
  const items = useMemo(() => {
    const all = inWindow(index, window);
    if (level.kind !== 'handlers' || !model) return all;
    const inside = (id: string) => !model.mapNode(id)?.startsWith('p:');
    return all.filter((i) => i.hops.some((h) => inside(h.src) || inside(h.dst)));
  }, [index, window, level, model]);
  const list = useMemo(() => notifications(index, items), [items, index]);

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
      <Section title="Notifications" aside={list.length}>
        {list.length === 0 && <p className="hint">No throws or suspected corrupt payloads in this window.</p>}
        <ul className="list">
          {list.map((n) => (
            <li key={`${n.kind}:${n.id}`}>
              <button className={`row ${n.external ? 'row-high' : ''}`} onClick={() => selectIssue({ type: n.kind, id: n.id }, n.occurrenceId)}>
                <span className="row-head">
                  {n.kind === 'throw' ? <Badge tone="error">✕ Error</Badge> : <Badge tone="warn">⚠ Corrupt Payload</Badge>}
                  <TierBadge tier={n.tier} />
                  {n.external && <Badge tone="external">EXTERNAL</Badge>}
                  <span className="muted">{fmtMs(n.rank.ts - index.start)}</span>
                </span>
                <span className="row-text">{n.finding ? <FindingSummary index={index} finding={n.finding} /> : n.text}</span>
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
      <Section title={m.kind === 'process' || m.kind === 'stub' ? m.label : <HandlerRef>{m.label}</HandlerRef>} aside={<Badge tone="muted">{m.kind}</Badge>}>
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
            <li key={t.name + t.shape} className="tpl"><strong><EventRef>{t.name}</EventRef></strong><code>{t.shape}</code><span className="muted">{t.n}×</span></li>
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
  // Clean emissions are hidden until asked for, so throws and suspect payloads aren't buried.
  const [showAll, setShowAll] = useState(false);
  const problems = useMemo(() => items.filter((i) => i.throws.length > 0 || index.findingsByOcc.has(i.occ.id)), [items, index]);
  if (!edge || !model) return null;
  const label = (nid: string) => model.nodes.find((n) => n.id === nid)?.label ?? nid;
  const shown = showAll ? items : problems;
  return (
    <>
      <Section title="Pathway">
        <p className="route"><button className="link" onClick={() => select({ type: 'node', id: edge.source })}><HandlerRef>{label(edge.source)}</HandlerRef></button> → <button className="link" onClick={() => select({ type: 'node', id: edge.target })}><HandlerRef>{label(edge.target)}</HandlerRef></button></p>
        <dl className="facts"><dt>Events</dt><dd>{edge.events.map((e, k) => <span key={e}>{k > 0 && ', '}<EventRef>{e}</EventRef></span>)}</dd><dt>Fired</dt><dd>{countFired(edge.times, t, window[1])} of {edge.count}×</dd></dl>
      </Section>
      <Section title="Payloads" aside={showAll ? items.length : `${problems.length} of ${items.length}`}>
        {problems.length < items.length && (
          <label className="checkbox">
            <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
            Show clean payloads ({items.length - problems.length})
          </label>
        )}
        {!showAll && problems.length === 0 && <p className="hint">No throws or suspected corrupt payloads on this pathway in this window.</p>}
        <ul className="list">
          {shown.slice(0, 200).map((i) => {
            const flagged = index.findingsByOcc.has(i.occ.id);
            return (
              <li key={i.occ.id}>
                <button className="row" onClick={() => seek(i.occ.id)}>
                  <span className="row-head">
                    {i.throws.length > 0 && <Badge tone="error">✕ Error</Badge>}
                    {flagged && <Badge tone="warn">⚠ Corrupt Payload</Badge>}
                    <span className="muted">{fmtMs(i.occ.ts - index.start)}</span>
                  </span>
                  {i.occ.capture === 'full'
                    ? <code className="payload">{JSON.stringify(i.occ.payload)}</code>
                    : <code className="payload shape" title="Template-only: values were not stored, this is the payload's shape">{i.template.payloadShape}</code>}
                </button>
              </li>
            );
          })}
        </ul>
      </Section>
    </>
  );
}

export function OccurrenceDetail({ index, id }: { index: ReplayIndex; id: string }) {
  const item = index.byId.get(id);
  if (!item) return <p className="hint">That event is no longer in the recording.</p>;
  // A flagged event and its finding are the same thing to inspect.
  if (index.findingsByOcc.has(id)) return <CorruptPayloadDetail index={index} occurrenceId={id} />;
  return (
    <>
      <Section title={<EventRef>{eventLabel(index, item)}</EventRef>} aside={<CaptureBadge occ={item.occ} />}>
        <EventFacts index={index} item={item} />
      </Section>
      <PayloadSection item={item} />
    </>
  );
}

/** When and where an event happened, who handled it, and the events that led to it. */
function EventFacts({ index, item }: { index: ReplayIndex; item: IndexedOccurrence }) {
  const seek = useStore((s) => s.seekToOccurrence);
  const focusNode = useStore((s) => s.focusNode);
  const chain = chainOf(index, item.occ.id);
  const nodeLabel = (nid: string) => index.nodes.get(nid)?.label ?? nid;
  const showNode = (nid: string) => (
    <button className="link" title="Show on graph" onClick={() => focusNode(nid)}><HandlerRef>{nodeLabel(nid)}</HandlerRef></button>
  );
  const results = item.occ.handlerResults;
  return (
    <>
      <dl className="facts">
        <dt>At</dt><dd>{fmtMs(item.occ.ts - index.start)} · took {fmtMs(item.occ.durationMs)}</dd>
        <dt>Emitted by</dt><dd>{showNode(item.occ.sourceNodeId)}</dd>
        <dt>Handlers</dt>
        <dd>
          {item.occ.blocked ? <span className="muted">none, blocked by policy</span> : results.length === 0 && <span className="muted">none</span>}
          <ul className="handler-list">
            {results.map((r, k) => (
              <li key={k}>
                {showNode(r.handlerId)}
                {r.error && <span className="err"> ✕ {r.error.name}: {r.error.message}</span>}
              </li>
            ))}
          </ul>
        </dd>
        <dt>Causality</dt><dd>{item.occ.causality}</dd>
      </dl>
      <div className="chain" aria-label="Causal chain">
        {chain.map((c, k) => (
          <span key={c.occ.id}>
            {k > 0 && <span className="muted"> ▸ </span>}
            <button className={`link ${c.occ.id === item.occ.id ? 'current' : ''}`} onClick={() => seek(c.occ.id)}><EventRef>{eventLabel(index, c)}</EventRef></button>
          </span>
        ))}
      </div>
    </>
  );
}

/** The payload, led by what was flagged in it when it is suspected corrupt. */
function PayloadSection({ item, findings = [] }: { item: IndexedOccurrence; findings?: Finding[] }) {
  return (
    <Section title="Payload" aside={<CaptureBadge occ={item.occ} />}>
      {findings.map((f) => (
        <div key={f.id}>
          <ul className="reasons">{f.reasons.map((r, k) => <li key={k}>{r.message}</li>)}</ul>
          {f.diff.length > 0 && (
            <table className="diff">
              <thead><tr><th>Field</th><th>Before</th><th>Now</th></tr></thead>
              <tbody>
                {f.diff.map((d, k) => (
                  <tr key={k}><td>{d.path || '(payload)'}</td><td><code>{shortValue(d.baseline)}</code></td><td><code>{shortValue(d.actual)}</code></td></tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ))}
      {item.occ.capture === 'full' ? (
        <Json value={item.occ.payload} />
      ) : (
        <>
          <p className="hint">Template-only: values were not stored. The shape of every occurrence of this template is:</p>
          <code className="shape">{item.template.payloadShape}</code>
        </>
      )}
    </Section>
  );
}

const TIER_TONE = { critical: 'external', high: 'error', medium: 'warn', low: 'muted' } as const;

function TierBadge({ tier }: { tier: Tier }) {
  return <Badge tone={TIER_TONE[tier]} title="Severity, from confidence and whether an external system is reached">{tier}</Badge>;
}

/** Where payloads went, external systems first. Clicking a row shows that recipient on the graph. */
function Recipients({ index, findings }: { index: ReplayIndex; findings: Finding[] }) {
  const focusNode = useStore((s) => s.focusNode);
  const recipients = recipientsOf(index, findings);
  return (
    <Section title="Recipients" aside={recipients.length}>
      {recipients.length === 0 && <p className="hint">No receiving handlers or external systems.</p>}
      <ul className="list">
        {recipients.map((r) => {
          const nodeId = r.nodeId;
          return (
            <li key={`${r.external}:${r.label}`}>
              <button className={`row ${r.external ? 'row-high' : ''}`} disabled={!nodeId} title="Show on graph" onClick={() => nodeId && focusNode(nodeId)}>
                <span className="row-head">
                  {r.external ? <Badge tone="external">EXTERNAL</Badge> : <Badge tone="muted">internal</Badge>}
                  <span className="row-text">{r.external ? r.label : <HandlerRef>{r.label}</HandlerRef>}</span>
                  <span className="muted">{r.count} corrupted payload{r.count === 1 ? '' : 's'}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

/** A handler failure and everything it is suspected of corrupting. */
function ErrorDetail({ index, id }: { index: ReplayIndex; id: string }) {
  const seek = useStore((s) => s.seekToOccurrence);
  const selectIssue = useStore((s) => s.selectIssue);
  const src = parseThrowId(index, id);
  const item = src && index.byId.get(src.occurrenceId);
  if (!src || !item) return <p className="hint">That error is no longer in the recording.</p>;
  const thrown = item.throws.find((t) => t.handlerId === src.handlerId);
  const tainted = index.findingsBySource.get(id) ?? [];
  const external = tainted.filter((f) => f.priority === 'high').length;
  const rank = notifications(index, [item]).find((n) => n.id === id)?.tier;
  return (
    <>
      <Section title={<><HandlerRef>{index.nodes.get(src.handlerId)?.label ?? src.handlerId}</HandlerRef> {thrown ? 'threw' : 'reported an error'}</>} aside={rank && <TierBadge tier={rank} />}>
        <dl className="facts">
          {thrown && <><dt>Error</dt><dd>{thrown.message}</dd></>}
          <dt>At</dt><dd>{fmtMs((thrown?.at ?? item.occ.ts) - index.start)}</dd>
          <dt>While handling</dt><dd><button className="link" onClick={() => seek(item.occ.id)}><EventRef>{eventLabel(index, item)}</EventRef></button></dd>
          <dt>Corrupted payloads sent</dt><dd>{tainted.length}</dd>
          <dt>Sent to external systems</dt><dd>{external}</dd>
        </dl>
        {tainted.length === 0 && <p className="hint">No payload sent after this error has been flagged as corrupt.</p>}
      </Section>
      {tainted.length > 0 && <Recipients index={index} findings={tainted} />}
      {tainted.length > 0 && (
        <Section title="Corrupted payloads" aside={tainted.length}>
          <ul className="list">
            {tainted.map((f) => (
              <li key={f.id}>
                <button className={`row ${f.priority === 'high' ? 'row-high' : ''}`} onClick={() => selectIssue({ type: 'finding', id: f.id }, f.occurrenceId)}>
                  <span className="row-head">
                    <Badge tone="warn">⚠ Corrupt Payload</Badge>
                    {f.priority === 'high' && <Badge tone="external">EXTERNAL</Badge>}
                    <span className="muted">{fmtMs(f.ts - index.start)}</span>
                  </span>
                  <span className="row-text"><FindingSummary index={index} finding={f} /></span>
                </button>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </>
  );
}

function FindingSelection({ index, id }: { index: ReplayIndex; id: string }) {
  const finding = index.findingsById.get(id);
  if (!finding) return <p className="hint">That payload is no longer in the recording.</p>;
  return <CorruptPayloadDetail index={index} occurrenceId={finding.occurrenceId} />;
}

/**
 * The one inspector for a suspected corrupt payload, whether it was opened from a notification, an error, a
 * pathway or the timeline: the error it is traced to, the event itself, the payload and what was flagged in it, and
 * where it went.
 */
function CorruptPayloadDetail({ index, occurrenceId }: { index: ReplayIndex; occurrenceId: string }) {
  const selectIssue = useStore((s) => s.selectIssue);
  const item = index.byId.get(occurrenceId);
  const findings = index.findingsByOcc.get(occurrenceId) ?? [];
  if (!item || findings.length === 0) return <p className="hint">That payload is no longer in the recording.</p>;
  const ranked = notifications(index, [item]).filter((n) => n.kind === 'finding');
  const tier = ranked[0]?.tier;
  const sources = [...new Map(findings.flatMap((f) => (f.taintSource ? [[throwId(f.taintSource.occurrenceId, f.taintSource.handlerId), f.taintSource] as const] : []))).entries()];
  const external = [...new Set(findings.flatMap((f) => f.externalTargets))];
  return (
    <>
      {sources.length > 0 && (
        <Section title="Source error">
          {sources.map(([id, source]) => {
            const sourceItem = index.byId.get(source.occurrenceId);
            const message = sourceItem?.throws.find((t) => t.handlerId === source.handlerId)?.message;
            return sourceItem ? (
              <button key={id} className="link source-error" onClick={() => selectIssue({ type: 'throw', id }, source.occurrenceId)}>
                <HandlerRef>{index.nodes.get(source.handlerId)?.label ?? source.handlerId}</HandlerRef> {message ? `threw: ${message}` : 'reported an error'} →
              </button>
            ) : (
              <p key={id} className="hint">The source error is no longer in the recording.</p>
            );
          })}
        </Section>
      )}
      <Section title={<EventRef>{eventLabel(index, item)}</EventRef>} aside={tier && <TierBadge tier={tier} />}>
        <div className="row-badges">
          <Badge tone="warn">⚠ Corrupt Payload</Badge>
          {external.length > 0 && <Badge tone="external" title={external.join(', ')}>EXTERNAL · {external.join(', ')}</Badge>}
          {[...new Set(findings.map((f) => f.confidence))].map((c) => <Badge key={c} tone="muted">{c} confidence</Badge>)}
          {findings.some((f) => f.basis === 'shape') && <Badge tone="muted">shape comparison only</Badge>}
          {findings.some((f) => f.retroactive) && <Badge tone="muted">found after the fact</Badge>}
        </div>
        <EventFacts index={index} item={item} />
      </Section>
      <PayloadSection item={item} findings={findings} />
    </>
  );
}
