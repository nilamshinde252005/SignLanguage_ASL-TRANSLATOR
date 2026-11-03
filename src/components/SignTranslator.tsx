'use client';

/**
 * ASL Translator: webcam → MediaPipe hand and body points → subtitles.
 *  - Letters mode: all 26 fingerspelled letters, read by my own two trained models: one for still hand
 *                  shapes (24 letters; the old rules are a backup) and one for moves (J and Z).
 *  - Signs mode:   250 everyday signs, read by "ASL Realtime Transformer" by Ceyda Akin (CC BY 4.0),
 *                  preprocessing ported from github.com/ceydaakin/asl-realtime (MIT), plus a few
 *                  signs it doesn't know (like NAME) from my own trained model.
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { FilesetResolver, HolisticLandmarker, type HolisticLandmarkerResult } from '@mediapipe/tasks-vision';

import { loadClassifier, type Classify, type Guess } from '../lib/asl/classifier';
import { classifyLetter, LetterTyper, type P3 } from '../lib/asl/letters';
import { loadLetterModel, type LetterGuess, type ReadLetter } from '../lib/asl/letterModel';
import { SignSegmenter, hasHand, holisticFrame, isArmUp, toWindow } from '../lib/asl/preprocess';
import { Recorder } from '../lib/asl/recorder';
import { clipFrame, SignClipRecorder } from '../lib/asl/signClips';
import { loadMySignModel, MIN_MY_SIGN_CONFIDENCE, type ReadMySign } from '../lib/asl/signModel';
import { MotionSegmenter } from '../lib/asl/motion';
import {
  addMovingLetter,
  loadMoveModel,
  MIN_MOVE_CONFIDENCE,
  type ReadMove,
  type TypedLetter,
} from '../lib/asl/moveModel';
import HowItWorks from './HowItWorks';
import LetterGuide from './LetterGuide';
import SignGuide from './SignGuide';

// Pinned versions: the WASM files must match the npm package version exactly.
const MEDIAPIPE_VERSION = '0.10.35';
const MEDIAPIPE_WASM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`;
const HOLISTIC_MODEL =
  'https://storage.googleapis.com/mediapipe-models/holistic_landmarker/holistic_landmarker/float16/latest/holistic_landmarker.task';

const MIN_LETTER_CONFIDENCE = 0.7; // only use the letter model's answer if it is at least 70% sure
const MIN_SIGN_CONFIDENCE = 0.4; // only add a sign to the subtitles if the sign model is at least 40% sure
const MIN_HAND_FRAMES = 10; // fewer than this (~1/3 s) usually means the sign was rushed
const DRAWING_SIZE = 0.6; // a move this big (in palm sizes) is drawing, not holding a shape: don't type still letters
const MUTE_AFTER_MOVE = 15; // frames: don't type the hand shape that a J or Z ends on
const SHOW_MOVING_LETTER_MS = 1200; // keep a typed J or Z on screen this long
const CAPTION_CHARS = 60; // how much of the subtitles to show on top of the video
const GITHUB_URL = 'https://github.com/nilamshinde252005/SignLanguage_ASL-TRANSLATOR';
const DOT_COLOR = '#4b63ff'; // the accent blue, bright enough to show on any video

type Mode = 'letters' | 'signs';
type Step = 'loading' | 'ready' | 'failed';

/** Loading progress of everything the page needs. */
interface Loading {
  camera: Step;
  tracker: Step;
  letters: Step;
  signs: Step;
}

/** What the app is reading right now. `probability` is null when the old rules made the call. */
interface Reading {
  label: string | null;
  probability: number | null;
  message: string;
}

const HINTS: Record<Mode, string> = {
  letters:
    'Hold each letter still for half a second to type it. Draw J and Z in the air, then hold still. Lower your hand for a second to add a space.',
  signs: 'Raise your hand, make one sign, then lower your hand. The word appears when your hand leaves the picture.',
};

/** `?record` in the address shows the training-data recorder (for collecting new examples). */
const subscribeNothing = () => () => {};
const useRecordMode = () =>
  useSyncExternalStore(
    subscribeNothing,
    () => new URLSearchParams(window.location.search).has('record'),
    () => false
  );

