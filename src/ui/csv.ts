import {
  isCounted,
  type Game,
  type GameStats,
  type PlayEvent,
  type TeamSide,
  type TeamStats,
} from '@/core/types';

type Cell = string | number;

function escapeCell(value: Cell): string {
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** RFC 4180 CSV: quotes cells containing commas, quotes or line breaks; CRLF line endings. */
export function toCsv(rows: Cell[][]): string {
  return rows.map((row) => row.map(escapeCell).join(',') + '\r\n').join('');
}

const avg = (total: number, count: number): string => (count > 0 ? (total / count).toFixed(1) : '0.0');

export interface TeamStatLine {
  label: string;
  value: (t: TeamStats) => Cell;
}

/** Team comparison rows, shared by the CSV export and the on-screen table. */
export const TEAM_STAT_LINES: TeamStatLine[] = [
  { label: 'Points', value: (t) => t.points },
  { label: 'First downs', value: (t) => t.firstDowns },
  { label: 'Total plays', value: (t) => t.totalPlays },
  { label: 'Total yards', value: (t) => t.totalYards },
  { label: 'Rushing attempts', value: (t) => t.rushAtt },
  { label: 'Rushing yards', value: (t) => t.rushYards },
  { label: 'Completions-attempts', value: (t) => `${t.passComp}-${t.passAtt}` },
  { label: 'Passing yards', value: (t) => t.passYards },
  { label: 'Sacks allowed-yards lost', value: (t) => `${t.sacksAllowed}-${t.sackYardsLost}` },
  { label: 'Turnovers', value: (t) => t.turnovers },
  { label: 'Interceptions thrown', value: (t) => t.interceptionsThrown },
  { label: 'Fumbles lost', value: (t) => t.fumblesLost },
  { label: 'Penalties-yards', value: (t) => `${t.penalties}-${t.penaltyYards}` },
  { label: 'Third down', value: (t) => `${t.thirdDownConv}-${t.thirdDownAtt}` },
  { label: 'Fourth down', value: (t) => `${t.fourthDownConv}-${t.fourthDownAtt}` },
  { label: 'Punts-avg', value: (t) => `${t.punts}-${avg(t.puntYards, t.punts)}` },
];

export function teamStatsCsv(game: Game, stats: GameStats): string {
  const rows: Cell[][] = [['Stat', game.home.name, game.away.name]];
  for (const line of TEAM_STAT_LINES) {
    rows.push([line.label, line.value(stats.teams.home), line.value(stats.teams.away)]);
  }
  return toCsv(rows);
}

type StatCategory = 'passing' | 'rushing' | 'receiving' | 'defense' | 'kicking' | 'punting' | 'returns';

/** Every numeric field of PlayerStats, grouped by category. Column = `${prefix}_${snake(field)}`. */
const PLAYER_COLUMNS: { prefix: string; category: StatCategory; fields: string[] }[] = [
  { prefix: 'pass', category: 'passing', fields: ['att', 'comp', 'yards', 'td', 'int', 'sacked', 'sackYards', 'long'] },
  { prefix: 'rush', category: 'rushing', fields: ['att', 'yards', 'td', 'long', 'fumbles'] },
  { prefix: 'rec', category: 'receiving', fields: ['targets', 'rec', 'yards', 'td', 'long'] },
  { prefix: 'def', category: 'defense', fields: ['tackles', 'sacks', 'int', 'fumbleRecoveries'] },
  { prefix: 'kick', category: 'kicking', fields: ['fgMade', 'fgAtt', 'fgLong', 'xpMade', 'xpAtt'] },
  { prefix: 'punt', category: 'punting', fields: ['punts', 'yards', 'long'] },
  {
    prefix: 'ret',
    category: 'returns',
    fields: ['kickReturns', 'kickReturnYards', 'puntReturns', 'puntReturnYards'],
  },
];

const snake = (s: string): string => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

export function playerStatsCsv(game: Game, stats: GameStats): string {
  const header: Cell[] = [
    'Team',
    'Number',
    'Name',
    ...PLAYER_COLUMNS.flatMap((c) => c.fields.map((f) => `${c.prefix}_${snake(f)}`)),
  ];
  const rows: Cell[][] = [header];
  for (const p of stats.players) {
    const teamName = p.team === 'home' ? game.home.name : game.away.name;
    rows.push([
      teamName,
      p.number,
      p.name,
      ...PLAYER_COLUMNS.flatMap((c) =>
        c.fields.map((f) => (p[c.category] as Record<string, number>)[f] ?? 0),
      ),
    ]);
  }
  return toCsv(rows);
}

/** Seconds left in the quarter as M:SS, or '' when unknown. */
export function formatClock(seconds: number | null): string {
  if (seconds === null) return '';
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Play-by-play in seq order; deleted plays are excluded. */
export function playsCsv(game: Game, plays: PlayEvent[]): string {
  const teamName = (side: TeamSide): string => (side === 'home' ? game.home.name : game.away.name);
  const rows: Cell[][] = [
    ['seq', 'quarter', 'clock', 'offense', 'down', 'distance', 'ballOn', 'type', 'yards', 'description', 'confidence', 'status'],
  ];
  const counted = plays.filter(isCounted).sort((a, b) => a.seq - b.seq);
  for (const p of counted) {
    rows.push([
      p.seq,
      p.quarter,
      formatClock(p.clock),
      teamName(p.offense),
      p.down ?? '',
      p.distance ?? '',
      p.ballOn ?? '',
      p.type,
      p.yards,
      p.description,
      p.confidence.toFixed(2),
      p.status,
    ]);
  }
  return toCsv(rows);
}

/** Lowercase ASCII slug for filenames, e.g. "Lions vs Tigers!" -> "lions-vs-tigers". */
export function slugify(text: string): string {
  const slug = text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'game';
}

/** Saves text as a file through a temporary object URL and <a download>. */
export function downloadText(filename: string, text: string, mime = 'text/csv'): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
