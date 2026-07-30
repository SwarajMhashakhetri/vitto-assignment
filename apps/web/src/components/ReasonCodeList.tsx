import type { DecisionReason, ReasonSeverity } from '@lds/shared';

const SEVERITY_LABEL: Record<ReasonSeverity, string> = {
  CRITICAL: 'Blocker',
  WARNING: 'Concern',
  INFO: 'Note',
  POSITIVE: 'In your favour',
};

const SEVERITY_ICON: Record<ReasonSeverity, string> = {
  CRITICAL: '✕',
  WARNING: '!',
  INFO: 'i',
  POSITIVE: '✓',
};

/**
 * The reasons behind a decision.
 *
 * Every decision shows these, approvals included. A borrower who was approved
 * despite a concern should see the concern, and one who was declined is owed
 * the specifics rather than a bare "rejected" — which is also what a lender
 * needs on file if the decision is ever questioned.
 *
 * The reason codes are shown alongside the prose deliberately: they are the
 * contract an integrating system keys off, so making them visible here
 * documents the API for anyone reading the UI.
 */
export function ReasonCodeList({ reasons }: { reasons: DecisionReason[] }) {
  if (reasons.length === 0) return null;

  return (
    <ul className="reasons">
      {reasons.map((reason) => (
        <li key={reason.code} className={`reason reason--${reason.severity.toLowerCase()}`}>
          <span className="reason__icon" aria-hidden="true">
            {SEVERITY_ICON[reason.severity]}
          </span>

          <div className="reason__body">
            <div className="reason__head">
              <code className="reason__code">{reason.code}</code>
              <span className="reason__severity">{SEVERITY_LABEL[reason.severity]}</span>
              {reason.pointsImpact !== 0 && (
                <span
                  className={`reason__impact reason__impact--${
                    reason.pointsImpact > 0 ? 'positive' : 'negative'
                  }`}
                  title="Contribution to the credit score"
                >
                  {reason.pointsImpact > 0 ? '+' : ''}
                  {reason.pointsImpact}
                </span>
              )}
            </div>
            <p className="reason__message">{reason.message}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}
