/**
 * Loads the trained ASL sign model (a .tflite file) and runs it in the browser with LiteRT.js.
 *
 * Model: "ASL Realtime Transformer" by Ceyda Akin, CC BY 4.0
 * https://www.kaggle.com/models/ceydaakin2004/asl-realtime-transformer
 */
import { INPUT_SIZE, N_COLS, type ModelWindow } from './preprocess';

const LITERT_VERSION = '2.5.3'; // keep in step with @litertjs/core in package.json
const LITERT_WASM = `https://cdn.jsdelivr.net/npm/@litertjs/core@${LITERT_VERSION}/wasm/`;

export const MODEL_URL = '/models/asl_transformer/asl_int8.tflite';
export const SIGNS_URL = '/models/asl_transformer/signs.json';

export interface Guess {
  sign: string; // tidy label, e.g. "thank you"
  probability: number; // 0..1
}

export type Classify = (window: ModelWindow) => Promise<Guess[]>;

// Some labels in the dataset are squashed together; make them readable for subtitles.
const PRETTY: Record<string, string> = {
  callonphone: 'call on phone',
  frenchfries: 'french fries',
  glasswindow: 'window',
  haveto: 'have to',
  hesheit: 'he/she/it',
  icecream: 'ice cream',
  minemy: 'my',
  thankyou: 'thank you',
  weus: 'we/us',
  owie: 'ouch',
};
export const prettySign = (raw: string) => PRETTY[raw] ?? raw;

// LiteRT can only be started once per page, but React (in dev mode) runs effects twice,
// so the loading is shared: every caller gets the same promise.
let loading: Promise<Classify> | null = null;

/** Download the model + sign list and return a function that classifies one sign. */
export function loadClassifier(): Promise<Classify> {
  loading ??= createClassifier().catch((error) => {
    loading = null; // allow a retry after e.g. the model file has been added
    throw error;
  });
  return loading;
}

/**
 * LiteRT prints routine status lines ("INFO: ...", "WARNING: ...") with console.error.
 * Next.js dev mode shows every console.error as a red error popup, which is misleading,
 * so those lines are sent to console.debug instead. Real errors are still shown.
 * (To see the hidden lines: DevTools console → levels → tick "Verbose".)
 */
let logsQuieted = false;
function quietLiteRtLogs() {
  if (logsQuieted || typeof window === 'undefined') return;
  logsQuieted = true;
  const showError = console.error;
  console.error = (...args: unknown[]) => {
    if (typeof args[0] === 'string' && /^(INFO|WARNING|VERBOSE): /.test(args[0])) {
      console.debug(...args);
      return;
    }
    showError(...args);
  };
}

async function createClassifier(): Promise<Classify> {
  quietLiteRtLogs(); // must run before LiteRT is loaded

  // Imported here (not at the top) so Next.js never tries to load it on the server.
  const { Tensor, getGlobalLiteRtPromise, loadAndCompile, loadLiteRt } = await import('@litertjs/core');

  // Start LiteRT unless an earlier attempt already did.
  await (getGlobalLiteRtPromise() ?? loadLiteRt(LITERT_WASM));
  const modelResponse = await fetch(MODEL_URL);
  if (!modelResponse.ok) {
    throw new Error(`Model file not found at public${MODEL_URL}. Download asl_int8.tflite from Kaggle.`);
  }
  const model = await loadAndCompile(new Uint8Array(await modelResponse.arrayBuffer()), {
    accelerator: 'wasm',
  });
  const signs: string[] = await (await fetch(SIGNS_URL)).json();

  // The converter drops input names, so tell "xy" (4-D) and "mask" (2-D) apart by shape.
  const xyFirst = model.getInputDetails()[0].shape.length === 4;

  return async ({ xy, mask }) => {
    const inputs = [new Tensor(xy, [1, INPUT_SIZE, N_COLS, 2]), new Tensor(mask, [1, INPUT_SIZE])];
    const outputs = await model.run(xyFirst ? inputs : [...inputs].reverse());
    const probs = Array.from(outputs[0].toTypedArray() as Float32Array);
    [...inputs, ...outputs].forEach((t) => t.delete()); // free WebAssembly memory
    return probs
      .map((p, i) => ({ sign: prettySign(signs[i]), probability: p }))
      .sort((a, b) => b.probability - a.probability)
      .slice(0, 3);
  };
}
