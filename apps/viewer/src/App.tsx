import { useEffect, useState } from 'react';
import { GraphView } from './components/GraphView';
import { Inspector } from './components/Inspector';
import { Timeline } from './components/Timeline';
import { loadFile, loadSample, Toolbar } from './components/Toolbar';
import { Toasts } from './components/Toasts';
import { usePlayback } from './hooks';
import { useStore } from './store';

export function App() {
  const index = useStore((s) => s.index);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  usePlayback();

  // `npm run demo` writes a sample next to the viewer; open it straight away when it is there.
  useEffect(() => { void loadSample(); }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, select, textarea')) return;
      if (e.code === 'Space') { e.preventDefault(); useStore.getState().togglePlay(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div
      className={`app ${dragging ? 'dragging' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={async (e) => {
        e.preventDefault();
        setDragging(false);
        const f = e.dataTransfer.files[0];
        if (f) setError(await loadFile(f));
      }}
    >
      <Toolbar onError={setError} />
      {error && <div className="banner" role="alert">{error} <button onClick={() => setError(null)}>Dismiss</button></div>}
      {index ? (
        <>
          <div className="main">
            <div className="canvas"><GraphView /></div>
            <Inspector />
          </div>
          <Timeline />
        </>
      ) : (
        <div className="welcome">
          <h2>Drop a recording here</h2>
          <p>Open a JSON export from <code>recorder.export()</code>, load the sample, or connect to a live stream.</p>
        </div>
      )}
      <Toasts />
    </div>
  );
}
