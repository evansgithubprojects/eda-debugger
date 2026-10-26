/** Append-only buffer evicted from the front by count and by time window. */
export class RingBuffer<T extends { ts: number }> {
  private items: T[] = [];

  constructor(public maxEvents: number, public windowMs: number) {}

  /** Pushes an item and returns whatever it evicted. */
  push(item: T): T[] {
    this.items.push(item);
    let drop = Math.max(0, this.items.length - this.maxEvents);
    const cutoff = item.ts - this.windowMs;
    while (drop < this.items.length - 1 && (this.items[drop] as T).ts < cutoff) drop++;
    return drop > 0 ? this.items.splice(0, drop) : [];
  }

  toArray(): T[] { return this.items.slice(); }
  get size(): number { return this.items.length; }
  clear(): T[] { const old = this.items; this.items = []; return old; }
}
