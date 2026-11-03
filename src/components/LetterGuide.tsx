import { ALPHABET, type AlphabetLetter } from '../lib/asl/alphabet';

/** Picture guide for Letters mode. The letter the app sees right now is highlighted. */
export default function LetterGuide({ current }: { current: string | null }) {
  const supported = ALPHABET.filter((l) => l.supported);

  return (
    <section aria-labelledby="letter-guide" className="mt-14">
      <h2 id="letter-guide" className="text-2xl font-bold tracking-tight">
        Letter guide
      </h2>
      <p className="mt-1 max-w-2xl text-muted">
        The app reads these {supported.length} letters. The one it sees right now is highlighted.
      </p>

      <ul className="mt-5 grid grid-cols-3 gap-2.5 sm:grid-cols-4 sm:gap-3 lg:grid-cols-6">
        {supported.map((item) => (
          <LetterTile key={item.letter} item={item} active={item.letter === current} />
        ))}
      </ul>

      <p className="mt-4 max-w-2xl text-sm text-muted">
        J and Z are drawn in the air, so a second model watches the movement: draw the letter, then hold still.
      </p>
    </section>
  );
}

function LetterTile({ item, active }: { item: AlphabetLetter; active: boolean }) {
  return (
    <li
      className={`rounded-xl border p-3 transition-colors ${
        active ? 'border-accent bg-accent-soft' : 'border-line bg-surface'
      }`}
    >
      <div className="flex items-center gap-2 sm:gap-3">
        {/* Plain <img>: the drawings come straight from Wikimedia, no resizing needed. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={item.image}
          alt={`Handshape for ${item.letter}`}
          loading="lazy"
          className="h-12 w-10 shrink-0 object-contain sm:h-14 sm:w-12 dark:invert"
        />
        <span className="text-3xl font-bold">{item.letter}</span>
      </div>
      <p className="mt-2 hidden text-xs leading-snug text-muted sm:block">{item.how}</p>
    </li>
  );
}
