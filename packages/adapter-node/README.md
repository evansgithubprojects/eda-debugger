# @eda-debugger/adapter-node

Records Node `EventEmitter` emits with their handlers, timings, errors and cause.

```ts
import { enableNodeRecording } from '@eda-debugger/adapter-node';
const uninstall = enableNodeRecording(recorder);
```

Or `import '@eda-debugger/adapter-node/auto'` to record on the shared recorder with no setup. Node internals (streams, sockets, `process`, fs handles, workers) are ignored unless you pass `includeInternals: true`.
