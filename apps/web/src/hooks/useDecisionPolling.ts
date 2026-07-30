import { useEffect, useRef, useState } from 'react';
import type { DecisionStatusResource } from '@lds/shared';
import { fetchDecisionStatus } from '../lib/api';

/**
 * Polls a decision until it settles.
 *
 * Polling rather than websockets: a decision resolves in seconds and the
 * client already holds the application id, so a socket would add a connection
 * to maintain and a reconnection path to get wrong for no gain at this scale.
 * The API contract is deliberately unchanged if this is later swapped for a
 * webhook — `GET .../decision` stays the source of truth either way.
 */

const POLL_INTERVAL_MS = 1_000;
/**
 * Stop after 45s. Long enough to absorb a cold start on a free-tier host,
 * short enough that a genuinely stuck job surfaces as an error the user can
 * act on rather than an indefinite spinner.
 */
const POLL_TIMEOUT_MS = 45_000;

interface PollingState {
  status: DecisionStatusResource | null;
  error: string | null;
  isPolling: boolean;
}

export function useDecisionPolling(
  applicationId: string | null,
  initialStatus: DecisionStatusResource | null,
): PollingState {
  const [status, setStatus] = useState<DecisionStatusResource | null>(initialStatus);
  const [error, setError] = useState<string | null>(null);
  const [isPolling, setIsPolling] = useState(false);

  // Held in a ref so the effect below does not re-run (and restart the poll)
  // every time the status object changes identity.
  const settledRef = useRef(false);

  useEffect(() => {
    setStatus(initialStatus);
    setError(null);
    settledRef.current =
      initialStatus?.status === 'DECIDED' || initialStatus?.status === 'FAILED';
  }, [applicationId, initialStatus]);

  useEffect(() => {
    if (!applicationId || settledRef.current) {
      setIsPolling(false);
      return;
    }

    let cancelled = false;
    const startedAt = Date.now();
    setIsPolling(true);

    const timer = setInterval(() => {
      void (async () => {
        if (cancelled) return;

        if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
          clearInterval(timer);
          setIsPolling(false);
          setError(
            'The decision is taking longer than expected. Your application has been saved — please check back shortly.',
          );
          return;
        }

        try {
          const next = await fetchDecisionStatus(applicationId);
          if (cancelled) return;

          setStatus(next);

          if (next.status === 'DECIDED' || next.status === 'FAILED') {
            settledRef.current = true;
            clearInterval(timer);
            setIsPolling(false);
          }
        } catch (pollError) {
          // A single failed poll is not fatal — the next tick retries. Only a
          // sustained failure reaches the user, via the timeout above.
          if (!cancelled) {
            // eslint-disable-next-line no-console
            console.warn('Poll failed, will retry', pollError);
          }
        }
      })();
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [applicationId]);

  return { status, error, isPolling };
}
