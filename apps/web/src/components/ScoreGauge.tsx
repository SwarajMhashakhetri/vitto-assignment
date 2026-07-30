interface ScoreGaugeProps {
  score: number;
  min: number;
  max: number;
  threshold: number;
  approved: boolean;
}

/**
 * The credit score on its 300–900 scale, with the approval threshold marked.
 *
 * Showing the threshold is the point: a bare number tells an applicant nothing
 * about how close they came, whereas a marked cutoff turns "rejected" into
 * "rejected, and by roughly this much" — which is what makes the reason codes
 * below it actionable.
 */
export function ScoreGauge({ score, min, max, threshold, approved }: ScoreGaugeProps) {
  const toPercent = (value: number) => ((value - min) / (max - min)) * 100;

  const scorePercent = toPercent(score);
  const thresholdPercent = toPercent(threshold);

  return (
    <div className="gauge">
      <div className="gauge__header">
        <span className="gauge__label">Credit score</span>
        <span className={`gauge__score gauge__score--${approved ? 'approved' : 'rejected'}`}>
          {score}
        </span>
      </div>

      <div
        className="gauge__track"
        role="meter"
        aria-valuenow={score}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-label={`Credit score ${score} out of ${max}. Approval requires ${threshold}.`}
      >
        <div
          className={`gauge__fill gauge__fill--${approved ? 'approved' : 'rejected'}`}
          style={{ width: `${scorePercent}%` }}
        />
        <div className="gauge__threshold" style={{ left: `${thresholdPercent}%` }}>
          <span className="gauge__threshold-flag">Approval&nbsp;{threshold}</span>
        </div>
      </div>

      <div className="gauge__scale">
        <span>{min}</span>
        <span>{max}</span>
      </div>
    </div>
  );
}
