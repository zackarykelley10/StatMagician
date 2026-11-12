import { useApp, type View } from '@/store';
import { GamesView } from '@/ui/GamesView';
import { LiveView } from '@/ui/LiveView';
import { ReviewView } from '@/ui/ReviewView';
import { SettingsView } from '@/ui/SettingsView';
import { StatsView } from '@/ui/StatsView';

const GAME_TABS: Array<{ id: View; label: string }> = [
  { id: 'live', label: 'Live' },
  { id: 'review', label: 'Review' },
  { id: 'stats', label: 'Stats' },
];

export default function App() {
  const view = useApp((s) => s.view);
  const game = useApp((s) => s.game);
  const setView = useApp((s) => s.setView);
  const closeGame = useApp((s) => s.closeGame);
  const reviewCount = useApp((s) => s.plays.filter((p) => p.status === 'needs_review').length);
  const capturing = useApp((s) => !!s.pipelineStatus && (s.pipelineStatus.processing || s.pipelineStatus.queued > 0));

  const tab = (id: View, label: string, badge?: number) => (
    <button
      key={id}
      onClick={() => setView(id)}
      className={`rounded-md px-3 py-1.5 text-sm font-medium ${
        view === id ? 'bg-emerald-600 text-white' : 'text-slate-300 hover:bg-slate-700'
      }`}
    >
      {label}
      {badge ? (
        <span className="ml-1.5 rounded-full bg-amber-400 px-1.5 text-xs font-semibold text-slate-900">{badge}</span>
      ) : null}
    </button>
  );

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="bg-slate-800 text-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3">
          <h1 className="text-lg font-semibold">Football Stat Maker</h1>
          {game && <span className="truncate text-sm text-slate-300">{game.title}</span>}
          <nav className="ml-auto flex flex-wrap items-center gap-1">
            {game ? (
              <>
                {GAME_TABS.map((t) => tab(t.id, t.label, t.id === 'review' ? reviewCount : undefined))}
                <button
                  onClick={() => {
                    if (!capturing || window.confirm('Clips are still being analysed. Leave this game anyway?')) closeGame();
                  }}
                  className="rounded-md px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-700"
                >
                  All games
                </button>
              </>
            ) : (
              tab('games', 'Games')
            )}
            {tab('settings', 'Settings')}
          </nav>
        </div>
      </header>
      <main className="px-4 py-6">
        {view === 'settings' && <SettingsView />}
        {view === 'games' && <GamesView />}
        {/* LiveView stays mounted while a game is open so capture keeps running on other tabs. */}
        {game && (
          <div className={view === 'live' ? '' : 'hidden'}>
            <LiveView />
          </div>
        )}
        {game && view === 'review' && <ReviewView />}
        {game && view === 'stats' && <StatsView />}
      </main>
    </div>
  );
}
