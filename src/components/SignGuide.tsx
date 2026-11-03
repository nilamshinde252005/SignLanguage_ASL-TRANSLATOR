import signs from '../../public/models/asl_transformer/signs.json';
import mySigns from '../../public/models/my_signs/my_signs.json';
import { prettySign } from '../lib/asl/classifier';

// Words my own sign model knows (trained in training/train_signs.ipynb).
const MY_SIGNS = mySigns.filter((word) => word !== 'other').map((word) => word.toLowerCase());

// Everyday words from the sign model's 250, in the order you might use them.
const EVERYDAY = [
  'hello', 'minemy', 'thankyou', 'please', 'yes', 'no', 'mom', 'dad', 'drink', 'water', 'milk', 'food',
  'hungry', 'thirsty', 'happy', 'sad', 'fine', 'sleep', 'home', 'where', 'who', 'why', 'morning',
  'night', 'tomorrow', 'bye',
].map(prettySign);

const ALL_SIGNS = signs.map(prettySign).sort((a, b) => a.localeCompare(b));

/** Word list for Signs mode. The last sign the app recognised is highlighted. */
export default function SignGuide({ current }: { current: string | null }) {
  return (
    <section aria-labelledby="sign-guide" className="mt-14">
      <h2 id="sign-guide" className="text-2xl font-bold tracking-tight">
        Signs to try
      </h2>
      <p className="mt-1 max-w-2xl text-muted">
        Everyday words the sign model knows. Raise your hand, make one sign, then lower your hand.
      </p>

      <Chips words={EVERYDAY} current={current} />

      <p className="mt-6 text-sm font-semibold">Signs the 250-word model doesn&apos;t know, from my own trained model:</p>
      <Chips words={MY_SIGNS} current={current} />

      <details className="mt-5 max-w-3xl">
        <summary className="cursor-pointer text-sm font-semibold text-accent">
          See all {ALL_SIGNS.length} signs
        </summary>
        <p className="mt-3 text-sm leading-relaxed text-muted">{ALL_SIGNS.join(', ')}</p>
      </details>

      <p className="mt-4 text-sm text-muted">
        To learn how to make a sign, look it up on{' '}
        <a href="https://lifeprint.com" className="font-semibold text-accent underline-offset-2 hover:underline">
          Lifeprint
        </a>
        , a free ASL video dictionary.
      </p>
    </section>
  );
}

function Chips({ words, current }: { words: string[]; current: string | null }) {
  return (
    <ul className="mt-3 flex flex-wrap gap-2">
      {words.map((word) => (
        <li
          key={word}
          className={`rounded-full border px-3.5 py-1.5 text-sm font-semibold transition-colors ${
            word === current ? 'border-accent bg-accent-soft' : 'border-line bg-surface'
          }`}
        >
          {word}
        </li>
      ))}
    </ul>
  );
}
