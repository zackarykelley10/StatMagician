import type { Game, GameStats, PlayerStats, PlayEvent, TeamSide, TeamStats } from '@/core/types';
import { otherSide } from '@/core/types';
import { pointsForPlay } from '@/core/defaults';

const emptyTeam = (team: TeamSide): TeamStats => ({
  team,
  points: 0,
  firstDowns: 0,
  totalPlays: 0,
  totalYards: 0,
  rushAtt: 0,
  rushYards: 0,
  passAtt: 0,
  passComp: 0,
  passYards: 0,
  sacksAllowed: 0,
  sackYardsLost: 0,
  turnovers: 0,
  interceptionsThrown: 0,
  fumblesLost: 0,
  penalties: 0,
  penaltyYards: 0,
  thirdDownAtt: 0,
  thirdDownConv: 0,
  fourthDownAtt: 0,
  fourthDownConv: 0,
  punts: 0,
  puntYards: 0,
});

const emptyPlayer = (team: TeamSide, number: number, name: string): PlayerStats => ({
  team,
  number,
  name,
  passing: { att: 0, comp: 0, yards: 0, td: 0, int: 0, sacked: 0, sackYards: 0, long: 0 },
  rushing: { att: 0, yards: 0, td: 0, long: 0, fumbles: 0 },
  receiving: { targets: 0, rec: 0, yards: 0, td: 0, long: 0 },
  defense: { tackles: 0, sacks: 0, int: 0, fumbleRecoveries: 0 },
  kicking: { fgMade: 0, fgAtt: 0, fgLong: 0, xpMade: 0, xpAtt: 0 },
  punting: { punts: 0, yards: 0, long: 0 },
  returns: { kickReturns: 0, kickReturnYards: 0, puntReturns: 0, puntReturnYards: 0 },
});

const hasStat = (p: PlayerStats): boolean =>
  [p.passing, p.rushing, p.receiving, p.defense, p.kicking, p.punting, p.returns].some((g) =>
    Object.values(g).some((v) => v !== 0),
  );

const has = (n: number | null | undefined): n is number => n !== null && n !== undefined;

