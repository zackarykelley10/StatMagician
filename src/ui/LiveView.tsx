import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Game, PlayEvent } from '@/core/types';
import { getProvider } from '@/ai';
import { Segmenter, hasAudio, startTabCapture, streamFromVideoElement } from '@/capture';
import * as db from '@/db';
import { currentState } from '@/reconcile';
import { Pipeline } from '@/reconcile/pipeline';
import type { PipelineStatus } from '@/reconcile/pipeline';
import { useApp } from '@/store';
import { PlayEditor } from './PlayEditor';
import { PlayRow } from './PlayRow';
import { fmtClock, fmtSituation } from './format';

type Source = 'tab' | 'file' | null;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------- Sub-components ----------

function StatusBar({ status, running }: { status: PipelineStatus | null; running: boolean }) {
  if (!status && !running) return null;
  return (
    <div className="space-y-1.5 rounded-lg border border-slate-200 bg-white p-3 text-sm">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-slate-700">
        <span className="flex items-center gap-1.5">
          <span className={`inline-block h-2 w-2 rounded-full ${running ? 'animate-pulse bg-red-500' : 'bg-slate-300'}`} />
          {running ? 'Recording' : 'Stopped'}
        </span>
        <span>Waiting: <b>{status?.queued ?? 0}</b></span>
        <span>Processed: <b>{status?.processed ?? 0}</b></span>
        {status?.processing && <span className="animate-pulse text-emerald-700">analysing…</span>}
      </div>
      {status?.halted && (
        <p className="rounded bg-red-50 px-2 py-1 text-red-700">
          Analysis has stopped and will not resume until you start again. Check your API key in settings.
        </p>
      )}
      {status?.lastError && <p className="text-red-600">{status.lastError}</p>}
      {status?.warnings.map((w, i) => (
        <p key={i} className="text-amber-700">{w}</p>
      ))}
    </div>
  );
}

function Scoreboard({ game, plays }: { game: Game; plays: PlayEvent[] }) {
  const st = useMemo(() => currentState(plays), [plays]);
  const sit = fmtSituation({ down: st.down, distance: st.distance, ballOn: st.ballOn, possession: st.possession }, game);
  const team = (side: 'home' | 'away') => (
    <div className={`flex-1 rounded-lg px-3 py-2 text-center ${st.possession === side ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-100'}`}>
      <div className="text-xs font-semibold tracking-wide opacity-80">
        {st.possession === side ? '● ' : ''}{game[side].abbr}
      </div>
      <div className="text-3xl font-bold tabular-nums">{st.score[side]}</div>
    </div>
  );
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex items-stretch gap-2">
        {team('away')}
        <div className="flex w-24 flex-col items-center justify-center text-slate-700">
          <div className="text-xs font-medium uppercase text-slate-500">{st.quarter > 4 ? 'OT' : `Q${st.quarter}`}</div>
          <div className="font-mono text-lg font-semibold">{fmtClock(st.clock)}</div>
        </div>
        {team('home')}
      </div>
      <div className="mt-2 text-center text-sm text-slate-600">{sit || 'Waiting for the first play…'}</div>
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4" onClick={onClose}>
      <div className="mt-8 w-full max-w-3xl rounded-lg bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-3 text-base font-semibold text-slate-800">{title}</h3>
        {children}
      </div>
    </div>
  );
}

// ---------- Main view ----------

