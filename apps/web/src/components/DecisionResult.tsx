import type { DecisionResource } from '@lds/shared';
import { formatInr, formatMonths } from '../lib/format';
import { ReasonCodeList } from './ReasonCodeList';
import { ScoreGauge } from './ScoreGauge';

/** Mirrors the engine's published scale. See apps/api/src/config/scoring.ts. */
const SCORE_MIN = 300;
const SCORE_MAX = 900;
const APPROVAL_THRESHOLD = 650;

interface DecisionResultProps {
  decision: DecisionResource;
  requestedAmount: number;
  tenureMonths: number;
  onStartOver: () => void;
}

export function DecisionResult({
  decision,
  requestedAmount,
  tenureMonths,
  onStartOver,
}: DecisionResultProps) {
  const approved = decision.outcome === 'APPROVED';

  return (
    <section className="result" aria-live="polite">
      <header className={`verdict verdict--${approved ? 'approved' : 'rejected'}`}>
        <span className="verdict__badge">{approved ? 'Approved' : 'Not approved'}</span>
        <h2 className="verdict__title">
          {approved
            ? `${formatInr(requestedAmount)} over ${formatMonths(tenureMonths)}`
            : 'We cannot offer this loan right now'}
        </h2>
        <p className="verdict__subtitle">
          {approved
            ? 'This application meets our lending criteria. The reasons below show what drove the score.'
            : 'The reasons below explain the decision. Addressing the blockers first will have the largest effect.'}
        </p>
      </header>

      <ScoreGauge
        score={decision.creditScore}
        min={SCORE_MIN}
        max={SCORE_MAX}
        threshold={APPROVAL_THRESHOLD}
        approved={approved}
      />

      <dl className="summary">
        <div className="summary__item">
          <dt>Estimated instalment</dt>
          <dd>{formatInr(decision.estimatedEmi)}/mo</dd>
        </div>
        <div className="summary__item">
          <dt>Requested</dt>
          <dd>{formatInr(requestedAmount)}</dd>
        </div>
        <div className="summary__item">
          <dt>Tenure</dt>
          <dd>{formatMonths(tenureMonths)}</dd>
        </div>
      </dl>

      <div className="result__reasons">
        <h3 className="section-heading">Reasons for this decision</h3>
        <ReasonCodeList reasons={decision.reasons} />
      </div>

      <footer className="result__footer">
        <button type="button" className="button button--secondary" onClick={onStartOver}>
          Start a new application
        </button>
        {/* Surfaced so a decision can be traced to its stored record, and so
            the scorecard version behind it is never ambiguous. */}
        <p className="result__meta">
          Decision <code>{decision.id.slice(0, 8)}</code> · engine v{decision.engineVersion} ·{' '}
          {new Date(decision.evaluatedAt).toLocaleString('en-IN')}
        </p>
      </footer>
    </section>
  );
}
