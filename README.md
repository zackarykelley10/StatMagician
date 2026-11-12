# Football Stat Maker

Watches a football game and charts it for you. Point it at a live stream, Hudl film or a video file; an AI model watches the video and listens to the announcers, and the app turns that into play-by-play, team stats and player stats.

It is a static web app: no server. Game data stays in your browser (IndexedDB). Your AI key is stored only in your browser and sent only to the AI provider.

## Using it

1. **Settings**: choose the provider and paste your API key (Google Gemini), or choose **Demo** to try the app with scripted plays and no key.
2. **Games → New game**: enter both teams, their scorebug abbreviations, jersey colours and rosters (`12, John Smith, QB`, one per line). Rosters matter: they let the app match announcer names to numbers and catch misread jerseys.
3. **Live**: open the stream or Hudl in another browser tab, click **Capture a tab**, pick that tab and tick **Also share tab audio**, then **Start**. Or choose **Use a video file**.
4. Plays appear as each clip is analysed. Confident plays are accepted automatically; doubtful ones go to **Review** with the reason and the clip so you can fix or accept them (`A` accept, `D` delete, `N`/`P` next/previous).
5. **Stats**: team comparison and player tables, with CSV export (team, player, play-by-play).

Requirements and limits:
- Desktop Chrome or Edge (tab-audio capture).
- Stats trail the action by about one clip length plus the AI's response time.
- Best on broadcasts with a scorebug and announcers; silent sideline film gives the AI much less to go on.
- Keep the app's tab open while capturing. Only capture footage you have the right to use.

## How it works

```
tab / file ─▶ Segmenter ─▶ AI provider ─▶ Reconciler ─▶ plays (IndexedDB) ─▶ stats
 src/capture   30s clips,     src/ai        src/reconcile                     src/stats
               10s overlap                  + src/engine
```

- `src/core` – shared types, the AI output schema and a defensive parser for model output.
- `src/capture` – tab/file capture and the overlapping-clip recorder.
- `src/ai` – provider interface, Gemini implementation, demo provider, the prompt (`prompt.ts`).
- `src/engine` – football rules: applies a play to the game state (down, distance, spot, possession, score).
- `src/reconcile` – merges plays seen in overlapping clips, checks each play against the roster and the game state, scores confidence and routes low-confidence plays to review. `pipeline.ts` runs clips through in order.
- `src/stats` – pure function from plays to team and player stats.
- `src/ui`, `src/store`, `src/db` – React screens, Zustand store, Dexie storage.

To add another AI provider, implement `AIProvider` from `src/core/types.ts` and register it in `src/ai/index.ts`.

## Development

```bash
npm install
npm run dev
npm test
npm run build
```

## Deploying to GitHub Pages

Push to `main`. The workflow in `.github/workflows/deploy.yml` tests, builds and publishes. One-time setup in the repository: **Settings → Pages → Source: GitHub Actions**.
