'use client';

/**
 * ASL Translator
 *  - Letters mode: fingerspelled ASL letters, typed out one by one (geometry rules).
 *  - Signs mode:   250 everyday ASL signs, recognised by a trained model.
 * Both write into the subtitle bar under the video.
 *
 * Sign model: "ASL Realtime Transformer" by Ceyda Akin (CC BY 4.0),
 * preprocessing ported from github.com/ceydaakin/asl-realtime (MIT).
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FilesetResolver, HolisticLandmarker } from '@mediapipe/tasks-vision';

import { loadClassifier, type Classify, type Guess } from '../lib/asl/classifier';
import { ALPHABET, type AlphabetLetter } from '../lib/asl/alphabet';
import { classifyLetter, LetterTyper, type P3 } from '../lib/asl/letters';
import { SignSegmenter, hasHand, holisticFrame, isArmUp, toWindow } from '../lib/asl/preprocess';

// Pinned versions: the WASM files must match the npm package version exactly.
const MEDIAPIPE_VERSION = '0.10.35';
const MEDIAPIPE_WASM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`;
const HOLISTIC_MODEL =
  'https://storage.googleapis.com/mediapipe-models/holistic_landmarker/holistic_landmarker/float16/latest/holistic_landmarker.task';

const MIN_CONFIDENCE = 0.4; // only add a word to the subtitles if the AI is at least 40% sure
const SUBTITLE_CHARS = 90; // how much of the subtitle text to show
const MIN_HAND_FRAMES = 10; // fewer than this (~1/3 s) usually means the sign was rushed

type Mode = 'letters' | 'signs';

export default function SignTranslator() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const landmarkerRef = useRef<HolisticLandmarker | null>(null);
  const classifyRef = useRef<Classify | null>(null);
  const segmenterRef = useRef(new SignSegmenter());
  const typerRef = useRef(new LetterTyper());
  const modeRef = useRef<Mode>('letters');
  const busyRef = useRef(false); // true while the sign model is thinking
  const lastShownRef = useRef('');

  const [status, setStatus] = useState('Loading AI models…');
  const [signsReady, setSignsReady] = useState<boolean | null>(null); // null = still loading
  const [mode, setMode] = useState<Mode>('letters');
  const [live, setLive] = useState('Waiting for hand…'); // what the app sees right now
  const [guesses, setGuesses] = useState<Guess[]>([]);
  const [signing, setSigning] = useState(false);
  const [subtitle, setSubtitle] = useState('');
  const [tip, setTip] = useState('');

  const addText = useCallback((text: string) => setSubtitle((s) => s + text), [setSubtitle]);

  /** Only re-render when the live text actually changes (this runs ~30 times a second). */
  const showLive = useCallback((text: string) => {
    if (lastShownRef.current !== text) {
      lastShownRef.current = text;
      setLive(text);
    }
  }, []);

  const switchMode = (next: Mode) => {
    modeRef.current = next;
    segmenterRef.current.reset();
    typerRef.current = new LetterTyper();
    setGuesses([]);
    setTip('');
    setSigning(false);
    setMode(next);
  };

  useEffect(() => {
    let cancelled = false;
    let raf = 0;
    let lastVideoTime = -1;
    let clock = 0; // MediaPipe needs timestamps that always increase
    let stream: MediaStream | null = null;

    // ---- 1. Load the dot finder (MediaPipe Holistic: face + body + both hands) ----
    async function loadLandmarker() {
      const vision = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM);
      const landmarker = await HolisticLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: HOLISTIC_MODEL, delegate: 'GPU' },
        runningMode: 'VIDEO',
      });
      if (cancelled) landmarker.close();
      else landmarkerRef.current = landmarker;
    }

    // ---- 2. Load the sign model (optional: letters still work without it) ----
    async function loadSigns() {
      try {
        const classify = await loadClassifier();
        if (cancelled) return;
        classifyRef.current = classify;
        setSignsReady(true);
      } catch (error) {
        console.error('Sign model failed to load:', error);
        if (!cancelled) setSignsReady(false);
      }
    }

    // ---- 3. Camera ----
    async function startCamera() {
      const video = videoRef.current;
      if (!video) return;
      stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 1280, height: 720, facingMode: 'user' },
      });
      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      video.srcObject = stream;
      await video.play();
      setStatus('Camera on');
      raf = requestAnimationFrame(loop);
    }

    // ---- 4. Runs every frame ----
    function loop() {
      if (cancelled) return;
      raf = requestAnimationFrame(loop); // schedule first, so an error below never stops the loop

      const video = videoRef.current;
      const canvas = canvasRef.current;
      const landmarker = landmarkerRef.current;
      if (!video || !canvas || !landmarker || video.readyState < 2) return;
      if (video.currentTime === lastVideoTime) return; // same camera frame as last time
      lastVideoTime = video.currentTime;

      clock = Math.max(clock + 1, performance.now());
      const result = landmarker.detectForVideo(video, clock);

      const hands: P3[][] = [result.leftHandLandmarks?.[0], result.rightHandLandmarks?.[0]].filter(
        (h) => !!h && h.length === 21
      ) as P3[][];
      draw(canvas, video, hands, result.poseLandmarks?.[0]);

      if (modeRef.current === 'letters') {
        // Use the hand that is higher on screen (smaller y) as the spelling hand.
        const hand = [...hands].sort((a, b) => a[0].y - b[0].y)[0];
        const letter = hand ? classifyLetter(hand) : null;
        showLive(!hand ? 'No hand detected' : letter ? `Letter: ${letter}` : 'Spelling…');
        const typed = typerRef.current.push(letter, !!hand);
        if (typed) addText(typed);
      } else {
        const segmenter = segmenterRef.current;
        // isArmUp keeps the sign open if the hand is briefly lost in front of the face.
        const frames = segmenter.push(holisticFrame(result), isArmUp(result.poseLandmarks?.[0]));
        setSigning(segmenter.active);
        if (frames) recognise(frames);
        else if (!segmenter.active && !busyRef.current) showLive('Raise your hand and sign');
        else if (segmenter.active) showLive('Watching…');
      }
    }

    async function recognise(frames: Float32Array[]) {
      const classify = classifyRef.current;
      if (!classify || busyRef.current) return;
      busyRef.current = true;
      try {
        const input = toWindow(frames);
        if (!input.length) return;
        const top = await classify(input);
        setGuesses(top);
        const handFrames = frames.filter(hasHand).length;
        setTip(handFrames < MIN_HAND_FRAMES ? 'That was very quick. Try signing a little slower.' : '');
        const best = top[0];
        if (best && best.probability >= MIN_CONFIDENCE) {
          showLive(`Sign: ${best.sign}`);
          addText(best.sign.toUpperCase() + ' ');
        } else {
          showLive('Not sure. Try that sign again');
        }
      } catch (error) {
        console.error('Sign recognition failed:', error);
      } finally {
        busyRef.current = false;
      }
    }

    (async () => {
      try {
        await Promise.all([loadLandmarker(), loadSigns()]);
        if (cancelled) return;
        setStatus('Models loaded. Starting camera…');
        await startCamera();
      } catch (error) {
        console.error(error);
        if (cancelled) return;
        const name = (error as Error)?.name;
        setStatus(
          name === 'NotAllowedError'
            ? 'Camera permission denied. Allow the camera and reload.'
            : 'Failed to start. Check your internet connection and the browser console.'
        );
      }
    })();

    // ---- 5. Clean up when the page is closed ----
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
      landmarkerRef.current?.close();
      landmarkerRef.current = null;
    };
  }, [addText, showLive]);

  const shown = subtitle.length > SUBTITLE_CHARS ? '…' + subtitle.slice(-SUBTITLE_CHARS) : subtitle;
  const currentLetter = live.startsWith('Letter: ') ? live.slice('Letter: '.length) : null;

  const modeButton = (value: Mode, label: string, disabled = false) => (
    <button
      onClick={() => switchMode(value)}
      disabled={disabled}
      aria-pressed={mode === value}
      className={`px-5 py-2 rounded-full font-semibold transition-colors disabled:opacity-40 ${
        mode === value ? 'bg-tomato text-cream' : 'text-leaf hover:bg-leaf/10'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex flex-col items-center min-h-screen bg-cream text-leaf px-4 py-8 sm:p-10">
      {/* Poster-style title */}
      <header className="text-center mb-6">
        <h1 className="stamp font-display uppercase text-leaf leading-[0.85] text-6xl sm:text-7xl tracking-tight">
          ASL <span className="text-tomato">Trans</span>lator
        </h1>
        <p className="mt-3 text-leaf-soft">Sign to subtitles, right in your browser</p>
        <p className="mt-1 text-sm text-leaf-soft">Status: {status}</p>
      </header>

      {/* Mode switch */}
      <div className="flex gap-1 p-1 mb-4 rounded-full border-2 border-leaf bg-paper">
        {modeButton('letters', 'Letters')}
        {modeButton('signs', 'Signs (250 words)', !signsReady)}
      </div>
      {signsReady === false && (
        <p className="text-tomato-dark text-sm mb-3 max-w-xl text-center">
          Sign model not found. Put <code>asl_int8.tflite</code> in <code>public/models/asl_transformer/</code> and reload.
          Letters mode still works.
        </p>
      )}

      {/* Video + dots + subtitles. aspect-video (16:9) matches the camera, so the dots line up. */}
      <div className="relative w-full max-w-3xl aspect-video border-4 border-leaf rounded-2xl overflow-hidden bg-leaf shadow-[10px_10px_0_var(--tomato)]">
        <video ref={videoRef} autoPlay playsInline muted className="absolute inset-0 w-full h-full object-cover -scale-x-100" />
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none -scale-x-100" />

        {signing && (
          <span className="absolute top-3 left-3 flex items-center gap-2 bg-tomato text-cream px-3 py-1 rounded-full text-sm font-semibold">
            <span className="w-2 h-2 rounded-full bg-cream animate-pulse" /> Watching sign
          </span>
        )}

        <div className="absolute bottom-4 inset-x-4 text-center">
          <span className="inline-block bg-cream/95 text-leaf px-5 py-2 rounded-lg font-display uppercase tracking-wide text-2xl sm:text-3xl min-h-[2.75rem] whitespace-pre-wrap">
            {shown || <span className="font-sans normal-case tracking-normal text-lg text-leaf-soft">Subtitles appear here</span>}
          </span>
        </div>
      </div>

      {/* What the app sees right now */}
      <div className="mt-8 px-8 py-4 bg-paper rounded-xl border-2 border-leaf text-center min-w-[18rem] max-w-3xl">
        <h2 className="font-display uppercase tracking-wide text-3xl text-leaf">{live}</h2>
        {tip && <p className="mt-1 text-sm text-tomato-dark">{tip}</p>}

        {mode === 'signs' && guesses.length > 0 && (
          <p className="mt-1 text-sm text-leaf-soft">
            Top guesses: {guesses.map((g) => `${g.sign} ${Math.round(g.probability * 100)}%`).join(' · ')}
          </p>
        )}
      </div>

      <div className="flex gap-2 mt-4">
        <button
          onClick={() => setSubtitle(deleteLastWord)}
          className="px-4 py-2 rounded-lg border-2 border-leaf font-semibold hover:bg-leaf hover:text-cream transition-colors"
        >
          Delete last word
        </button>
        <button
          onClick={() => setSubtitle('')}
          className="px-4 py-2 rounded-lg border-2 border-leaf font-semibold hover:bg-leaf hover:text-cream transition-colors"
        >
          Clear
        </button>
      </div>

      <p className="text-sm text-leaf-soft mt-5 max-w-xl text-center">
        {mode === 'letters'
          ? 'Hold each letter still for about half a second. Lower your hand for a second to add a space.'
          : 'Raise your hand, do one sign, then lower your hand. The sign is recognised when your hand leaves the picture.'}
      </p>
      {mode === 'letters' && <LetterGuide current={currentLetter} />}

      <p className="text-xs text-leaf-soft mt-8 text-center">
        Sign model: ASL Realtime Transformer by Ceyda Akin (CC BY 4.0). Letter drawings: Wikimedia Commons (public
        domain). A learning demo, not an interpreter.
      </p>
    </div>
  );
}

// ---------- letter guide (Letters mode) ----------

function LetterGuide({ current }: { current: string | null }) {
  const supported = ALPHABET.filter((l) => l.supported);
  const others = ALPHABET.filter((l) => !l.supported);
  return (
    <section className="w-full max-w-3xl mt-10" aria-labelledby="letter-guide-title">
      <h2 id="letter-guide-title" className="stamp font-display uppercase text-4xl text-leaf text-center">
        Letter guide
      </h2>
      <p className="text-sm text-leaf-soft text-center mt-1 mb-4">
        The {supported.length} letters the app can read. The one it sees right now lights up.
      </p>
      <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
        {supported.map((l) => (
          <LetterCard key={l.letter} item={l} active={l.letter === current} />
        ))}
      </div>

      <details className="mt-6">
        <summary className="cursor-pointer text-center font-semibold text-leaf">
          Other letters (the app can&apos;t read these yet)
        </summary>
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 mt-4 opacity-70">
          {others.map((l) => (
            <LetterCard key={l.letter} item={l} active={false} />
          ))}
        </div>
      </details>
    </section>
  );
}

function LetterCard({ item, active }: { item: AlphabetLetter; active: boolean }) {
  return (
    <figure
      className={`rounded-xl border-2 p-3 text-center transition-colors ${
        active ? 'border-tomato bg-tomato/10 ring-2 ring-tomato' : 'border-leaf bg-paper'
      }`}
    >
      {/* Plain <img>: the drawings come straight from Wikimedia, no resizing needed. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={item.image} alt={`ASL letter ${item.letter}`} loading="lazy" className="h-20 w-full object-contain" />
      <figcaption>
        <span className={`block font-display text-3xl ${active ? 'text-tomato-dark' : 'text-leaf'}`}>{item.letter}</span>
        <span className="block text-xs leading-snug text-leaf-soft mt-1">{item.how}</span>
      </figcaption>
    </figure>
  );
}

function deleteLastWord(text: string) {
  const trimmed = text.trimEnd();
  const lastSpace = trimmed.lastIndexOf(' ');
  return lastSpace < 0 ? '' : trimmed.slice(0, lastSpace + 1);
}

// ---------- drawing ----------

const HAND_LINKS = HolisticLandmarker.HAND_CONNECTIONS;
const ARM_POINTS = [11, 12, 13, 14, 15, 16]; // shoulders, elbows, wrists

function draw(
  canvas: HTMLCanvasElement,
  video: HTMLVideoElement,
  hands: P3[][],
  pose: P3[] | undefined
) {
  // The canvas's own resolution must equal the camera's, or the dots end up in the wrong place.
  if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const { width: w, height: h } = canvas;
  ctx.clearRect(0, 0, w, h);

  if (pose) {
    ctx.fillStyle = '#2f4a2b'; // leaf green
    ctx.strokeStyle = '#f4efdb'; // cream outline so it shows on dark clothes
    ctx.lineWidth = 2;
    for (const i of ARM_POINTS) {
      const p = pose[i];
      if (!p) continue;
      ctx.beginPath();
      ctx.arc(p.x * w, p.y * h, 7, 0, 2 * Math.PI);
      ctx.fill();
      ctx.stroke();
    }
  }

  for (const hand of hands) {
    ctx.strokeStyle = 'rgba(244,239,219,0.85)'; // cream lines
    ctx.lineWidth = 3;
    for (const { start, end } of HAND_LINKS) {
      ctx.beginPath();
      ctx.moveTo(hand[start].x * w, hand[start].y * h);
      ctx.lineTo(hand[end].x * w, hand[end].y * h);
      ctx.stroke();
    }
    ctx.fillStyle = '#c9372b'; // tomato dots
    for (const p of hand) {
      ctx.beginPath();
      ctx.arc(p.x * w, p.y * h, 5, 0, 2 * Math.PI);
      ctx.fill();
    }
  }
}
