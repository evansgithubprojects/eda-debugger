import { createRecorder } from '@eda-debugger/core';
import { enableDomRecording } from '@eda-debugger/adapter-dom';

const recorder = createRecorder({
  deepLogging: { events: ['cart:changed', 'order:placed'] },
  corruption: { notify: 'console' },
});
enableDomRecording(recorder, { label: (t) => (t === document ? 'Page' : undefined) });

const $ = (id: string) => document.getElementById(id) as HTMLElement;
const log = (line: string) => ($('log').textContent += line + '\n');
let items = 0;

const cart = new EventTarget();
const payments = new EventTarget();
recorder.labelEmitter(cart, 'Cart');
recorder.labelEmitter(payments, 'Payments');

// Native clicks are the roots of the chains.
$('add').addEventListener('click', function addItem() {
  items++;
  cart.dispatchEvent(new CustomEvent('cart:changed', { detail: { items, total: items * 12 } }));
});
$('checkout').addEventListener('click', function startCheckout() {
  cart.dispatchEvent(new CustomEvent('checkout', { detail: { items, total: items * 12 } }));
});
$('fail').addEventListener('click', function startFailingCheckout() {
  cart.dispatchEvent(new CustomEvent('checkout', { detail: { items, total: items * 12, fail: true } }));
});

cart.addEventListener('cart:changed', function renderBadge(e) {
  log(`cart now has ${(e as CustomEvent).detail.items} item(s)`);
});
cart.addEventListener('checkout', function chargeCustomer(e) {
  payments.dispatchEvent(new CustomEvent('charge', { detail: (e as CustomEvent).detail }));
});
payments.addEventListener('charge', function chargeCard(e) {
  const order = (e as CustomEvent).detail;
  if (order.fail) {
    payments.dispatchEvent(new CustomEvent('order:placed', { detail: { id: 'ord_x', total: undefined } }));
    throw new Error('card declined');
  }
  payments.dispatchEvent(new CustomEvent('order:placed', { detail: { id: `ord_${Date.now() % 10000}`, total: order.total } }));
});
payments.addEventListener('order:placed', function showReceipt(e) {
  log(`order placed: ${JSON.stringify((e as CustomEvent).detail)}`);
});

window.addEventListener('error', (e) => log(`uncaught: ${e.message}`));

$('export').addEventListener('click', function exportRecording() {
  const blob = new Blob([JSON.stringify(recorder.export())], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'dom-recording.json';
  a.click();
  URL.revokeObjectURL(a.href);
});
