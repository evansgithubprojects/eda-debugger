# @eda-debugger/adapter-eventemitter

Records Node `EventEmitter` emits with their handlers, timings, errors and cause.

```ts
import { enableEventEmitterRecording } from '@eda-debugger/adapter-eventemitter';
const uninstall = enableEventEmitterRecording(recorder);
```

Or `import '@eda-debugger/adapter-eventemitter/auto'` to record on the shared recorder with no setup. Node internals (streams, sockets, `process`, fs handles, workers) are ignored unless you pass `includeInternals: true`.
