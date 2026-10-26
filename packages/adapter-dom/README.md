# @eda-debugger/adapter-dom

Records DOM `EventTarget` activity, including native events such as clicks and `dispatchEvent`.

```ts
import { enableDomRecording } from '@eda-debugger/adapter-dom';
const uninstall = enableDomRecording(recorder, { label: (t) => (t === document ? 'Page' : undefined) });
```
