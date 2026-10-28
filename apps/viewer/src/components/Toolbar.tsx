import type { Recording } from '@eda-debugger/core';
import { useRef, useState } from 'react';
import { useStore } from '../store';

export async function loadSample(): Promise<boolean> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}samples/demo.json`);
    if (!res.ok) return false;
    useStore.getState().load((await res.json()) as Recording, 'sample: demo.json');
    return true;
  } catch {
    return false;
  }
}

export async function loadFile(file: File): Promise<string | null> {
  try {
    const data = JSON.parse(await file.text()) as Recording;
    if (!Array.isArray(data.occurrences) || !Array.isArray(data.templates) || !Array.isArray(data.nodes)) {
      return 'That file is not an event chain recording.';
    }
    useStore.getState().load(data, file.name);
    return null;
  } catch {
    return 'Could not read that file as JSON.';
  }
}

export function Toolbar({ onError }: { onError: (msg: string | null) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState('http://127.0.0.1:7777');
  const { sourceName, live } = useStore();
  const { connectLive, disconnectLive } = useStore.getState();

  return (
    <header className="toolbar">
      <h1>Event Chain Debugger</h1>
      <span className="spacer" />
      {sourceName && <span className="muted source">{sourceName}</span>}
      <input
        ref={input}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (f) onError(await loadFile(f));
          e.target.value = '';
        }}
      />
      <button onClick={() => input.current?.click()}>Open recording…</button>
      <button onClick={async () => onError((await loadSample()) ? null : 'No sample found. Run `npm run demo` to generate one.')}>Load sample</button>
      <span className="live-box">
        <input value={url} onChange={(e) => setUrl(e.target.value)} aria-label="Live stream URL" size={22} />
        {live === 'off' || live === 'error' ? (
          <button onClick={() => connectLive(url)}>Connect live</button>
        ) : (
          <button onClick={disconnectLive}>Disconnect ({live})</button>
        )}
      </span>
    </header>
  );
}
