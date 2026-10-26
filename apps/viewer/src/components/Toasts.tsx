import { useStore } from '../store';
import { Badge } from './common';

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismissToast);
  const seek = useStore((s) => s.seekToOccurrence);
  const dismissAll = useStore((s) => s.dismissAllToasts);
  if (!toasts.length) return null;
  const MAX = 3;
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.length > MAX && (
        <div className="toast-more">
          {toasts.length - MAX} more suspected-corrupt finding(s) <button onClick={dismissAll}>Dismiss all</button>
        </div>
      )}
      {toasts.slice(0, MAX).map((t) => (
        <div key={t.id} className={`toast ${t.sticky ? 'toast-high' : ''}`}>
          <div className="toast-head">
            {t.sticky && <Badge tone="external">EXTERNAL</Badge>}
            <Badge tone="warn">⚠ suspected corrupt</Badge>
            <Badge tone="muted">{t.finding.confidence} confidence</Badge>
            {t.count > 1 && <Badge tone="muted" title="Times this has happened since you last dismissed it">×{t.count}</Badge>}
            <button className="icon" aria-label="Dismiss" onClick={() => dismiss(t.id)}>×</button>
          </div>
          <p>{t.summary}</p>
          <button onClick={() => { seek(t.finding.occurrenceId); if (!t.sticky) dismiss(t.id); }}>Jump to it</button>
        </div>
      ))}
    </div>
  );
}
