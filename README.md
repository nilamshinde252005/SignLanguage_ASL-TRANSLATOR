# ASL Translator

A website that watches you through your webcam and turns **American Sign Language** into subtitles, live in the browser.

- **Letters mode:** fingerspell 15 ASL letters (A B C D E F G I L O S U V W Y), with a picture guide for every letter.
- **Signs mode:** recognise **250 everyday ASL signs** (hello, thank you, mom, drink, …), one sign at a time.
- **Private:** everything runs on your own computer. No video is uploaded.

> A learning demo, not an interpreter. Expect roughly 3 out of 4 signs to be right for new signers.

## How it works

1. **MediaPipe Holistic** (Google) finds 543 points on the face, body and hands in every camera frame.
2. **Letters:** simple geometry rules on the 21 hand points (which fingers are straight, how far apart they are).
3. **Signs:** the app records one sign (from raising your hand to lowering it), keeps the lips, signing hand and arm points, and gives them to a small **transformer model** that scores all 250 signs.
4. The best guess (40% or higher) is added to the subtitles.

## Run it

```bash
npm install
npm run dev
```

Then open http://localhost:3000 in Chrome and allow the camera.

## Project layout

| Path | What it does |
|---|---|
| `src/components/SignTranslator.tsx` | The page: camera, drawing the points, modes, subtitles, letter guide |
| `src/lib/asl/preprocess.ts` | Cuts the video into single signs and prepares the points for the model |
| `src/lib/asl/classifier.ts` | Loads the model and asks it for its top guesses |
| `src/lib/asl/letters.ts` | Rules for the fingerspelled letters |
| `src/lib/asl/alphabet.ts` | Letter guide pictures and descriptions |
| `public/models/asl_transformer/` | The trained model (`asl_int8.tflite`) and its list of 250 signs |

## Credits

- **Sign model:** "ASL Realtime Transformer" by Ceyda Akin, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) ([Kaggle](https://www.kaggle.com/models/ceydaakin2004/asl-realtime-transformer)). Trained on the Google Isolated Sign Language Recognition dataset.
- **Point preparation** (`src/lib/asl/preprocess.ts`) is adapted from [ceydaakin/asl-realtime](https://github.com/ceydaakin/asl-realtime), MIT licence, Copyright (c) Ceyda Akin.
- **Hand, face and body tracking:** [MediaPipe](https://developers.google.com/mediapipe) by Google. **Model runtime:** [LiteRT.js](https://ai.google.dev/edge/litert) by Google.
- **Letter drawings:** "Sign language A–Z" from [Wikimedia Commons](https://commons.wikimedia.org/) (public domain).

Built with Next.js, React, TypeScript and Tailwind CSS.
