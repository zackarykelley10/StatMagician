import type { Player } from '@/core/types';

/** Jersey numbers are 0-99 (one or two digits). */
const NUMBER = /^\d{1,2}$/;
/** Positions are 1-4 uppercase letters, e.g. QB, WR, OLB. */
const POSITION = /^[A-Z]{1,4}$/;
/** Used to accept a bare trailing position in space-separated lines ("12 John Smith QB" or "12 John QB"). */
const KNOWN_POSITIONS = new Set([
  'QB', 'RB', 'WR', 'TE', 'OL', 'DL', 'LB', 'DB', 'OLB', 'ILB', 'MLB', 'CB', 'S', 'FS', 'SS',
  'DE', 'DT', 'NT', 'OT', 'OG', 'C', 'G', 'T', 'K', 'P', 'LS', 'KR', 'PR', 'ATH', 'FB', 'HB', 'NB',
]);

function parseLine(raw: string): Player | null {
  const line = raw.trim().replace(/^#\s*/, '');
  if (line === '') return null;

  let numberText: string;
  let name: string;
  let position: string | undefined;

  if (line.includes('\t') || line.includes(',')) {
    // Delimited: "12, John Smith, QB" or "12<TAB>John Smith<TAB>QB".
    const sep = line.includes('\t') ? '\t' : ',';
    const parts = line.split(sep).map((s) => s.trim());
    numberText = parts[0] ?? '';
    name = parts[1] ?? '';
    const pos = parts[2];
    if (pos && POSITION.test(pos)) position = pos;
  } else {
    // Space-separated: "12 John Smith" or "12 John Smith QB".
    const tokens = line.split(/\s+/);
    numberText = tokens[0] ?? '';
    const rest = tokens.slice(1);
    const last = rest[rest.length - 1];
    if (last && rest.length > 1 && (KNOWN_POSITIONS.has(last) || (rest.length >= 3 && POSITION.test(last)))) {
      position = last;
      rest.pop();
    }
    name = rest.join(' ');
  }

  if (!NUMBER.test(numberText)) return null;
  name = name.replace(/\s+/g, ' ').trim();
  if (name === '') return null;

  const player: Player = { number: Number(numberText), name };
  if (position) player.position = position;
  return player;
}

/**
 * Parses pasted roster text, one player per line. Blank and invalid lines are skipped.
 * Duplicate numbers keep the last occurrence. Result is sorted by jersey number.
 */
export function parseRoster(text: string): Player[] {
  const byNumber = new Map<number, Player>();
  for (const raw of text.split(/\r?\n/)) {
    const player = parseLine(raw);
    if (player) byNumber.set(player.number, player);
  }
  return [...byNumber.values()].sort((a, b) => a.number - b.number);
}

/** Inverse of parseRoster: one "12, John Smith, QB" line per player. */
export function formatRoster(players: Player[]): string {
  return players
    .map((p) => (p.position ? `${p.number}, ${p.name}, ${p.position}` : `${p.number}, ${p.name}`))
    .join('\n');
}
