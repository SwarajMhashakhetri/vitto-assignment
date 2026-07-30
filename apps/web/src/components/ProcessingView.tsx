import type { ApplicationStatus } from '@lds/shared';

/**
 * Shown between the 202 and the settled decision.
 *
 * It reports the job's real status rather than an undifferentiated spinner,
 * which is the visible payoff of processing decisions asynchronously: the user
 * can see their application is queued rather than lost.
 */

const STEPS: { status: ApplicationStatus; label: string; description: string }[] = [
  { status: 'QUEUED', label: 'Queued', description: 'Your application is in line for assessment.' },
  {
    status: 'PROCESSING',
    label: 'Assessing',
    description: 'Checking affordability, exposure and consistency.',
  },
  { status: 'DECIDED', label: 'Decision ready', description: 'Preparing your result.' },
];

export function ProcessingView({ status }: { status: ApplicationStatus }) {
  const activeIndex = Math.max(
    0,
    STEPS.findIndex((step) => step.status === status),
  );

  return (
    <section className="processing" aria-live="polite" aria-busy="true">
      <div className="processing__spinner" aria-hidden="true" />
      <h2 className="processing__title">Assessing your application</h2>
      <p className="processing__subtitle">This usually takes a few seconds.</p>

      <ol className="steps">
        {STEPS.map((step, index) => (
          <li
            key={step.status}
            className={`step ${index < activeIndex ? 'step--done' : ''} ${
              index === activeIndex ? 'step--active' : ''
            }`}
          >
            <span className="step__marker" aria-hidden="true">
              {index < activeIndex ? '✓' : index + 1}
            </span>
            <div>
              <p className="step__label">{step.label}</p>
              <p className="step__description">{step.description}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
