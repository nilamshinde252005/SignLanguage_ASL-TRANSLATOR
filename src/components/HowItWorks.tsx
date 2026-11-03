const NOTEBOOK_URL =
  'https://github.com/nilamshinde252005/SignLanguage_ASL-TRANSLATOR/blob/main/training/train_letters.ipynb';

const STEPS = [
  {
    title: 'Find the hand',
    body: 'MediaPipe, a free tool from Google, finds 21 points on your hand in every camera frame.',
  },
  {
    title: 'Measure the shape',
    body: "The points are centred on your wrist, scaled to the size of your palm and mirrored if you're using your other hand. Then 45 distances between fingertips and knuckles are added: 108 numbers that describe the shape, wherever your hand is.",
  },
  {
    title: 'Read it',
    body: 'For letters, a small neural network I trained on 3,600 recorded hand shapes picks one of 24 letters. On a recording session it never studied, it gets 93% right. J and Z are drawn in the air, so a second model I trained reads the whole move. For signs, the whole movement goes to an open-source model that knows 250 words.',
  },
];

/** Short explanation of the pipeline, for visitors and recruiters. */
export default function HowItWorks() {
  return (
    <section aria-labelledby="how-it-works" className="mt-16 border-t border-line pt-10">
      <h2 id="how-it-works" className="text-2xl font-bold tracking-tight">
        How it works
      </h2>

      <ol className="mt-6 grid gap-8 md:grid-cols-3">
        {STEPS.map((step, i) => (
          <li key={step.title}>
            <span
              aria-hidden="true"
              className="grid h-9 w-9 place-items-center rounded-full bg-accent-soft font-bold text-accent"
            >
              {i + 1}
            </span>
            <h3 className="mt-3 text-lg font-bold">{step.title}</h3>
            <p className="mt-1 leading-relaxed text-muted">{step.body}</p>
          </li>
        ))}
      </ol>

      <p className="mt-8 max-w-2xl text-muted">
        Everything runs in your browser, so your video never leaves your device.{' '}
        <a href={NOTEBOOK_URL} className="font-semibold text-accent underline-offset-2 hover:underline">
          See how I trained the letter model
        </a>
        .
      </p>
    </section>
  );
}
