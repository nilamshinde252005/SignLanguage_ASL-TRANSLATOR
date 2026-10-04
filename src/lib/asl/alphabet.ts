/**
 * The ASL alphabet, for the letter guide shown in Letters mode.
 *
 * Pictures: the "Sign language A–Z" drawings from Wikimedia Commons (public domain),
 * loaded straight from Wikimedia, so the guide needs an internet connection.
 * `supported` = letters the app can recognise (see letters.ts).
 */

export interface AlphabetLetter {
  letter: string;
  supported: boolean;
  how: string; // short plain-English description of the handshape
  image: string;
}

const IMG = 'https://upload.wikimedia.org/wikipedia/commons';

export const ALPHABET: AlphabetLetter[] = [
  { letter: 'A', supported: true, how: 'Fist, thumb resting up against the side of the index finger.', image: `${IMG}/2/27/Sign_language_A.svg` },
  { letter: 'B', supported: true, how: 'Flat hand, four fingers up and together, thumb folded across the palm.', image: `${IMG}/1/18/Sign_language_B.svg` },
  { letter: 'C', supported: true, how: 'Curve the hand into a C, like holding a cup.', image: `${IMG}/e/e3/Sign_language_C.svg` },
  { letter: 'D', supported: true, how: 'Index finger up; the other fingertips touch the thumb in a circle.', image: `${IMG}/0/06/Sign_language_D.svg` },
  { letter: 'E', supported: true, how: 'Fingertips bent down onto the thumb, which is tucked under them.', image: `${IMG}/c/cd/Sign_language_E.svg` },
  { letter: 'F', supported: true, how: 'Index finger and thumb touch in a circle; the other three fingers up.', image: `${IMG}/8/8f/Sign_language_F.svg` },
  { letter: 'G', supported: true, how: 'Index finger and thumb point sideways, parallel, with a small gap.', image: `${IMG}/d/d9/Sign_language_G.svg` },
  { letter: 'H', supported: false, how: 'Index and middle fingers together, pointing sideways.', image: `${IMG}/9/97/Sign_language_H.svg` },
  { letter: 'I', supported: true, how: 'Little finger up, the rest in a fist with the thumb across.', image: `${IMG}/1/10/Sign_language_I.svg` },
  { letter: 'J', supported: false, how: 'Make an I, then draw a J in the air with the little finger (moves).', image: `${IMG}/b/b1/Sign_language_J.svg` },
  { letter: 'K', supported: false, how: 'Index and middle fingers up in a V, thumb touching the middle finger.', image: `${IMG}/9/97/Sign_language_K.svg` },
  { letter: 'L', supported: true, how: 'Index finger up and thumb out to the side: an L shape.', image: `${IMG}/d/d2/Sign_language_L.svg` },
  { letter: 'M', supported: false, how: 'Thumb tucked under the first three fingers.', image: `${IMG}/c/c4/Sign_language_M.svg` },
  { letter: 'N', supported: false, how: 'Thumb tucked under the first two fingers.', image: `${IMG}/e/e6/Sign_language_N.svg` },
  { letter: 'O', supported: true, how: 'All fingertips curve round to meet the thumb, making an O.', image: `${IMG}/e/e0/Sign_language_O.svg` },
  { letter: 'P', supported: false, how: 'Like K, but pointing down.', image: `${IMG}/0/08/Sign_language_P.svg` },
  { letter: 'Q', supported: false, how: 'Like G, but pointing down.', image: `${IMG}/3/34/Sign_language_Q.svg` },
  { letter: 'R', supported: false, how: 'Index and middle fingers crossed.', image: `${IMG}/3/3d/Sign_language_R.svg` },
  { letter: 'S', supported: true, how: 'Fist with the thumb wrapped across the front of the fingers.', image: `${IMG}/3/3f/Sign_language_S.svg` },
  { letter: 'T', supported: false, how: 'Thumb tucked between the index and middle fingers.', image: `${IMG}/1/13/Sign_language_T.svg` },
  { letter: 'U', supported: true, how: 'Index and middle fingers up, held together.', image: `${IMG}/7/7c/Sign_language_U.svg` },
  { letter: 'V', supported: true, how: 'Index and middle fingers up and spread apart (peace sign).', image: `${IMG}/c/ca/Sign_language_V.svg` },
  { letter: 'W', supported: true, how: 'Index, middle and ring fingers up and spread.', image: `${IMG}/8/83/Sign_language_W.svg` },
  { letter: 'X', supported: false, how: 'Index finger bent like a hook.', image: `${IMG}/b/b7/Sign_language_X.svg` },
  { letter: 'Y', supported: true, how: 'Thumb and little finger out, the others folded (hang loose).', image: `${IMG}/1/1d/Sign_language_Y.svg` },
  { letter: 'Z', supported: false, how: 'Draw a Z in the air with the index finger (moves).', image: `${IMG}/0/0a/Sign_language_Z.svg` },
];
