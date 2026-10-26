/** Which events keep their full payload ("deep logging"). Everything else is template-only. */
export type CaptureRule =
  | { events?: string[] | ((eventName: string, emitterLabel: string) => boolean) }
  | undefined;

export function matchesCapture(rule: CaptureRule, eventName: string, emitterLabel: string): boolean {
  const events = rule?.events;
  if (!events) return false;
  return typeof events === 'function' ? events(eventName, emitterLabel) : events.includes(eventName);
}
