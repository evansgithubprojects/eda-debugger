/**
 * Side-effect import: `import '@eda-debugger/adapter-eventemitter/auto'` starts recording on the shared recorder
 * (see `enable()` in `@eda-debugger/core`) with default options. Use `enableEventEmitterRecording` to configure it.
 */
import { enableEventEmitterRecording } from './index';

enableEventEmitterRecording();
