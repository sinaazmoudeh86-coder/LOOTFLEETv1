// =============================================================================
//  render.ts — TIER-AWARE PUBLISHING
// -----------------------------------------------------------------------------
//  Turns a tick's worth of events into Discord messages. The whole point is that
//  the CHANNEL, not the collector, decides how loud something is.
//
//  THE PROBLEM THIS REPLACES. The old publish block did:
//
//      events.sort(by PRIORITY); post(events.slice(0, 10));
//      content = "…and N more: " + the rest, as a grey line
//
//  which has three failures. A busy tick could push a crown out of the ten if
//  enough mid-tier events sorted above it. Ten cards of identical visual weight
//  read as noise regardless of what they said. And the overflow line was a
//  dumping ground: the events nobody cared about and the events that just missed
//  the cut were presented identically.
//
//  WHAT THIS DOES INSTEAD.
//
//    · HEADLINES GO FIRST, IN THEIR OWN MESSAGE, under a full-width banner, and
//      are never dropped for volume. If four land at once, four cards go out.
//    · NOTABLES fill a second message, up to the embed cap, sorted by priority.
//    · AMBIENT NEVER GETS A CARD. It is rolled into a single digest embed at the
//      foot of the notable message — grouped by feature, so "three systems
//      claimed, two pilots joined" reads as one line each instead of five cards.
//    · OVERFLOW is stated honestly and only counts what was actually cut.
//
//  The net effect: a quiet tick posts one small message, a busy tick posts a
//  loud one and a tidy one, and the crown is never the thing that got cut.
// =============================================================================

import { DEF, PRIORITY, TIER_OF, bannerFor, type Tier } from './catalog.ts';

export interface Ev {
  kind: string;
  /** One-line plaintext form, used in digests and overflow. */
  line: string;
  embed: Record<string, unknown>;
  /** Optional grouping key for ambient rollup (actor, system, …). */
  actor?: string;
  sys?: string;
}

const MAX_EMBEDS = 10;
const prio = (k: string) => { const i = PRIORITY.indexOf(k); return i < 0 ? 999 : i; };

export function split(events: Ev[]) {
  const byTier: Record<Tier, Ev[]> = { headline: [], notable: [], ambient: [] };
  for (const e of events) byTier[TIER_OF(e.kind)].push(e);
  for (const t of Object.keys(byTier) as Tier[]) {
    byTier[t].sort((a, b) => prio(a.kind) - prio(b.kind));
  }
  return byTier;
}

// AMBIENT ROLLUP. Groups by event kind and states the count, then names up to
// three actors. "⚑ 4 systems claimed — Vex, Orin, Rell +1" carries the same
// information as four cards and costs one line.
export function ambientDigest(rows: Ev[]): Record<string, unknown> | null {
  if (!rows.length) return null;
  const groups = new Map<string, Ev[]>();
  for (const e of rows) {
    if (!groups.has(e.kind)) groups.set(e.kind, []);
    groups.get(e.kind)!.push(e);
  }
  const lines: string[] = [];
  for (const [kind, list] of [...groups.entries()].sort((a, b) => prio(a[0]) - prio(b[0]))) {
    const d = DEF(kind);
    if (list.length === 1) { lines.push(`${d.icon} ${list[0].line}`); continue; }
    const who = [...new Set(list.map((e) => e.actor).filter(Boolean))] as string[];
    const names = who.slice(0, 3).join(', ') + (who.length > 3 ? ` +${who.length - 3}` : '');
    lines.push(`${d.icon} **${list.length}×** ${d.label.toLowerCase()}${names ? ` — ${names}` : ''}`);
  }
  return {
    color: 0x39465c,
    description: lines.join('\n'),
    author: { name: 'ALSO THIS TICK' },
  };
}

export function stamp(e: Ev, now: string, footer: string) {
  return { ...e.embed, timestamp: now, footer: { text: footer } };
}

// The banner is chosen from the loudest headline present. Two crowns in one tick
// share one header rather than stacking two full-width titles.
export function headlineBanner(rows: Ev[]): string {
  if (!rows.length) return '';
  const top = rows[0];
  const others = rows.length - 1;
  return bannerFor(top.kind, others > 0
    ? `…and ${others} more headline${others === 1 ? '' : 's'} this tick.`
    : undefined);
}

export { MAX_EMBEDS };