export function LiveView() {
  const game = useApp((s) => s.game);
  const plays = useApp((s) => s.plays);
  const settings = useApp((s) => s.settings);
  const status = useApp((s) => s.pipelineStatus);
  const setView = useApp((s) => s.setView);
  const editPlay = useApp((s) => s.editPlay);
  const acceptPlay = useApp((s) => s.acceptPlay);
  const deletePlay = useApp((s) => s.deletePlay);
  const restorePlay = useApp((s) => s.restorePlay);

  const [source, setSource] = useState<Source>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noAudio, setNoAudio] = useState(false);
  const [tabStream, setTabStream] = useState<MediaStream | null>(null);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const ownsTracksRef = useRef(false);
  const segmenterRef = useRef<Segmenter | null>(null);
  const pipelineRef = useRef<Pipeline | null>(null);
  const finishingRef = useRef(new Set<Pipeline>());
  const fileUrlRef = useRef<string | null>(null);
  const previewRef = useRef<HTMLVideoElement | null>(null);
  const fileVideoRef = useRef<HTMLVideoElement | null>(null);
  const unmountedRef = useRef(false);

  const newestFirst = useMemo(() => plays.slice().reverse(), [plays]);
  const keyMissing = settings.provider === 'gemini' && settings.apiKey.trim() === '';

  // Show the captured tab in the muted preview.
  useEffect(() => {
    const v = previewRef.current;
    if (v) v.srcObject = tabStream;
  }, [tabStream, source]);

  const releaseStream = useCallback(() => {
    if (ownsTracksRef.current) streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    ownsTracksRef.current = false;
  }, []);

  const stop = useCallback(() => {
    segmenterRef.current?.stop();
    segmenterRef.current = null;
    const wasTab = ownsTracksRef.current;
    releaseStream();
    if (wasTab) setTabStream(null);
    setRunning(false);

    // Let the final clip (emitted asynchronously by the recorder) reach the pipeline and drain.
    const pipe = pipelineRef.current;
    pipelineRef.current = null;
    if (pipe) {
      finishingRef.current.add(pipe);
      void (async () => {
        await sleep(800);
        await pipe.idle();
        if (finishingRef.current.delete(pipe)) pipe.dispose();
      })();
    }
  }, [releaseStream]);

  // Clean up on unmount. (StrictMode's simulated unmount runs this with everything still null.)
  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
      segmenterRef.current?.stop();
      segmenterRef.current = null;
      releaseStream();
      pipelineRef.current?.dispose();
      pipelineRef.current = null;
      finishingRef.current.forEach((p) => p.dispose());
      // eslint-disable-next-line react-hooks/exhaustive-deps -- a mutable Set, read at unmount on purpose
      finishingRef.current.clear();
      if (fileUrlRef.current) URL.revokeObjectURL(fileUrlRef.current);
      fileUrlRef.current = null;
    };
  }, [releaseStream]);

  const captureTab = async () => {
    setError(null);
    try {
      releaseStream();
      const stream = await startTabCapture();
      streamRef.current = stream;
      ownsTracksRef.current = true;
      setNoAudio(!hasAudio(stream));
      setSource('tab');
      setTabStream(stream);
      // If the user ends sharing from the browser bar before starting.
      stream.getVideoTracks()[0]?.addEventListener('ended', () => {
        if (streamRef.current === stream && !segmenterRef.current) {
          releaseStream();
          setTabStream(null);
          setSource(null);
        }
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const pickFile = (file: File | undefined) => {
    if (!file) return;
    if (running) stop();
    if (fileUrlRef.current) URL.revokeObjectURL(fileUrlRef.current);
    const url = URL.createObjectURL(file);
    fileUrlRef.current = url;
    releaseStream();
    setTabStream(null);
    setNoAudio(false);
    setError(null);
    setFileUrl(url);
    setSource('file');
  };

  const start = async () => {
    if (!game || running) return;
    setError(null);
    try {
      let stream = streamRef.current;
      if (source === 'file') {
        const v = fileVideoRef.current;
        if (!v) throw new Error('Choose a video file first.');
        stream = streamFromVideoElement(v);
        streamRef.current = stream;
        ownsTracksRef.current = false;
        setNoAudio(!hasAudio(stream));
      }
      if (!stream) throw new Error('Choose a source first: capture a tab or use a video file.');

      const { settings: cfg, setPlays, setPipelineStatus } = useApp.getState();
      const pipeline = new Pipeline({
        game,
        settings: cfg,
        provider: getProvider(cfg.provider),
        store: {
          listPlays: db.listPlays,
          putPlays: db.putPlays,
          saveSegment: db.saveSegment,
          pruneSegments: db.pruneSegments,
        },
        onPlays: (p) => { if (!unmountedRef.current) setPlays(p); },
        onStatus: (s) => { if (!unmountedRef.current) setPipelineStatus(s); },
      });
      const segmenter = new Segmenter(stream, {
        gameId: game.id,
        segmentSec: cfg.segmentSec,
        overlapSec: cfg.overlapSec,
        onSegment: (s) => pipeline.enqueue(s),
        onEnded: () => { if (segmenterRef.current === segmenter) stop(); },
      });
      pipelineRef.current = pipeline;
      segmenterRef.current = segmenter;
      segmenter.start();
      setRunning(true);
      if (source === 'file') void fileVideoRef.current?.play().catch(() => undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (!game) return <p className="p-6 text-slate-500">Open a game to start watching.</p>;

  const reviewCount = plays.filter((p) => p.status === 'needs_review').length;
  const editing = editingId ? plays.find((p) => p.id === editingId) ?? null : null;
  const canStart = !running && !keyMissing && (source === 'file' ? !!fileUrl : !!tabStream);

  const btn = 'rounded px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40';

  return (
    <div className="mx-auto grid max-w-7xl gap-4 p-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      {/* Left: video + controls */}
      <div className="space-y-3">
        <div className="aspect-video overflow-hidden rounded-lg bg-slate-900">
          {source === 'file' && fileUrl ? (
            <video ref={fileVideoRef} src={fileUrl} controls className="h-full w-full" />
          ) : source === 'tab' ? (
            <video ref={previewRef} autoPlay muted playsInline className="h-full w-full object-contain" />
          ) : (
            <div className="flex h-full items-center justify-center p-6 text-center text-sm text-slate-400">
              Capture the browser tab showing the game, or load a video file.
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <button type="button" className={`${btn} border border-slate-300 bg-white text-slate-700 hover:bg-slate-50`} onClick={captureTab}>
            Capture a tab
          </button>
          <label className={`${btn} cursor-pointer border border-slate-300 bg-white text-slate-700 hover:bg-slate-50`}>
            Use a video file
            <input
              type="file"
              accept="video/*"
              className="hidden"
              onChange={(e) => {
                pickFile(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </label>
          <span className="flex-1" />
          <button type="button" className={`${btn} bg-emerald-600 text-white hover:bg-emerald-700`} disabled={!canStart} onClick={start}>
            Start
          </button>
          <button type="button" className={`${btn} bg-slate-700 text-white hover:bg-slate-800`} disabled={!running} onClick={stop}>
            Stop
          </button>
        </div>

        {keyMissing && (
          <p className="rounded bg-amber-50 px-3 py-2 text-sm text-amber-800">
            A Gemini API key is required.{' '}
            <button type="button" className="font-medium underline" onClick={() => setView('settings')}>
              Open settings
            </button>
          </p>
        )}
        {source === 'tab' && noAudio && (
          <p className="rounded bg-amber-50 px-3 py-2 text-sm text-amber-800">
            No audio was shared. Announcer audio improves accuracy: stop and capture again, and tick
            &ldquo;Also share tab audio&rdquo; in the browser's share dialog.
          </p>
        )}
        {source === 'file' && (
          <p className="text-xs text-slate-500">
            Press Start, then play the video. Clips are cut from what is played.
          </p>
        )}
        {error && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        <StatusBar status={status} running={running} />
      </div>

      {/* Right: scoreboard + log */}
      <div className="space-y-3">
        <Scoreboard game={game} plays={plays} />

        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-700">Plays ({plays.filter((p) => p.status !== 'deleted').length})</h2>
          {reviewCount > 0 && (
            <button
              type="button"
              onClick={() => setView('review')}
              className="rounded bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800 hover:bg-amber-200"
            >
              {reviewCount} need{reviewCount === 1 ? 's' : ''} review &rarr;
            </button>
          )}
        </div>

        <div className="max-h-[60vh] overflow-y-auto rounded-lg border border-slate-200 bg-white">
          {newestFirst.length === 0 ? (
            <p className="p-6 text-center text-sm text-slate-400">No plays yet.</p>
          ) : (
            newestFirst.map((p) => <PlayRow key={p.id} play={p} game={game} onEdit={() => setEditingId(p.id)} />)
          )}
        </div>
      </div>

      {editing && (
        <Modal title={`Edit play ${editing.seq}`} onClose={() => setEditingId(null)}>
          <PlayEditor
            key={editing.id}
            play={editing}
            game={game}
            onSave={(patch) => {
              void editPlay(editing.id, patch);
              setEditingId(null);
            }}
            onAccept={() => {
              void (editing.status === 'deleted' ? restorePlay(editing.id) : acceptPlay(editing.id));
              setEditingId(null);
            }}
            acceptLabel={editing.status === 'deleted' ? 'Restore play' : undefined}
            onDelete={
              editing.status === 'deleted'
                ? undefined
                : () => {
                    void deletePlay(editing.id);
                    setEditingId(null);
                  }
            }
            onCancel={() => setEditingId(null)}
          />
        </Modal>
      )}
    </div>
  );
}
