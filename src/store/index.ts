import { create } from 'zustand';
import type { Game, PlayData, PlayEvent, Settings, Team } from '@/core/types';
import * as db from '@/db';
import { confirmPlay } from '@/reconcile';
import type { PipelineStatus } from '@/reconcile/pipeline';

export type View = 'games' | 'live' | 'review' | 'stats' | 'settings';

interface AppState {
  view: View;
  games: Game[];
  /** The open game, or null when on the games list. */
  game: Game | null;
  /** All plays of the open game (any status), seq ascending. */
  plays: PlayEvent[];
  settings: Settings;
  pipelineStatus: PipelineStatus | null;

  setView(view: View): void;
  init(): Promise<void>;
  createGame(input: { title: string; home: Team; away: Team }): Promise<Game>;
  saveGame(game: Game): Promise<void>;
  removeGame(id: string): Promise<void>;
  openGame(id: string): Promise<void>;
  closeGame(): void;

  /** Called by the pipeline with the full, re-sequenced play list. */
  setPlays(plays: PlayEvent[]): void;
  /** Human edit: applies the patch and marks the play confirmed. */
  editPlay(id: string, patch: Partial<PlayData>): Promise<void>;
  /** Human accepts the play as-is. */
  acceptPlay(id: string): Promise<void>;
  /** Soft delete (status 'deleted'); stats and state ignore it. */
  deletePlay(id: string): Promise<void>;
  restorePlay(id: string): Promise<void>;

  setSettings(settings: Settings): void;
  setPipelineStatus(status: PipelineStatus | null): void;
}

export const useApp = create<AppState>((set, get) => {
  const replacePlay = async (next: PlayEvent) => {
    await db.putPlay(next);
    set({ plays: get().plays.map((p) => (p.id === next.id ? next : p)) });
  };
  const find = (id: string) => get().plays.find((p) => p.id === id);

  return {
    view: 'games',
    games: [],
    game: null,
    plays: [],
    settings: db.loadSettings(),
    pipelineStatus: null,

    setView: (view) => set({ view }),
    init: async () => set({ games: await db.listGames() }),
    createGame: async (input) => {
      const game = await db.createGame(input);
      set({ games: await db.listGames() });
      return game;
    },
    saveGame: async (game) => {
      await db.updateGame(game);
      set({ games: await db.listGames(), game: get().game?.id === game.id ? game : get().game });
    },
    removeGame: async (id) => {
      await db.deleteGame(id);
      set({ games: await db.listGames(), ...(get().game?.id === id ? { game: null, plays: [], view: 'games' as View } : {}) });
    },
    openGame: async (id) => {
      const game = await db.getGame(id);
      if (!game) return;
      set({ game, plays: await db.listPlays(id), view: 'live', pipelineStatus: null });
    },
    closeGame: () => set({ game: null, plays: [], view: 'games', pipelineStatus: null }),

    setPlays: (plays) => set({ plays }),
    editPlay: async (id, patch) => {
      const p = find(id);
      if (p) await replacePlay(confirmPlay(p, patch));
    },
    acceptPlay: async (id) => {
      const p = find(id);
      if (p) await replacePlay(confirmPlay(p));
    },
    deletePlay: async (id) => {
      const p = find(id);
      if (p) await replacePlay({ ...p, status: 'deleted' });
    },
    restorePlay: async (id) => {
      const p = find(id);
      if (p) await replacePlay(confirmPlay(p));
    },

    setSettings: (settings) => {
      db.saveSettings(settings);
      set({ settings });
    },
    setPipelineStatus: (pipelineStatus) => set({ pipelineStatus }),
  };
});
