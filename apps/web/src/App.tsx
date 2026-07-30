import { useCallback, useState } from 'react';
import type { DecisionStatusResource, LoanIntakeFormInput } from '@lds/shared';
import { ApplicationForm } from './components/ApplicationForm';
import { DecisionResult } from './components/DecisionResult';
import { ProcessingView } from './components/ProcessingView';
import { useDecisionPolling } from './hooks/useDecisionPolling';
import { ApiRequestError, NetworkError, submitApplication } from './lib/api';

/**
 * Single page, three states: form, processing, result.
 *
 * No router — there is one flow and one screen, and adding routing would mean
 * inventing URLs for states a user cannot meaningfully bookmark or refresh
 * into.
 */

interface SubmittedApplication {
  id: string;
  requestedAmount: number;
  tenureMonths: number;
  initialStatus: DecisionStatusResource;
}

export function App() {
  const [submitted, setSubmitted] = useState<SubmittedApplication | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);

  const { status, error: pollError } = useDecisionPolling(
    submitted?.id ?? null,
    submitted?.initialStatus ?? null,
  );

  const handleSubmit = useCallback(async (values: LoanIntakeFormInput) => {
    setIsSubmitting(true);
    setServerErrors({});
    setSubmitError(null);

    try {
      const result = await submitApplication(values);
      setSubmitted({
        id: result.applicationId,
        requestedAmount: values.requestedAmount,
        tenureMonths: values.tenureMonths,
        initialStatus: result.status,
      });
    } catch (error) {
      handleSubmitFailure(error, setServerErrors, setSubmitError);
    } finally {
      setIsSubmitting(false);
    }
  }, []);

  const handleStartOver = useCallback(() => {
    setSubmitted(null);
    setServerErrors({});
    setSubmitError(null);
  }, []);

  return (
    <div className="page">
      <header className="masthead">
        <p className="masthead__eyebrow">MSME Credit</p>
        <h1 className="masthead__title">Business loan application</h1>
        <p className="masthead__subtitle">
          Tell us about your business and what you need. You will get a decision, a credit score,
          and the reasons behind both.
        </p>
      </header>

      <main className="card">
        {!submitted && (
          <ApplicationForm
            onSubmit={(values) => void handleSubmit(values)}
            isSubmitting={isSubmitting}
            serverErrors={serverErrors}
            submitError={submitError}
          />
        )}

        {submitted && status?.status === 'DECIDED' && status.decision && (
          <DecisionResult
            decision={status.decision}
            requestedAmount={submitted.requestedAmount}
            tenureMonths={submitted.tenureMonths}
            onStartOver={handleStartOver}
          />
        )}

        {submitted && status?.status === 'FAILED' && (
          <FailureView
            message={
              status.failureReason ??
              'Something went wrong while assessing your application. Please try again.'
            }
            onRetry={handleStartOver}
          />
        )}

        {submitted && pollError && status?.status !== 'DECIDED' && (
          <FailureView message={pollError} onRetry={handleStartOver} />
        )}

        {submitted &&
          !pollError &&
          (status?.status === 'QUEUED' || status?.status === 'PROCESSING') && (
            <ProcessingView status={status.status} />
          )}
      </main>

      <footer className="page__footer">
        <p>
          Indicative assessment only. Figures assume an 18% p.a. reducing-balance rate and do not
          constitute an offer of credit.
        </p>
      </footer>
    </div>
  );
}

function FailureView({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <section className="failure" role="alert">
      <h2 className="failure__title">We could not complete the assessment</h2>
      <p className="failure__message">{message}</p>
      <button type="button" className="button button--secondary" onClick={onRetry}>
        Try again
      </button>
    </section>
  );
}

/**
 * Maps a failed submission onto the form.
 *
 * A 422 carries per-field messages, which belong next to the offending inputs
 * rather than in a banner the user has to map back to a field themselves.
 * Anything else is a single message at the foot of the form.
 */
function handleSubmitFailure(
  error: unknown,
  setServerErrors: (errors: Record<string, string>) => void,
  setSubmitError: (message: string) => void,
): void {
  if (error instanceof ApiRequestError) {
    if (error.details.length > 0) {
      const byField: Record<string, string> = {};
      for (const detail of error.details) {
        // Keep the first message per field; they arrive most-specific first.
        byField[detail.field] ??= detail.message;
      }
      setServerErrors(byField);
      setSubmitError('Please correct the highlighted fields.');
      return;
    }

    setSubmitError(error.message);
    return;
  }

  if (error instanceof NetworkError) {
    setSubmitError(error.message);
    return;
  }

  setSubmitError('Something went wrong. Please try again.');
}