export default function SignTranslator() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const landmarkerRef = useRef<HolisticLandmarker | null>(null);
  const classifyRef = useRef<Classify | null>(null);
  const readMySignRef = useRef<ReadMySign | null>(null); // my own sign model (null = not loaded)
  const readLetterRef = useRef<ReadLetter | null>(null); // my trained letter model (null = not loaded)
  const letterGuessRef = useRef<LetterGuess | null>(null); // its most recent answer
  const letterBusyRef = useRef(false); // true while the letter model is thinking
  const signBusyRef = useRef(false); // true while the sign model is thinking
  const wasSigningRef = useRef(false);
  const segmenterRef = useRef(new SignSegmenter());
  const typerRef = useRef(new LetterTyper());
  const recorderRef = useRef(new Recorder());
  const motionRef = useRef(new MotionSegmenter()); // cuts the spelling hand's movement into moves
  const readMoveRef = useRef<ReadMove | null>(null); // my moving-letters model (null = not loaded)
  const moveStartedAtRef = useRef(0); // when the current move started (performance.now())
  const lastStillRef = useRef<TypedLetter | null>(null); // the last still letter typed, and when
  const showMovingUntilRef = useRef(0); // keep showing a typed J or Z until this time
  const clipLabelRef = useRef<string | null>(null); // J, Z or other while that key is held
  const moveLabelRef = useRef<string | null>(null); // the label held during the current move
  const clipCountsRef = useRef<Record<string, number>>({}); // good moves recorded per label
  const signClipRef = useRef<Float32Array[]>([]); // both hands + body for the sign being made right now
  const signRecorderRef = useRef(new SignClipRecorder()); // records my own signs for training (with ?record)
  const signLabelRef = useRef<string | null>(null); // the word being recorded (null = not recording)
  const modeRef = useRef<Mode>('letters');
  const lastReadingRef = useRef('');

  const recordMode = useRecordMode();
  const [loading, setLoading] = useState<Loading>({
    camera: 'loading',
    tracker: 'loading',
    letters: 'loading',
    signs: 'loading',
  });
  const [error, setError] = useState('');
  const [mode, setMode] = useState<Mode>('letters');
  const [reading, setReading] = useState<Reading>({ label: null, probability: null, message: 'Starting…' });
  const [guesses, setGuesses] = useState<Guess[]>([]);
  const [signing, setSigning] = useState(false);
  const [subtitle, setSubtitle] = useState('');
  const [tip, setTip] = useState('');
  const [copied, setCopied] = useState(false);
  const [recordingLetter, setRecordingLetter] = useState<string | null>(null);
  const [recordedCount, setRecordedCount] = useState(0);
  const [moving, setMoving] = useState(false);
  const [clipCounts, setClipCounts] = useState<Record<string, number>>({});
  const [lastMove, setLastMove] = useState<{ saved: boolean; text: string } | null>(null);
  const [signWord, setSignWord] = useState('NAME');
  const [signLabel, setSignLabel] = useState<string | null>(null);
  const [signCounts, setSignCounts] = useState<Record<string, number>>({});
  const [lastSign, setLastSign] = useState('');

  const setStep = useCallback((part: keyof Loading, step: Step) => setLoading((l) => ({ ...l, [part]: step })), []);
  const addText = useCallback((text: string) => setSubtitle((s) => s + text), []);

  /** Update the reading only when it visibly changes (the camera loop runs ~30 times a second). */
  const showReading = useCallback((label: string | null, probability: number | null, message: string) => {
    const key = `${label}|${probability === null ? '' : Math.round(probability * 20)}|${message}`;
    if (lastReadingRef.current !== key) {
      lastReadingRef.current = key;
      setReading({ label, probability, message });
    }
  }, []);

  /** Starts (or with null, stops) recording signs under a label. */
  const recordSign = (label: string | null) => {
    signLabelRef.current = label;
    setSignLabel(label);
    setLastSign('');
  };

  const switchMode = (next: Mode) => {
    modeRef.current = next;
    segmenterRef.current.reset();
    signClipRef.current = [];
    typerRef.current = new LetterTyper();
    motionRef.current.reset();
    lastStillRef.current = null;
    letterGuessRef.current = null;
    wasSigningRef.current = false;
    setGuesses([]);
    setTip('');
    setSigning(false);
    setMode(next);
    showReading(null, null, next === 'letters' ? 'Show one hand to the camera' : 'Raise your hand and make one sign');
  };

  useEffect(() => {
    let cancelled = false;
    let raf = 0;
    let lastVideoTime = -1;
    let clock = 0; // MediaPipe needs timestamps that always increase
    let stream: MediaStream | null = null;

    // ---- 1. Hand tracking (MediaPipe Holistic: face + body + both hands). Nothing works without it. ----
    async function loadTracker() {
      try {
        const vision = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM);
        const landmarker = await HolisticLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: HOLISTIC_MODEL, delegate: 'GPU' },
          runningMode: 'VIDEO',
        });
        if (cancelled) return landmarker.close();
        landmarkerRef.current = landmarker;
        setStep('tracker', 'ready');
        showReading(null, null, 'Show one hand to the camera');
      } catch (err) {
        console.error('Hand tracking failed to load:', err);
        if (cancelled) return;
        setStep('tracker', 'failed');
        setError("Hand tracking couldn't load. Check your internet connection, then reload the page.");
      }
    }

    // ---- 2. My letter model (if it fails, Letters mode uses the old rules) ----
    async function loadLetters() {
      try {
        const readLetter = await loadLetterModel();
        if (cancelled) return;
        readLetterRef.current = readLetter;
        setStep('letters', 'ready');
      } catch (err) {
        console.error('Letter model failed to load, using the old rules instead:', err);
        if (!cancelled) setStep('letters', 'failed');
      }
    }

    // ---- 2b. My moving-letters model for J and Z (optional: the other letters work without it) ----
    async function loadMoves() {
      try {
        const readMove = await loadMoveModel();
        if (!cancelled) readMoveRef.current = readMove;
      } catch (err) {
        console.error('Moving-letters model failed to load, so J and Z are off:', err);
      }
    }

    // ---- 3b. My own sign model, for words the 250-sign model doesn't know (optional) ----
    async function loadMySigns() {
      try {
        const readMySign = await loadMySignModel();
        if (!cancelled) readMySignRef.current = readMySign;
      } catch (err) {
        console.error('My sign model failed to load, so only the 250 signs work:', err);
      }
    }

    // ---- 3. The sign model (optional: letters still work without it) ----
    async function loadSigns() {
      try {
        const classify = await loadClassifier();
        if (cancelled) return;
        classifyRef.current = classify;
        setStep('signs', 'ready');
      } catch (err) {
        console.error('Sign model failed to load:', err);
        if (!cancelled) setStep('signs', 'failed');
      }
    }

    // ---- 4. Camera ----
    async function startCamera() {
      const video = videoRef.current;
      if (!video) return;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 1280, height: 720, facingMode: 'user' },
        });
        if (cancelled) return stream.getTracks().forEach((t) => t.stop());
        video.srcObject = stream;
        await video.play();
        setStep('camera', 'ready');
        raf = requestAnimationFrame(loop);
      } catch (err) {
        console.error('Camera failed to start:', err);
        if (cancelled) return;
        setStep('camera', 'failed');
        setError(
          (err as Error)?.name === 'NotAllowedError'
            ? 'The camera is blocked. Allow camera access in the address bar, then reload the page.'
            : "The camera couldn't start. Close any other app that's using it, then reload the page."
        );
      }
    }

    // ---- 5. Runs every frame ----
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

      if (modeRef.current === 'letters') readLetterFrame(hands);
      else readSignFrame(result);
    }

    function readLetterFrame(hands: P3[][]) {
      // Use the hand that is higher on screen (smaller y) as the spelling hand.
      const hand = [...hands].sort((a, b) => a[0].y - b[0].y)[0];
      const now = performance.now();
      recorderRef.current.add(hand);

      // Moving letters: when a move ends, ask the moves model whether it was a J or a Z.
      const motion = motionRef.current;
      const wasMoving = motion.moving;
      const move = followMoves(hand);
      if (!wasMoving && motion.moving) moveStartedAtRef.current = now;
      if (move) void askMoveModel(move, moveStartedAtRef.current);
      const drawing = motion.moving && motion.travelled >= DRAWING_SIZE;

      let letter: string | null = null;
      let probability: number | null = null;
      if (hand && readLetterRef.current) {
        if (!letterBusyRef.current) askLetterModel(hand); // runs in the background
        const guess = letterGuessRef.current; // the model's most recent answer
        if (guess && guess.probability >= MIN_LETTER_CONFIDENCE) {
          letter = guess.letter;
          probability = guess.probability;
        }
      } else if (hand) {
        letter = classifyLetter(hand); // backup: the old hand-written rules
      } else {
        letterGuessRef.current = null; // no hand, so forget the old answer
      }

      if (now >= showMovingUntilRef.current) {
        if (drawing) showReading(null, null, 'Watching your move…');
        else
          showReading(
            letter,
            probability,
            !hand ? 'Show one hand to the camera' : letter ? 'Hold it still to type it' : 'Make a letter shape and hold it still'
          );
      }
      const typed = typerRef.current.push(drawing ? null : letter, !!hand); // no still letters while drawing
      if (typed) {
        if (typed.trim()) lastStillRef.current = { letter: typed, at: now };
        addText(typed);
      }
    }

    function readSignFrame(result: HolisticLandmarkerResult) {
      const segmenter = segmenterRef.current;
      const frame = holisticFrame(result);
      const wasActive = segmenter.active;
      // isArmUp keeps the sign open if the hand is briefly lost in front of the face.
      const frames = segmenter.push(frame, isArmUp(result.poseLandmarks?.[0]));
      // Keep both hands and the body for the same frames the segmenter keeps (for my own sign model).
      if (wasActive || hasHand(frame)) signClipRef.current.push(clipFrame(result));
      const clip = signClipRef.current;
      if (frames || !segmenter.active) signClipRef.current = [];
      const active = segmenter.active;
      setSigning(active);
      if (frames) {
        saveSignClip(clip);
        recognise(frames, clip);
      }
      else if (active && !wasSigningRef.current) showReading(null, null, 'Watching your sign…');
      else if (!active && wasSigningRef.current) showReading(null, null, 'Raise your hand and make one sign');
      wasSigningRef.current = active;
    }

    /**
     * Cuts the hand's movement into moves and returns a move when one ends. While recording
     * (J, Z or space held), also says whether each move was a good one. (The frames themselves
     * go into the CSV; the training notebook cuts them into moves with the same rules.)
     */
    function followMoves(hand: P3[] | undefined): P3[][] | null {
      const motion = motionRef.current;
      const move = motion.push(hand);
      if (motion.moving && clipLabelRef.current) moveLabelRef.current = clipLabelRef.current;
      const label = moveLabelRef.current;
      if (move || motion.discarded) {
        const stillHeld = clipLabelRef.current === label; // so the whole move made it into the CSV
        if (label && move && stillHeld) {
          const count = (clipCountsRef.current[label] ?? 0) + 1;
          clipCountsRef.current = { ...clipCountsRef.current, [label]: count };
          setClipCounts(clipCountsRef.current);
          setLastMove({ saved: true, text: `Saved ${label === 'other' ? 'other move' : label} · ${count} so far` });
        } else if (label && move) {
          setLastMove({ saved: false, text: 'Not saved: you let go too early. Hold the key until it says Saved.' });
        } else if (label && motion.discarded === 'too long') {
          setLastMove({ saved: false, text: 'Not saved: too long. Do ONE move, then freeze.' });
        } else if (label && motion.discarded === 'jumped') {
          setLastMove({ saved: false, text: 'Not saved: your other hand got in the picture.' });
        }
        moveLabelRef.current = null;
      }
      setMoving(motion.moving);
      return move;
    }

    /** Reads a finished move. If it's a J or Z, types it (in place of the I typed just before a J). */
    async function askMoveModel(move: P3[][], startedAt: number) {
      const readMove = readMoveRef.current;
      if (!readMove) return;
      try {
        const guess = await readMove(move);
        if (cancelled || modeRef.current !== 'letters') return;
        if (guess.label === 'other' || guess.probability < MIN_MOVE_CONFIDENCE) return;
        const lastStill = lastStillRef.current;
        setSubtitle((text) => addMovingLetter(text, guess.label, lastStill, startedAt));
        lastStillRef.current = null;
        typerRef.current.mute(MUTE_AFTER_MOVE);
        showMovingUntilRef.current = performance.now() + SHOW_MOVING_LETTER_MS;
        showReading(guess.label, guess.probability, 'Added to the subtitles');
      } catch (err) {
        console.error('Moving-letters model failed:', err);
      }
    }

    async function askLetterModel(points: P3[]) {
      const readLetter = readLetterRef.current;
      if (!readLetter) return;
      letterBusyRef.current = true;
      try {
        letterGuessRef.current = await readLetter(points);
      } catch (err) {
        console.error('Letter model failed:', err);
      } finally {
        letterBusyRef.current = false;
      }
    }

    /** While recording (with ?record), saves the finished sign under the word being recorded. */
    function saveSignClip(clip: Float32Array[]) {
      const label = signLabelRef.current;
      if (!label) return;
      const count = signRecorderRef.current.add(label, clip);
      setSignCounts(signRecorderRef.current.counts());
      setLastSign(`Saved ${label === 'other' ? 'other sign' : label} · ${count} so far`);
    }

    async function recognise(frames: Float32Array[], clip: Float32Array[]) {
      const classify = classifyRef.current;
      if (!classify || signBusyRef.current) return;
      signBusyRef.current = true;
      showReading(null, null, 'Reading your sign…');
      try {
        const input = toWindow(frames);
        if (!input.length) return showReading(null, null, 'Raise your hand and make one sign');
        const readMySign = readMySignRef.current;
        const [signs, mine] = await Promise.all([classify(input), readMySign ? readMySign(clip) : null]);
        // My own model wins when it's sure it saw one of its words (like NAME).
        const myWord = mine && mine.label !== 'other' && mine.probability >= MIN_MY_SIGN_CONFIDENCE;
        const top = myWord ? [{ sign: mine.label.toLowerCase(), probability: mine.probability }, ...signs.slice(0, 2)] : signs;
        setGuesses(top);
        const handFrames = frames.filter(hasHand).length;
        setTip(handFrames < MIN_HAND_FRAMES ? 'That was very quick. Try signing a little slower.' : '');
        const best = top[0];
        if (best && best.probability >= MIN_SIGN_CONFIDENCE) {
          showReading(best.sign, best.probability, 'Added to the subtitles');
          addText(best.sign.toUpperCase() + ' ');
        } else {
          showReading(null, null, 'Not sure. Try that sign again');
        }
      } catch (err) {
        console.error('Sign recognition failed:', err);
        showReading(null, null, 'Something went wrong. Try that sign again');
      } finally {
        signBusyRef.current = false;
      }
    }

    void loadTracker();
    void loadLetters();
    void loadMoves();
    void loadSigns();
    void loadMySigns();
    void startCamera();

    // ---- 6. Clean up when the page is closed ----
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
      landmarkerRef.current?.close();
      landmarkerRef.current = null;
    };
  }, [addText, setStep, showReading]);

  // Recording training data (only with ?record): hold a letter key to record that letter.
  useEffect(() => {
    if (!recordMode) return;
    const recorder = recorderRef.current;
    // A–Z records that letter. The space bar (or 0) records "other" moves: waving, moving between letters…
    const labelFor = (key: string) => (/^[a-z]$/i.test(key) ? key.toUpperCase() : key === ' ' || key === '0' ? 'other' : null);
    const onKeyDown = (event: KeyboardEvent) => {
      const label = labelFor(event.key);
      if (!label) return;
      if (event.key === ' ') event.preventDefault(); // don't scroll the page or press a focused button
      if (!event.repeat) setLastMove(null); // a new key press: clear the old result
      recorder.label = label;
      setRecordingLetter(label);
      if (label === 'J' || label === 'Z' || label === 'other') clipLabelRef.current = label;
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === ' ') event.preventDefault();
      clipLabelRef.current = null;
      recorder.label = null;
      setRecordingLetter(null);
      setRecordedCount(recorder.count);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [recordMode]);

  const text = subtitle.trim();

  const speak = () => {
    if (!text || !('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    // Lower case, so "HELLO" is read as a word rather than spelled out.
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(text.toLowerCase()));
  };

  const copy = async () => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.error('Copy failed:', err);
    }
  };

  const caption = subtitle.length > CAPTION_CHARS ? '…' + subtitle.slice(-CAPTION_CHARS) : subtitle;
  const ready = Object.values(loading).every((step) => step === 'ready');

  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5 sm:px-6">
        <span className="flex items-center gap-2.5 text-lg font-bold">
          <HandMark />
          ASL Translator
        </span>
        <a href={GITHUB_URL} className="text-sm font-semibold text-muted hover:text-ink">
          View on GitHub
        </a>
      </header>

      <main className="mx-auto max-w-6xl px-4 pb-16 sm:px-6">
        <div className="mb-7 max-w-2xl">
          <h1 className="text-3xl font-bold tracking-tight sm:text-[2.6rem] sm:leading-[1.1]">
            Sign to your camera. Read it as subtitles.
          </h1>
          <p className="mt-3 text-lg text-muted">
            Fingerspell all 26 letters or sign 250 everyday words. It all runs in your browser, so your video never
            leaves your device.
          </p>
        </div>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          {/* ---------- Camera ---------- */}
          <div>
            <div className="relative aspect-video overflow-hidden rounded-[20px] bg-[#0c0f14]">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="absolute inset-0 h-full w-full -scale-x-100 object-cover"
              />
              <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full -scale-x-100" />

              {loading.camera !== 'ready' && (
                <p className="absolute inset-0 grid place-items-center p-6 text-center text-white/75">
                  {loading.camera === 'loading' ? 'Allow camera access to start' : 'Camera off'}
                </p>
              )}

              {recordMode && mode === 'letters' && (
                <div className="absolute inset-x-3 top-3 flex flex-wrap items-start justify-between gap-2 text-sm font-bold sm:text-base">
                  <span
                    className={`flex items-center gap-2 rounded-full px-3 py-1 ${recordingLetter ? 'bg-accent text-accent-ink' : 'bg-black/75 text-white'}`}
                  >
                    <span className={`h-2.5 w-2.5 rounded-full ${moving ? 'animate-pulse bg-current' : 'bg-white/40'}`} />
                    {recordingLetter ? `Recording ${recordingLetter}` : 'Not recording'} · {moving ? 'moving' : 'still'}
                  </span>
                  {lastMove && (
                    <span
                      className={`rounded-xl px-3 py-1 text-white ${lastMove.saved ? 'bg-[#15803d]' : 'bg-[#b42318]'}`}
                    >
                      {lastMove.saved ? '✓ ' : '✗ '}
                      {lastMove.text}
                    </span>
                  )}
                </div>
              )}

              {recordMode && mode === 'signs' && (
                <div className="absolute inset-x-3 top-3 flex flex-wrap items-start justify-between gap-2 text-sm font-bold sm:text-base">
                  <span
                    className={`flex items-center gap-2 rounded-full px-3 py-1 ${signLabel ? 'bg-accent text-accent-ink' : 'bg-black/75 text-white'}`}
                  >
                    <span className={`h-2.5 w-2.5 rounded-full ${signing ? 'animate-pulse bg-current' : 'bg-white/40'}`} />
                    {signLabel ? `Recording ${signLabel === 'other' ? 'other signs' : signLabel}` : 'Not recording'}
                    {signing ? ' · watching' : ''}
                  </span>
                  {lastSign && <span className="rounded-xl bg-[#15803d] px-3 py-1 text-white">✓ {lastSign}</span>}
                </div>
              )}

              {signing && !recordMode && (
                <span className="absolute left-3 top-3 flex items-center gap-2 rounded-full bg-accent px-3 py-1 text-sm font-semibold text-accent-ink">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-current" /> Watching your sign
                </span>
              )}

              {caption && (
                <p
                  aria-hidden="true"
                  className="absolute inset-x-4 bottom-4 mx-auto w-fit max-w-[92%] rounded-md bg-black/80 px-3 py-1.5 text-center text-xl font-bold leading-snug text-white sm:text-2xl"
                >
                  {caption}
                </p>
              )}
            </div>

            {!ready && <LoadingList loading={loading} />}
            {error && (
              <p role="alert" className="mt-3 rounded-lg border border-warn/40 px-3 py-2 text-sm font-semibold text-warn">
                {error}
              </p>
            )}
          </div>

          {/* ---------- Panel ---------- */}
          <section aria-label="Translation" className="flex flex-col rounded-2xl border border-line bg-surface">
            <div className="border-b border-line p-5">
              <div className="flex rounded-full bg-page p-1" role="group" aria-label="What to read">
                <ModeButton active={mode === 'letters'} onClick={() => switchMode('letters')}>
                  Letters
                </ModeButton>
                <ModeButton
                  active={mode === 'signs'}
                  onClick={() => switchMode('signs')}
                  disabled={loading.signs !== 'ready'}
                >
                  {loading.signs === 'loading' ? 'Signs (loading…)' : 'Signs'}
                </ModeButton>
              </div>
              <p className="mt-3 text-sm text-muted">{HINTS[mode]}</p>
            </div>

            <div className="border-b border-line p-5">
              {mode === 'letters' ? (
                <div className="flex items-center gap-5">
                  <span
                    className={`w-[1.1ch] text-center text-[5.5rem] font-bold leading-none ${
                      reading.label ? 'text-ink' : 'text-line'
                    }`}
                  >
                    {reading.label ?? '?'}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{reading.message}</p>
                    {reading.probability !== null && <ConfidenceBar value={reading.probability} />}
                    {loading.letters === 'failed' && (
                      <p className="mt-1 text-sm text-muted">Using the simple backup rules (15 letters).</p>
                    )}
                  </div>
                </div>
              ) : (
                <div>
                  <p className={`text-4xl font-bold ${reading.label ? 'text-ink' : 'text-line'}`}>
                    {reading.label ?? '…'}
                  </p>
                  <p className="mt-1 font-semibold">{reading.message}</p>
                  {guesses.length > 0 && (
                    <ul className="mt-3 space-y-1.5" aria-label="Top guesses">
                      {guesses.map((g) => (
                        <li key={g.sign} className="flex items-center gap-3 text-sm">
                          <span className="w-24 truncate">{g.sign}</span>
                          <ConfidenceBar value={g.probability} compact />
                        </li>
                      ))}
                    </ul>
                  )}
                  {tip && <p className="mt-2 text-sm font-semibold text-warn">{tip}</p>}
                </div>
              )}
            </div>

            <div className="flex-1 p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-bold">Subtitles</h2>
                <div className="flex flex-wrap gap-1.5">
                  <ActionButton onClick={speak} disabled={!text}>
                    Speak
                  </ActionButton>
                  <ActionButton onClick={copy} disabled={!text}>
                    {copied ? 'Copied' : 'Copy'}
                  </ActionButton>
                  <ActionButton onClick={() => setSubtitle(deleteLastWord)} disabled={!text}>
                    Delete word
                  </ActionButton>
                  <ActionButton onClick={() => setSubtitle('')} disabled={!text}>
                    Clear
                  </ActionButton>
                </div>
              </div>
              <p
                aria-live="polite"
                className="mt-3 min-h-[5.5rem] break-words rounded-xl bg-page px-4 py-3 text-xl font-bold tracking-wide"
              >
                {subtitle || <span className="text-base font-normal tracking-normal text-muted">Your words appear here.</span>}
              </p>
            </div>

            {recordMode && (
              <div className="border-t border-line p-5 text-sm">
                {mode !== 'letters' ? (
                  <>
                    <h2 className="font-bold">Recording your own signs</h2>
                    <ul className="mt-1 list-disc space-y-1 pl-5 text-muted">
                      <li>
                        Click Record {signWord || 'a word'}. Then raise your hands, sign it, and lower your hands out of the
                        picture. Repeat.
                      </li>
                      <li>Click Record other signs and do lots of different signs the same way (HELLO, MY, MOM…).</li>
                      <li>Each sign is saved when your hands leave the picture.</li>
                    </ul>
                    <label className="mt-3 flex items-center gap-2 font-semibold">
                      Word
                      <input
                        value={signWord}
                        onChange={(e) => setSignWord(e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))}
                        className="w-32 rounded-md border border-line bg-surface px-2 py-1 font-bold"
                      />
                    </label>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={!signWord}
                        onClick={() => recordSign(signWord === 'OTHER' ? 'other' : signWord)}
                        className="rounded-lg bg-accent px-3 py-1.5 text-sm font-bold text-accent-ink disabled:opacity-40"
                      >
                        Record {signWord || '…'}
                      </button>
                      <ActionButton onClick={() => recordSign('other')}>Record other signs</ActionButton>
                      <ActionButton onClick={() => recordSign(null)} disabled={!signLabel}>
                        Stop
                      </ActionButton>
                    </div>
                    <p className="mt-3 text-muted">
                      Signs saved:{' '}
                      {Object.entries(signCounts)
                        .map(([label, count]) => `${label} ${count}`)
                        .join(', ') || 'none yet'}
                      .
                    </p>
                    <ActionButton onClick={() => signRecorderRef.current.download()} className="mt-3">
                      Download signs (CSV)
                    </ActionButton>
                  </>
                ) : (
                  <>
                    <h2 className="font-bold">Recording training data</h2>
                    <ul className="mt-1 list-disc space-y-1 pl-5 text-muted">
                      <li>Still letters: hold the letter&apos;s key while you show the letter.</li>
                      <li>J and Z: hold the key, draw the letter once, then hold still until it says “Saved”.</li>
                      <li>Other moves: hold the space bar while you wave or move between letters.</li>
                      <li>Keep your other hand out of the picture.</li>
                    </ul>
                    <p className="mt-3 flex items-center gap-2 font-semibold">
                      <span className={`h-2.5 w-2.5 rounded-full ${moving ? 'bg-accent' : 'bg-line'}`} />
                      {moving ? 'Hand moving' : 'Hand still'}
                      {recordingLetter && <span className="font-normal text-muted">· recording {recordingLetter}</span>}
                    </p>
                    <p className="mt-1 text-muted">
                      Frames saved: {recordedCount}. Moves saved: J {clipCounts.J ?? 0}, Z {clipCounts.Z ?? 0}, other{' '}
                      {clipCounts.other ?? 0}.
                    </p>
                    {lastMove && <p className="mt-1 font-semibold">{lastMove.text}</p>}
                    <button
                      type="button"
                      onClick={() => recorderRef.current.download()}
                      className="mt-3 rounded-lg bg-accent px-3 py-1.5 text-sm font-bold text-accent-ink"
                    >
                      Download recording (CSV)
                    </button>
                    <p className="mt-2 text-xs text-muted">Everything you recorded is in this one file.</p>
                  </>
                )}
              </div>
            )}
          </section>
        </div>

        {mode === 'letters' ? (
          <LetterGuide current={reading.label} />
        ) : (
          <SignGuide current={reading.label} />
        )}

        <HowItWorks />
      </main>

      <footer className="border-t border-line">
        <p className="mx-auto max-w-6xl px-4 py-6 text-sm leading-relaxed text-muted sm:px-6">
          A learning project, not an interpreter. Sign model: ASL Realtime Transformer by Ceyda Akin (CC BY 4.0).
          Hand tracking: MediaPipe by Google. Letter drawings: Wikimedia Commons (public domain). Built by Nilam
          Shinde.
        </p>
      </footer>
    </div>
  );
}

