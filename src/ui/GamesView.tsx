import { useEffect, useState, type FormEvent } from 'react';
import type { Game, Team } from '@/core/types';
import { useApp } from '@/store';
import { formatRoster, parseRoster } from '@/ui/roster';

interface TeamDraft {
  name: string;
  abbr: string;
  jersey: string;
  roster: string;
}

const EMPTY_TEAM: TeamDraft = { name: '', abbr: '', jersey: '', roster: '' };

const inputClass =
  'mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/30';
const buttonClass =
  'rounded-md px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50';

function teamToDraft(team: Team): TeamDraft {
  return {
    name: team.name,
    abbr: team.abbr,
    jersey: team.jersey ?? '',
    roster: formatRoster(team.roster),
  };
}

function draftToTeam(draft: TeamDraft): Team {
  return {
    name: draft.name.trim(),
    abbr: draft.abbr.trim(),
    jersey: draft.jersey.trim() || undefined,
    roster: parseRoster(draft.roster),
  };
}

interface TeamFieldsProps {
  id: string;
  heading: string;
  draft: TeamDraft;
  onChange: (next: TeamDraft) => void;
}

function TeamFields({ id, heading, draft, onChange }: TeamFieldsProps) {
  const playerCount = parseRoster(draft.roster).length;
  const set = (patch: Partial<TeamDraft>) => onChange({ ...draft, ...patch });

  return (
    <fieldset className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      <legend className="px-1 text-sm font-semibold text-slate-700">{heading}</legend>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={`${id}-name`} className="block text-sm font-medium text-slate-700">
            Team name
          </label>
          <input
            id={`${id}-name`}
            type="text"
            required
            value={draft.name}
            onChange={(e) => set({ name: e.target.value })}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor={`${id}-abbr`} className="block text-sm font-medium text-slate-700">
            Abbreviation (as on the scorebug)
          </label>
          <input
            id={`${id}-abbr`}
            type="text"
            required
            value={draft.abbr}
            onChange={(e) => set({ abbr: e.target.value })}
            className={inputClass}
          />
        </div>
      </div>

      <div>
        <label htmlFor={`${id}-jersey`} className="block text-sm font-medium text-slate-700">
          Jersey colour
        </label>
        <input
          id={`${id}-jersey`}
          type="text"
          placeholder="e.g. white with red numbers"
          value={draft.jersey}
          onChange={(e) => set({ jersey: e.target.value })}
          className={inputClass}
        />
      </div>

      <div>
        <label htmlFor={`${id}-roster`} className="block text-sm font-medium text-slate-700">
          Roster
        </label>
        <textarea
          id={`${id}-roster`}
          rows={6}
          placeholder={'12 John Smith\n13, Mike Jones, QB'}
          value={draft.roster}
          onChange={(e) => set({ roster: e.target.value })}
          className={`${inputClass} font-mono`}
        />
        <p className="mt-1 text-xs text-slate-500" aria-live="polite">
          {playerCount} players parsed
        </p>
      </div>
    </fieldset>
  );
}

export function GamesView() {
  const games = useApp((s) => s.games);

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Game | null>(null);
  const [title, setTitle] = useState('');
  const [home, setHome] = useState<TeamDraft>(EMPTY_TEAM);
  const [away, setAway] = useState<TeamDraft>(EMPTY_TEAM);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void useApp.getState().init();
  }, []);

  const resetForm = () => {
    setEditing(null);
    setTitle('');
    setHome(EMPTY_TEAM);
    setAway(EMPTY_TEAM);
    setError(null);
  };

  const startNew = () => {
    resetForm();
    setShowForm(true);
  };

  const startEdit = (game: Game) => {
    setEditing(game);
    setTitle(game.title);
    setHome(teamToDraft(game.home));
    setAway(teamToDraft(game.away));
    setError(null);
    setShowForm(true);
  };

  const cancelForm = () => {
    resetForm();
    setShowForm(false);
  };

  const handleSave = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const homeTeam = draftToTeam(home);
    const awayTeam = draftToTeam(away);
    if (!homeTeam.name || !homeTeam.abbr || !awayTeam.name || !awayTeam.abbr) {
      setError('Both team names and abbreviations are required.');
      return;
    }
    const gameTitle = title.trim() || `${homeTeam.name} vs ${awayTeam.name}`;

    try {
      const store = useApp.getState();
      if (editing) {
        await store.saveGame({ ...editing, title: gameTitle, home: homeTeam, away: awayTeam });
      } else {
        await store.createGame({ title: gameTitle, home: homeTeam, away: awayTeam });
      }
      cancelForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the game.');
    }
  };

  const handleDelete = async (game: Game) => {
    if (!window.confirm(`Delete "${game.title}"? This cannot be undone.`)) return;
    try {
      if (editing?.id === game.id) cancelForm();
      await useApp.getState().removeGame(game.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete the game.');
    }
  };

  const handleOpen = async (game: Game) => {
    try {
      await useApp.getState().openGame(game.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open the game.');
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 text-slate-900">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-slate-900">Games</h1>
        {!showForm && (
          <button
            type="button"
            onClick={startNew}
            className={`${buttonClass} bg-emerald-600 text-white hover:bg-emerald-700`}
          >
            New game
          </button>
        )}
      </header>

      {error && (
        <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      {showForm && (
        <form
          onSubmit={handleSave}
          className="space-y-4 rounded-xl border border-slate-200 bg-slate-50 p-5 shadow-sm"
          noValidate
        >
          <h2 className="text-lg font-semibold text-slate-800">{editing ? 'Edit game' : 'New game'}</h2>

          <div>
            <label htmlFor="game-title" className="block text-sm font-medium text-slate-700">
              Title
            </label>
            <input
              id="game-title"
              type="text"
              placeholder="Defaults to 'Home vs Away'"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className={inputClass}
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <TeamFields id="home" heading="Home team" draft={home} onChange={setHome} />
            <TeamFields id="away" heading="Away team" draft={away} onChange={setAway} />
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={cancelForm}
              className={`${buttonClass} border border-slate-300 bg-white text-slate-700 hover:bg-slate-100`}
            >
              Cancel
            </button>
            <button type="submit" className={`${buttonClass} bg-emerald-600 text-white hover:bg-emerald-700`}>
              {editing ? 'Save changes' : 'Create game'}
            </button>
          </div>
        </form>
      )}

      <section aria-labelledby="games-list-heading">
        <h2 id="games-list-heading" className="sr-only">
          Saved games
        </h2>
        {games.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
            No games yet. Create one to get started.
          </p>
        ) : (
          <ul className="divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            {games.map((game) => (
              <li key={game.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-slate-900">{game.title}</p>
                  <p className="text-sm text-slate-600">
                    {game.home.name} vs {game.away.name}
                  </p>
                  <p className="text-xs text-slate-500">{new Date(game.createdAt).toLocaleDateString()}</p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => void handleOpen(game)}
                    className={`${buttonClass} bg-slate-900 text-white hover:bg-slate-700`}
                  >
                    Open
                  </button>
                  <button
                    type="button"
                    onClick={() => startEdit(game)}
                    className={`${buttonClass} border border-slate-300 bg-white text-slate-700 hover:bg-slate-100`}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDelete(game)}
                    className={`${buttonClass} border border-red-200 bg-white text-red-600 hover:bg-red-50`}
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
