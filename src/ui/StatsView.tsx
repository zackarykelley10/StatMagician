import { useMemo, useState, type ReactNode } from 'react';
import { computeStats } from '@/stats';
import { useApp } from '@/store';
import type { GameStats, PlayerStats, TeamSide } from '@/core/types';
import {
  TEAM_STAT_LINES,
  downloadText,
  playerStatsCsv,
  playsCsv,
  slugify,
  teamStatsCsv,
} from './csv';

type StatCategory = keyof Omit<PlayerStats, 'team' | 'number' | 'name'>;

interface Column {
  header: string;
  value: (p: PlayerStats) => ReactNode;
}

interface Section {
  title: string;
  category: StatCategory;
  /** Main column; rows sort by this descending. */
  sortKey: (p: PlayerStats) => number;
  columns: Column[];
}

/** Yards per attempt, guarded against divide-by-zero. */
const avg = (yards: number, n: number): string => (n > 0 ? (yards / n).toFixed(1) : '0.0');

const SECTIONS: Section[] = [
  {
    title: 'Passing',
    category: 'passing',
    sortKey: (p) => p.passing.yards,
    columns: [
      { header: 'C/ATT', value: (p) => `${p.passing.comp}/${p.passing.att}` },
      { header: 'YDS', value: (p) => p.passing.yards },
      { header: 'TD', value: (p) => p.passing.td },
      { header: 'INT', value: (p) => p.passing.int },
      { header: 'SACKED', value: (p) => p.passing.sacked },
    ],
  },
  {
    title: 'Rushing',
    category: 'rushing',
    sortKey: (p) => p.rushing.yards,
    columns: [
      { header: 'ATT', value: (p) => p.rushing.att },
      { header: 'YDS', value: (p) => p.rushing.yards },
      { header: 'AVG', value: (p) => avg(p.rushing.yards, p.rushing.att) },
      { header: 'TD', value: (p) => p.rushing.td },
      { header: 'LONG', value: (p) => p.rushing.long },
      { header: 'FUM', value: (p) => p.rushing.fumbles },
    ],
  },
  {
    title: 'Receiving',
    category: 'receiving',
    sortKey: (p) => p.receiving.yards,
    columns: [
      { header: 'TGT', value: (p) => p.receiving.targets },
      { header: 'REC', value: (p) => p.receiving.rec },
      { header: 'YDS', value: (p) => p.receiving.yards },
      { header: 'AVG', value: (p) => avg(p.receiving.yards, p.receiving.rec) },
      { header: 'TD', value: (p) => p.receiving.td },
      { header: 'LONG', value: (p) => p.receiving.long },
    ],
  },
  {
    title: 'Defense',
    category: 'defense',
    sortKey: (p) => p.defense.tackles,
    columns: [
      { header: 'TKL', value: (p) => p.defense.tackles },
      { header: 'SACK', value: (p) => p.defense.sacks },
      { header: 'INT', value: (p) => p.defense.int },
      { header: 'FR', value: (p) => p.defense.fumbleRecoveries },
    ],
  },
  {
    title: 'Kicking',
    category: 'kicking',
    sortKey: (p) => p.kicking.fgMade,
    columns: [
      { header: 'FG M/A', value: (p) => `${p.kicking.fgMade}/${p.kicking.fgAtt}` },
      { header: 'LONG', value: (p) => p.kicking.fgLong },
      { header: 'XP M/A', value: (p) => `${p.kicking.xpMade}/${p.kicking.xpAtt}` },
    ],
  },
  {
    title: 'Punting',
    category: 'punting',
    sortKey: (p) => p.punting.yards,
    columns: [
      { header: 'NO', value: (p) => p.punting.punts },
      { header: 'YDS', value: (p) => p.punting.yards },
      { header: 'AVG', value: (p) => avg(p.punting.yards, p.punting.punts) },
      { header: 'LONG', value: (p) => p.punting.long },
    ],
  },
  {
    title: 'Returns',
    category: 'returns',
    sortKey: (p) => p.returns.kickReturnYards + p.returns.puntReturnYards,
    columns: [
      { header: 'KR', value: (p) => p.returns.kickReturns },
      { header: 'KR YDS', value: (p) => p.returns.kickReturnYards },
      { header: 'PR', value: (p) => p.returns.puntReturns },
      { header: 'PR YDS', value: (p) => p.returns.puntReturnYards },
    ],
  },
];