export function computeStats(game: Game, plays: PlayEvent[]): GameStats {
  const teams: Record<TeamSide, TeamStats> = { home: emptyTeam('home'), away: emptyTeam('away') };
  const players = new Map<string, PlayerStats>();

  const player = (team: TeamSide, number: number | null | undefined): PlayerStats | null => {
    if (!has(number)) return null;
    const key = `${team}:${number}`;
    let p = players.get(key);
    if (!p) {
      const name = game[team].roster.find((r) => r.number === number)?.name || `#${number}`;
      p = emptyPlayer(team, number, name);
      players.set(key, p);
    }
    return p;
  };

  const ordered = plays.filter((p) => p.status !== 'deleted').sort((a, b) => a.seq - b.seq);

  for (const p of ordered) {
    const off = p.offense;
    const def = otherSide(off);

    // Penalties always count, even on wiped plays.
    for (const pen of p.penalties) {
      if (!pen.accepted) continue;
      teams[pen.team].penalties += 1;
      teams[pen.team].penaltyYards += pen.yards;
    }

    const wiped = p.type === 'penalty_only' || p.penalties.some((x) => x.accepted && x.noPlay);
    if (wiped) {
      if (p.firstDown) teams[off].firstDowns += 1;
      continue;
    }

    const pts = pointsForPlay(p);
    if (pts) teams[pts.team].points += pts.points;
    if (p.firstDown) teams[off].firstDowns += 1;

    const offScored = (p.scoringTeam ?? off) === off;
    const offTD = p.touchdown && offScored;
    const T = teams[off];
    let scrimmage = false;

    switch (p.type) {
      case 'rush':
      case 'kneel': {
        const r = player(off, p.rusher ?? (p.type === 'kneel' ? p.passer : null));
        T.rushAtt += 1;
        T.rushYards += p.yards;
        T.totalPlays += 1;
        if (r) {
          r.rushing.att += 1;
          r.rushing.yards += p.yards;
          r.rushing.long = Math.max(r.rushing.long, p.yards);
          if (p.type === 'rush' && offTD) r.rushing.td += 1;
        }
        scrimmage = p.type === 'rush';
        break;
      }
      case 'pass': {
        const qb = player(off, p.passer);
        const tgt = player(off, p.target);
        T.passAtt += 1;
        T.totalPlays += 1;
        scrimmage = true;
        if (qb) qb.passing.att += 1;
        if (tgt) tgt.receiving.targets += 1;
        if (p.passResult === 'complete') {
          T.passComp += 1;
          T.passYards += p.yards;
          if (qb) {
            qb.passing.comp += 1;
            qb.passing.yards += p.yards;
            qb.passing.long = Math.max(qb.passing.long, p.yards);
            if (offTD) qb.passing.td += 1;
          }
          if (tgt) {
            tgt.receiving.rec += 1;
            tgt.receiving.yards += p.yards;
            tgt.receiving.long = Math.max(tgt.receiving.long, p.yards);
            if (offTD) tgt.receiving.td += 1;
          }
        } else if (p.passResult === 'intercepted') {
          if (qb) qb.passing.int += 1;
          const ib = player(def, p.interceptedBy);
          if (ib) ib.defense.int += 1;
          T.interceptionsThrown += 1;
          T.turnovers += 1;
        }
        break;
      }
      case 'spike': {
        const qb = player(off, p.passer);
        if (qb) qb.passing.att += 1;
        T.passAtt += 1;
        T.totalPlays += 1;
        break;
      }
      case 'sack': {
        const lost = -p.yards;
        const qb = player(off, p.passer);
        if (qb) {
          qb.passing.sacked += 1;
          qb.passing.sackYards += lost;
        }
        T.sacksAllowed += 1;
        T.sackYardsLost += lost;
        T.passYards -= lost;
        T.totalPlays += 1;
        scrimmage = true;
        if (p.tacklers.length > 0) {
          for (const n of p.tacklers) {
            const d = player(def, n);
            if (d) d.defense.sacks += 1 / p.tacklers.length;
          }
        }
        break;
      }
      case 'field_goal': {
        const k = player(off, p.kicker);
        if (k) k.kicking.fgAtt += 1;
        if (p.kickResult === 'good' && k) {
          k.kicking.fgMade += 1;
          k.kicking.fgLong = Math.max(k.kicking.fgLong, p.yards);
        }
        break;
      }
      case 'extra_point': {
        const k = player(off, p.kicker);
        if (k) {
          k.kicking.xpAtt += 1;
          if (p.kickResult === 'good') k.kicking.xpMade += 1;
        }
        break;
      }
      case 'punt': {
        const k = player(off, p.kicker);
        T.punts += 1;
        T.puntYards += p.yards;
        if (k) {
          k.punting.punts += 1;
          k.punting.yards += p.yards;
          k.punting.long = Math.max(k.punting.long, p.yards);
        }
        const ret = player(def, p.returner);
        if (ret) {
          ret.returns.puntReturns += 1;
          ret.returns.puntReturnYards += p.returnYards ?? 0;
        }
        break;
      }
      case 'kickoff': {
        const ret = player(def, p.returner);
        if (ret) {
          ret.returns.kickReturns += 1;
          ret.returns.kickReturnYards += p.returnYards ?? 0;
        }
        break;
      }
      default:
        break;
    }

    // Fumbles
    let fumbleRecoveredByDefense = false;
    if (p.fumble) {
      const kickPlay = p.type === 'punt' || p.type === 'kickoff';
      const fumbleTeam: TeamSide = kickPlay ? def : off;
      const f = player(fumbleTeam, p.fumble.fumbledBy);
      if (f) f.rushing.fumbles += 1;
      if (p.fumble.recoveredByTeam !== fumbleTeam) {
        teams[fumbleTeam].fumblesLost += 1;
        teams[fumbleTeam].turnovers += 1;
        const rec = player(p.fumble.recoveredByTeam, p.fumble.recoveredBy);
        if (rec) rec.defense.fumbleRecoveries += 1;
        if (!kickPlay && p.fumble.recoveredByTeam === def) fumbleRecoveredByDefense = true;
      }
    }

    // Tackles
    let tackleTeam: TeamSide;
    if (p.type === 'punt' || p.type === 'kickoff') tackleTeam = off;
    else if (p.passResult === 'intercepted' || fumbleRecoveredByDefense) tackleTeam = off;
    else tackleTeam = def;
    for (const n of p.tacklers) {
      const d = player(tackleTeam, n);
      if (d) d.defense.tackles += 1;
    }

    // Third / fourth down
    if (scrimmage && (p.down === 3 || p.down === 4)) {
      const conv = p.firstDown || offTD;
      if (p.down === 3) {
        T.thirdDownAtt += 1;
        if (conv) T.thirdDownConv += 1;
      } else {
        T.fourthDownAtt += 1;
        if (conv) T.fourthDownConv += 1;
      }
    }
  }

  for (const s of ['home', 'away'] as const) {
    teams[s].totalYards = teams[s].rushYards + teams[s].passYards;
  }

  const out = [...players.values()].filter(hasStat);
  out.sort((a, b) => (a.team === b.team ? a.number - b.number : a.team === 'home' ? -1 : 1));
  return { teams, players: out };
}
