# ASL Translator

[![CI/CD](https://github.com/nilamshinde252005/SignLanguage_ASL-TRANSLATOR/actions/workflows/ci-cd.yml/badge.svg)](https://github.com/nilamshinde252005/SignLanguage_ASL-TRANSLATOR/actions/workflows/ci-cd.yml)

**Live demo:** https://nilamshinde252005.github.io/SignLanguage_ASL-TRANSLATOR/ (Chrome recommended, allow the camera)

<!-- Demo GIF goes here: ![Demo](docs/demo.gif) -->

A website that watches you through your webcam and turns **American Sign Language** into subtitles, live in the browser. It reads all **26 fingerspelled letters** and short sentences like **"HELLO, MY NAME N-I-L-A-M"** and **"HOW YOU?"**.

Three of its four models **I trained myself**, on recordings of my own hands that I made with a recorder built into the site.

- **Letters mode:** all 26 letters. 24 are still hand shapes; J and Z are drawn in the air, so a second model reads the movement.
- **Signs mode:** 250 everyday signs from an open-source model, plus **NAME, MY, HOW and YOU** from my own sign model. After NAME it switches to Letters by itself so you can spell the name, then switches back.
- **Private:** everything runs on your own device. No video is uploaded.

## The models I trained

| Model | What it reads | Trained on | Tested on recordings it never studied |
|---|---|---|---|
| **Still letters** | 24 hand shapes (A–Y without J, Z) | ~18,000 camera frames of my hand from 7 recording sessions | **93%** on a separate exam session. The hand-written rules it replaced got 57%. |
| **Moving letters** | J, Z or "other" | 96 moves (33 J, 30 Z, 33 other) | 8 of 9 held-back moves, and no wrong J or Z typed (a small test so far) |
| **My signs** | NAME, MY, HOW, YOU or "other" | 164 sign clips | 32 of 32 held-back clips (same day as training, so expect less on new days) |

The letter model only types a letter when it's at least 70% sure. On the exam that means it answers on 92% of frames and is right on 97% of those. The other two only answer when at least 80% sure.

Every model is small (13,000–24,000 numbers to learn) and runs in real time in the browser.

## How it works

1. **Find the body.** [MediaPipe Holistic](https://developers.google.com/mediapipe) finds 21 points on each hand plus points on the face and body, in every camera frame.
2. **Still letters.** The 21 hand points are centred on the wrist, scaled to the palm size and mirrored for left hands, then 45 fingertip-to-knuckle distances are added: 108 numbers that describe the hand shape wherever it is. A small neural network picks one of 24 letters.
3. **Moving letters.** A move detector cuts the hand's path into moves: speeding up starts a move, freezing ends it. Each move is stretched or squashed to 24 frames and read by a **Conv1D** network, which slides a small window along time looking for patterns like "down, then curve". If it's a J, it replaces the I that was typed at the start of the move.
4. **Signs.** A sign is "raise your hands → sign → lower them". Each sign goes to both the [250-sign transformer](https://www.kaggle.com/models/ceydaakin2004/asl-realtime-transformer) and my own Conv1D sign model; mine wins when it's at least 80% sure.
5. **Run in the browser.** The models are trained in Keras, exported to TensorFlow Lite with a fixed input shape, and run with [LiteRT.js](https://ai.google.dev/edge/litert) (WebAssembly).

## What I learned

- **Test on data the model has never seen.** My first letter model scored 43% on its exam: it had learned my one recording session, not the letters. Mirroring left hands took it to 62%, recording more varied sessions (different distances, angles, light, both hands) to 79%, and adding distance features to 93%.
- **Python and the browser must agree exactly.** The notebooks prepare the numbers in Python and the website in TypeScript. Unit tests load the same recordings in both and check they give the same numbers, so the two can never drift apart.
- **Good data needs a good recorder.** Collecting J and Z only worked once the recorder showed a big green "Saved" or a red "too long / other hand in the picture" on the camera view, and the move detector's thresholds were measured from my real recordings.

## Train it yourself

The training notebooks run in Google Colab:

| Notebook | Model |
|---|---|
| [`training/train_letters.ipynb`](training/train_letters.ipynb) | Still letters |
| [`training/train_moves.ipynb`](training/train_moves.ipynb) | Moving letters (J, Z) |
| [`training/train_signs.ipynb`](training/train_signs.ipynb) | My signs (NAME, MY, HOW, YOU) |

My recordings are in `training/data/`. To record your own, open the site with `?record` at the end of the address: in Letters mode, hold a letter key (or the space bar for "other" moves); in Signs mode, type a word and click Record.

## Run it

```bash
npm install
npm run dev
```

Then open http://localhost:3000 in Chrome and allow the camera.

## Tests

```bash
npm test        # 41 unit tests (Vitest)
npm run lint    # ESLint
```

The tests in `src/lib/asl/__tests__/` cover:
- the notebook-to-browser checks above, for all three models;
- the move detector (jitter, jumps, gaps, moves that go on too long);
- letter typing, including swapping the I for a J;
- sign segmentation and the 250-sign model's input preparation;
- the recorders.

## CI/CD and deployment

`.github/workflows/ci-cd.yml` runs on every push and pull request:

1. **Lint + unit tests**, which must pass before anything is deployed.
2. **GitHub Pages:** builds the static site and publishes it.
3. **AWS EC2:** builds the site and deploys it over SSH (`rsync`) to an Ubuntu server running nginx with HTTPS (Let's Encrypt). Setup guide: [`deploy/EC2_DEPLOYMENT.md`](deploy/EC2_DEPLOYMENT.md).

## Project layout

| Path | What it does |
|---|---|
| `src/components/SignTranslator.tsx` | The page: camera, points, modes, subtitles, recorders |
| `src/lib/asl/letterModel.ts` | My still-letter model: the 108 numbers and loading the model |
| `src/lib/asl/motion.ts` | The move detector that cuts the hand's path into moves |
| `src/lib/asl/moveModel.ts` | My moving-letter model (J, Z) |
| `src/lib/asl/signModel.ts` | My sign model (NAME, MY, HOW, YOU) |
| `src/lib/asl/preprocess.ts` | Cuts the video into signs and prepares them for the 250-sign model |
| `src/lib/asl/classifier.ts` | Loads the 250-sign model and asks it for its top guesses |
| `src/lib/asl/letters.ts` | Letter typing, and the old hand-written letter rules (now a backup) |
| `src/lib/asl/recorder.ts`, `signClips.ts` | The recorders for training data |
| `training/` | The three training notebooks and my recordings |
| `public/models/` | The four models the site loads |
| `deploy/` | EC2 server setup script, nginx config and deployment guide |

## Limitations

- Signs are read **one at a time**: you lower your hands between signs (HOW, hands down, YOU). Reading continuous signing needs a different kind of model, trained on whole signed sentences, and is the natural next step.
- My models are trained on **one person: me**. They will be less accurate for other people until they're trained on more signers.
- The hardest letters are the ones where the thumb hides under the fingers (M, N, T) and E vs O.
- It's a learning project, not an interpreter.

## Credits

- **250-sign model:** "ASL Realtime Transformer" by Ceyda Akin, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) ([Kaggle](https://www.kaggle.com/models/ceydaakin2004/asl-realtime-transformer)). Trained on the Google Isolated Sign Language Recognition dataset.
- **Point preparation for that model** (`src/lib/asl/preprocess.ts`) is adapted from [ceydaakin/asl-realtime](https://github.com/ceydaakin/asl-realtime), MIT licence, Copyright (c) Ceyda Akin.
- **Hand, face and body tracking:** [MediaPipe](https://developers.google.com/mediapipe) by Google. **Model runtime:** [LiteRT.js](https://ai.google.dev/edge/litert) by Google.
- **Letter drawings:** "Sign language A–Z" from [Wikimedia Commons](https://commons.wikimedia.org/) (public domain).

Built with Next.js, React, TypeScript, Tailwind CSS, Keras and TensorFlow Lite.