/** A player appears in a section only if any of that category's numbers is non-zero. */
const hasActivity = (p: PlayerStats, category: StatCategory): boolean =>
  Object.values(p[category] as Record<string, number>).some((v) => v !== 0);

const playerLabel = (p: PlayerStats): string =>
  p.name === `#${p.number}` ? `#${p.number}` : `#${p.number} ${p.name}`;

const cellClass = 'px-2 py-1.5 text-right tabular-nums';

function PlayerTable({ section, players }: { section: Section; players: PlayerStats[] }) {
  const rows = players
    .filter((p) => hasActivity(p, section.category))
    .sort((a, b) => section.sortKey(b) - section.sortKey(a) || a.number - b.number);
  if (rows.length === 0) return null;

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
      <h3 className="border-b border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700">{section.title}</h3>
      <table className="min-w-full text-sm">
        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-2 py-1.5 text-left font-medium">Player</th>
            {section.columns.map((c) => (
              <th key={c.header} className="px-2 py-1.5 text-right font-medium">
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.number} className="border-t border-slate-100">
              <td className="px-2 py-1.5 text-left font-medium text-slate-800">{playerLabel(p)}</td>
              {section.columns.map((c) => (
                <td key={c.header} className={cellClass}>
                  {c.value(p)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const buttonClass =
  'rounded-md border border-emerald-600 px-3 py-1.5 text-sm font-medium text-emerald-700 hover:bg-emerald-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500';

export function StatsView() {
  const game = useApp((s) => s.game);
  const plays = useApp((s) => s.plays);
  const [side, setSide] = useState<TeamSide>('home');

  const stats = useMemo<GameStats | null>(() => (game ? computeStats(game, plays) : null), [game, plays]);

  if (!game || !stats) return null;

  const pendingReview = plays.filter((p) => p.status === 'needs_review').length;
  const slug = slugify(game.title);
  const teamPlayers = stats.players.filter((p) => p.team === side);
  const teams = { home: game.home, away: game.away } as const;
  const teamHasRows = SECTIONS.some((s) => teamPlayers.some((p) => hasActivity(p, s.category)));

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 text-slate-800">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">{game.title}</h2>
          <p className="text-sm text-slate-500">Game stats</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={buttonClass}
            onClick={() => downloadText(`${slug}-team-stats.csv`, teamStatsCsv(game, stats))}
          >
            Export team stats CSV
          </button>
          <button
            type="button"
            className={buttonClass}
            onClick={() => downloadText(`${slug}-player-stats.csv`, playerStatsCsv(game, stats))}
          >
            Export player stats CSV
          </button>
          <button
            type="button"
            className={buttonClass}
            onClick={() => downloadText(`${slug}-plays.csv`, playsCsv(game, plays))}
          >
            Export play-by-play CSV
          </button>
        </div>
      </header>

      {pendingReview > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {pendingReview} {pendingReview === 1 ? 'play is' : 'plays are'} waiting for review; stats include the
          AI&apos;s best guess for {pendingReview === 1 ? 'it' : 'them'}.
        </div>
      )}

      <section className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
        <h3 className="border-b border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700">Team comparison</h3>
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-2 py-1.5 text-left font-medium">Stat</th>
              <th className="px-2 py-1.5 text-right font-medium">{game.home.name}</th>
              <th className="px-2 py-1.5 text-right font-medium">{game.away.name}</th>
            </tr>
          </thead>
          <tbody>
            {TEAM_STAT_LINES.map((line) => (
              <tr key={line.label} className="border-t border-slate-100">
                <td className="px-2 py-1.5 text-left text-slate-700">{line.label}</td>
                <td className={cellClass}>{line.value(stats.teams.home)}</td>
                <td className={cellClass}>{line.value(stats.teams.away)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="space-y-4">
        <div role="tablist" className="inline-flex rounded-md border border-slate-200 bg-white p-0.5">
          {(['home', 'away'] as const).map((s) => (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={side === s}
              onClick={() => setSide(s)}
              className={`rounded px-3 py-1.5 text-sm font-medium ${
                side === s ? 'bg-emerald-600 text-white' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {teams[s].name}
            </button>
          ))}
        </div>

        {SECTIONS.map((section) => (
          <PlayerTable key={section.title} section={section} players={teamPlayers} />
        ))}
        {!teamHasRows && <p className="text-sm text-slate-500">No player stats for this team yet.</p>}
      </section>
    </div>
  );
}
