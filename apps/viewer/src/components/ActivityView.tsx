import { useMemo } from 'react';
import { chainOf, eventLabel, inWindow } from '../replay';
import { useStore } from '../store';
import { Badge, CaptureBadge, FindingBadges, fmtMs, Json } from './common';

/** Zoom level 3: everything one handler has been doing. */
export function ActivityView({ nodeId }: { nodeId: string }) {
  const index = useStore((s) => s.index)!;
  const window = useStore((s) => s.window);
  const seek = useStore((s) => s.seekToOccurrence);
  const close = useStore((s) => s.closeActivity);
  const node = index.nodes.get(nodeId);

  const rows = useMemo(
    () =>
      inWindow(index, window).flatMap((i) => {
        const out: { i: typeof i; dir: 'handled' | 'emitted'; ms?: number; error?: string }[] = [];
        const result = i.occ.handlerResults.find((r) => r.handlerId === nodeId);
        if (i.template.handlerIds.includes(nodeId)) out.push({ i, dir: 'handled', ms: result?.durationMs, error: result?.error?.message });
        if (i.occ.sourceNodeId === nodeId) out.push({ i, dir: 'emitted' });
        return out;
      }),
    [index, window, nodeId],
  );
  if (!node) return null;

  const handled = rows.filter((r) => r.dir === 'handled');
  const errors = handled.filter((r) => r.error);
  const avg = handled.length ? handled.reduce((n, r) => n + (r.ms ?? 0), 0) / handled.length : 0;
  const span = Math.max(window[1] - window[0], 1);

  return (
    <div className="activity activity-enter">
      <header>
        <button onClick={close}>← Back to graph</button>
        <h2>{node.label}</h2>
        <Badge tone="muted">{index.processLabel.get(node.processId)}</Badge>
        <span className="muted">handled {handled.length} · emitted {rows.length - handled.length} · avg {fmtMs(avg)}</span>
        {errors.length > 0 && <Badge tone="error">✕ {errors.length} threw</Badge>}
      </header>

      <svg className="mini" viewBox="0 0 1000 24" preserveAspectRatio="none" aria-label="Activity over time">
        {rows.map((r, k) => {
          const x = ((r.i.occ.ts - window[0]) / span) * 1000;
          const cls = r.error ? 'dot-error' : index.findingsByOcc.has(r.i.occ.id) ? 'dot-warn' : r.dir === 'handled' ? 'dot-in' : 'dot-out';
          return <circle key={k} cx={x} cy={r.dir === 'handled' ? 8 : 17} r={3} className={cls} />;
        })}
      </svg>

      <div className="table-wrap">
        <table className="activity-table">
          <thead>
            <tr><th>Timestamp</th><th></th><th>Caller</th><th>Emitted from</th><th>Received Data</th><th>Took</th><th>Result</th></tr>
          </thead>
          <tbody>
            {rows.map((r, k) => {
              const chain = chainOf(index, r.i.occ.id).slice(0, -1);
              const findings = index.findingsByOcc.get(r.i.occ.id);
              return (
                <tr key={k} className={r.error ? 'row-error' : ''} onClick={() => seek(r.i.occ.id)}>
                  <td>{fmtMs(r.i.occ.ts - index.start)}</td>
                  <td><Badge tone="muted">{r.dir}</Badge></td>
                  <td>{eventLabel(index, r.i)}</td>
                  <td className="muted">{chain.length ? chain.map((c) => eventLabel(index, c)).join(' ▸ ') : 'root'}</td>
                  <td>
                    <CaptureBadge occ={r.i.occ} /> <FindingBadges findings={findings} />
                    {r.i.occ.capture === 'full' ? <Json value={r.i.occ.payload} /> : <code className="shape">{r.i.template.payloadShape}</code>}
                  </td>
                  <td>{r.ms !== undefined ? fmtMs(r.ms) : '—'}</td>
                  <td>{r.error ? <span className="err">✕ {r.error}</span> : r.dir === 'handled' ? 'ok' : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && <p className="hint">This handler did nothing in the selected window.</p>}
      </div>
    </div>
  );
}
