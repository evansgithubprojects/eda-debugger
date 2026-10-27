import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRecorder } from '@eda-debugger/core';
import { startBridge } from '@eda-debugger/core/bridge-node';
import { enableNodeRecording } from '@eda-debugger/adapter-node';
import { createShop } from './app';

const live = process.argv.includes('--live');
const block = process.argv.includes('--block');

const recorder = createRecorder({
  deepLogging: { events: ['order:confirmed', 'charge', 'notify'] },
  corruption: { notify: 'console', policy: block ? 'block' : 'notify' },
});
const uninstall = enableNodeRecording(recorder);
const shop = createShop((e, name) => recorder.labelEmitter(e, name), (fn) => recorder.markExternal(fn));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function scenario() {
  for (let i = 1; i <= 4; i++) {
    shop.login(i);
    for (const total of [20 + i, 35 + i, 50 + i, 18 + i]) {
      shop.checkout(total);
      await sleep(live ? 150 : 2);
    }
  }
  shop.checkout(44, 'rounding-bug'); // no error thrown, but a wrong-typed total reaches the ledger API
  await sleep(live ? 400 : 20);
  shop.checkout(45, 'bad-address'); // no error thrown, an internal notification loses its recipient
  await sleep(live ? 400 : 20);
  shop.checkout(41, 'chargeback'); // handler emits partial data, then throws
  await sleep(live ? 400 : 20);
  shop.checkout(37, 'fraud-risk'); // handler reports an error, then keeps going with NaN
  await sleep(live ? 400 : 20);
  shop.checkout(30);
  shop.login(9);
}

if (live) {
  const bridge = await startBridge(recorder, { port: 7777 });
  console.log(`[demo] streaming on http://127.0.0.1:${bridge.port} (open the viewer and press "Connect live")`);
  for (;;) {
    await scenario();
    await sleep(1500);
  }
} else {
  await scenario();
  uninstall();
  const out = fileURLToPath(new URL('../../viewer/public/samples/demo.json', import.meta.url));
  mkdirSync(new URL('.', `file://${out}`), { recursive: true });
  const recording = recorder.export();
  writeFileSync(out, JSON.stringify(recording));
  console.log(
    `[demo] wrote ${recording.occurrences.length} events, ${recording.templates.length} templates, ` +
      `${recording.findings?.length ?? 0} suspected-corrupt findings -> ${out}`,
  );
}
