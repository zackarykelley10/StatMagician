import Dexie, { type Table } from 'dexie';
import type { Game, PlayEvent, Segment, Settings, Team } from '@/core/types';
import { DEFAULT_SETTINGS } from '@/core/defaults';

class FootballStatDb extends Dexie {
  games!: Table<Game, string>;
  plays!: Table<PlayEvent, string>;
  segments!: Table<Segment, string>;

  constructor() {
    super('football-stat-maker');
    this.version(1).stores({
      games: 'id',
      plays: 'id, gameId, [gameId+seq]',
      segments: 'id, gameId',
    });
  }
}

export const db = new FootballStatDb();

// ---------- Games ----------

export async function createGame(input: { title: string; home: Team; away: Team }): Promise<Game> {
  const game: Game = {
    id: crypto.randomUUID(),
    title: input.title,
    createdAt: Date.now(),
    home: input.home,
    away: input.away,
  };
  await db.games.add(game);
  return game;
}

export async function getGame(id: string): Promise<Game | undefined> {
  return db.games.get(id);
}

/** All games, newest first. Sorted in memory; the games table is small. */
export async function listGames(): Promise<Game[]> {
  const games = await db.games.toArray();
  return games.sort((a, b) => b.createdAt - a.createdAt);
}

export async function updateGame(game: Game): Promise<void> {
  await db.games.put(game);
}

/** Deletes a game together with its plays and segments, atomically. */
export async function deleteGame(id: string): Promise<void> {
  await db.transaction('rw', db.games, db.plays, db.segments, async () => {
    await db.plays.where('gameId').equals(id).delete();
    await db.segments.where('gameId').equals(id).delete();
    await db.games.delete(id);
  });
}

// ---------- Plays ----------

export async function putPlay(play: PlayEvent): Promise<void> {
  await db.plays.put(play);
}

export async function putPlays(plays: PlayEvent[]): Promise<void> {
  await db.plays.bulkPut(plays);
}

/** Plays for a game, ordered by seq ascending. */
export async function listPlays(gameId: string): Promise<PlayEvent[]> {
  return db.plays.where('[gameId+seq]').between([gameId, Dexie.minKey], [gameId, Dexie.maxKey]).toArray();
}

export async function deletePlaysForGame(gameId: string): Promise<void> {
  await db.plays.where('gameId').equals(gameId).delete();
}

// ---------- Segments ----------

export async function saveSegment(segment: Segment): Promise<void> {
  await db.segments.put(segment);
}

export async function getSegment(id: string): Promise<Segment | undefined> {
  return db.segments.get(id);
}

/** Deletes this game's segments whose id is not in keepIds. */
export async function pruneSegments(gameId: string, keepIds: string[]): Promise<void> {
  const keep = new Set(keepIds);
  const staleIds = await db.segments
    .where('gameId')
    .equals(gameId)
    .filter((s) => !keep.has(s.id))
    .primaryKeys();
  await db.segments.bulkDelete(staleIds);
}

// ---------- Settings (localStorage) ----------

const SETTINGS_KEY = 'fsm-settings';

export function loadSettings(): Settings {
  try {
    const raw = globalThis.localStorage?.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ...DEFAULT_SETTINGS };
    }
    return { ...DEFAULT_SETTINGS, ...(parsed as Partial<Settings>) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings): void {
  globalThis.localStorage?.setItem(SETTINGS_KEY, JSON.stringify(s));
}
