import type { ExtractionContext, PlayEvent, Team, TeamSide } from '@/core/types';

const fmtClock = (s: number | null) =>
  s === null ? 'unknown' : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

function rosterBlock(side: TeamSide, t: Team): string {
  const roster = t.roster.length
    ? t.roster
        .slice()
        .sort((a, b) => a.number - b.number)
        .map((p) => `#${p.number} ${p.name}${p.position ? ` (${p.position})` : ''}`)
        .join(', ')
    : '(no roster provided)';
  return `${side.toUpperCase()} = ${t.name} [scorebug: ${t.abbr}]${t.jersey ? `, jerseys: ${t.jersey}` : ''}\nRoster: ${roster}`;
}

function playLine(p: PlayEvent): string {
  const sit = p.down ? `${p.down}&${p.distance ?? '?'} at ${p.ballOn ?? '?'}` : 'no down';
  return `- Q${p.quarter} ${fmtClock(p.clock)} ${p.offense} ${sit}: ${p.description}`;
}

/** The instruction text sent with each clip. */
export function buildPrompt(ctx: ExtractionContext): string {
  const s = ctx.state;
  const state =
    `Quarter ${s.quarter}, clock ${fmtClock(s.clock)}, score home ${s.score.home} - away ${s.score.away}, ` +
    (s.possession
      ? `${s.possession} ball, ${s.down ?? '?'} & ${s.distance ?? '?'} at ballOn ${s.ballOn ?? '?'}`
      : 'possession unknown');
  const recent = ctx.recentPlays.length
    ? ctx.recentPlays.map(playLine).join('\n')
    : '(none yet)';

  return `You are an expert American football statistician charting a game from a short broadcast clip (video with announcer audio).

TEAMS
${rosterBlock('home', ctx.home)}
${rosterBlock('away', ctx.away)}

GAME STATE BEFORE THIS CLIP (best estimate, may be slightly stale)
${state}

PLAYS ALREADY CHARTED (most recent last). This clip overlaps the previous one, so some of these may appear again; chart them again anyway with accurate timestamps, de-duplication happens later.
${recent}

TASK
Report every play that is snapped or kicked in this clip, in order. Ignore replays, highlights of earlier plays, commercials and crowd shots: only chart live action. If no live play occurs, return an empty list.

HOW TO DETERMINE EACH FACT (use all three, and cross-check them)
1. Scorebug / on-screen graphics: down & distance, quarter, clock, score, and the yard line if shown. Most reliable for the situation.
2. Announcers: player names and numbers, yardage ("gain of six"), results, penalties. Match names to the rosters above to get jersey numbers.
3. Video: read jersey numbers of the ball carrier, passer, receiver, tacklers and kicker; read the first-down marker / chains, yard-line numbers and hash marks to judge the spot and the gain.
Prefer a jersey number you can see AND that the announcer confirms. Only report numbers that exist on that team's roster when a roster is given, unless you clearly see otherwise. Use null rather than guessing.

FIELD CONVENTIONS
- "home" / "away" as defined above.
- offense = team snapping or kicking the ball.
- ballOn = yards from the offense's OWN goal line, 1-99 (own 25 -> 25, opponent's 20 -> 80), before the snap.
- yards = net gain for rush/pass/sack/kneel (negative for a loss; 0 for incomplete or intercepted passes); kick distance for punt/kickoff/field_goal.
- clock = seconds left in the quarter at the snap, or null.
- A scramble by the quarterback past the line is a rush; a quarterback tackled behind the line while trying to pass is a sack.
- firstDown = the offense earned a first down on this play (for a touchdown, set touchdown true and firstDown false).
- A penalty with no play (false start, offside that kills the play...) is type "penalty_only". A penalty that wipes out a play is listed on that play with noPlay true.
- startSec / endSec = seconds from the start of the clip to the snap and to the whistle.
- complete = false if the clip starts after the snap or ends before the play is over.

CONFIDENCE (0 to 1, be honest; low numbers are useful)
- players: are the jersey numbers right?
- yards: is the yardage / result right?
- situation: are down, distance, ballOn and offense right?
Also list which evidence you used: scorebug, announcer, visual.

Also report the scorebug as shown at the END of the clip, if visible.
Return JSON only, matching the provided schema.`;
}
