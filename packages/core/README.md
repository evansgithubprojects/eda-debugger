# @eda-debugger/core

Recorder for the Event Chain Debugger. No DOM or Node-only imports (except the optional `@eda-debugger/core/bridge-node`).

- `createRecorder(opts)` / `enable(opts)`: record events with `recorder.dispatch(info, run)`; adapters call this for you.
- `recorder.export()`: a versioned JSON `Recording` for the viewer.
- `analyze(recording)`: retroactive suspected-corrupt-payload findings.
- `startBridge(recorder)` (`/bridge-node`): Server-Sent Events stream for live viewing.

See the repository README for the full picture.