// ---------- small pieces ----------

function HandMark() {
  // Five fingertips joined to a wrist point: the same dots the app draws on your hand.
  const tips: [number, number][] = [
    [6, 12],
    [10, 6],
    [15, 4.5],
    [20, 6],
    [24, 10],
  ];
  return (
    <svg width="30" height="30" viewBox="0 0 30 30" aria-hidden="true" className="shrink-0">
      <rect width="30" height="30" rx="9" className="fill-accent" />
      {tips.map(([x, y]) => (
        <line key={x} x1="15" y1="24" x2={x} y2={y} className="stroke-accent-ink" strokeOpacity="0.55" strokeWidth="1.4" />
      ))}
      {tips.map(([x, y]) => (
        <circle key={x} cx={x} cy={y} r="2" className="fill-accent-ink" />
      ))}
      <circle cx="15" cy="24" r="2.4" className="fill-accent-ink" />
    </svg>
  );
}

function ModeButton({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={`flex-1 rounded-full px-4 py-2 text-sm font-bold transition-colors disabled:opacity-45 ${
        active ? 'bg-accent text-accent-ink' : 'text-muted hover:text-ink'
      }`}
    >
      {children}
    </button>
  );
}

function ActionButton({
  onClick,
  disabled,
  className = '',
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-lg border border-line px-3 py-1.5 text-sm font-semibold transition-colors hover:bg-page disabled:opacity-40 disabled:hover:bg-transparent ${className}`}
    >
      {children}
    </button>
  );
}

function ConfidenceBar({ value, compact = false }: { value: number; compact?: boolean }) {
  const percent = Math.round(value * 100);
  return (
    <div className={`flex flex-1 items-center gap-3 ${compact ? '' : 'mt-2'}`}>
      <div
        role="meter"
        aria-label="How sure the model is"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className={`flex-1 overflow-hidden rounded-full bg-accent-soft ${compact ? 'h-1.5' : 'h-2'}`}
      >
        <div className="h-full rounded-full bg-accent transition-[width] duration-200" style={{ width: `${percent}%` }} />
      </div>
      <span className="w-11 text-right text-sm font-semibold tabular-nums">{percent}%</span>
    </div>
  );
}

function LoadingList({ loading }: { loading: Loading }) {
  const items: [keyof Loading, string][] = [
    ['camera', 'Camera'],
    ['tracker', 'Hand tracking'],
    ['letters', 'Letter model'],
    ['signs', 'Sign model'],
  ];
  return (
    <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted" aria-label="Loading progress">
      {items.map(([key, label]) => (
        <li key={key} className="flex items-center gap-1.5">
          <StepIcon step={loading[key]} />
          {label}
          <span className="sr-only">: {loading[key]}</span>
        </li>
      ))}
    </ul>
  );
}

function StepIcon({ step }: { step: Step }) {
  if (step === 'loading') {
    return <span aria-hidden="true" className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-line border-t-accent" />;
  }
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" className={step === 'ready' ? 'text-accent' : 'text-warn'}>
      {step === 'ready' ? (
        <path d="M3 7.5l2.5 2.5L11 4.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      ) : (
        <path d="M4 4l6 6M10 4l-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      )}
    </svg>
  );
}

function deleteLastWord(text: string) {
  const trimmed = text.trimEnd();
  const lastSpace = trimmed.lastIndexOf(' ');
  return lastSpace < 0 ? '' : trimmed.slice(0, lastSpace + 1);
}

// ---------- drawing the dots on the video ----------

const HAND_LINKS = HolisticLandmarker.HAND_CONNECTIONS;
const ARM_POINTS = [11, 12, 13, 14, 15, 16]; // shoulders, elbows, wrists

function draw(canvas: HTMLCanvasElement, video: HTMLVideoElement, hands: P3[][], pose: P3[] | undefined) {
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
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    for (const i of ARM_POINTS) {
      const p = pose[i];
      if (!p) continue;
      ctx.beginPath();
      ctx.arc(p.x * w, p.y * h, 5, 0, 2 * Math.PI);
      ctx.fill();
    }
  }

  for (const hand of hands) {
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 3;
    for (const { start, end } of HAND_LINKS) {
      ctx.beginPath();
      ctx.moveTo(hand[start].x * w, hand[start].y * h);
      ctx.lineTo(hand[end].x * w, hand[end].y * h);
      ctx.stroke();
    }
    ctx.fillStyle = DOT_COLOR;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    for (const p of hand) {
      ctx.beginPath();
      ctx.arc(p.x * w, p.y * h, 6, 0, 2 * Math.PI);
      ctx.fill();
      ctx.stroke();
    }
  }
}
