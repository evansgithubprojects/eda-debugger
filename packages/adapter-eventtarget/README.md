# @eda-debugger/adapter-eventtarget

Records DOM `EventTarget` activity, including native events such as clicks and `dispatchEvent`.

```ts
import { enableEventTargetRecording } from '@eda-debugger/adapter-eventtarget';
const uninstall = enableEventTargetRecording(recorder, { label: (t) => (t === document ? 'Page' : undefined) });
```
