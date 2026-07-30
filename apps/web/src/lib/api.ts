import type {
  ApiError,
  ApiFieldError,
  ApiSuccess,
  ApplicationResource,
  BusinessResource,
  CreateBusinessInput,
  DecisionStatusResource,
  LoanIntakeFormInput,
} from '@lds/shared';

/**
 * API client.
 *
 * Owns the multi-step intake sequence so the form component stays declarative:
 * create the business profile, create the application against it, then trigger
 * the decision. Those are three resources in the API because they are three
 * things; collapsing them into one endpoint would have made the REST design
 * worse to make one component simpler.
 */

const BASE_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:4000';

/** A failed request, carrying the server's field errors for the form to show. */
export class ApiRequestError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: ApiFieldError[];
  readonly requestId: string | null;
  readonly conflict?: Record<string, unknown>;

  constructor(status: number, body: ApiError['error']) {
    super(body.message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = body.code;
    this.details = body.details ?? [];
    this.requestId = body.requestId ?? null;
    this.conflict = body.conflict;
  }
}

/** A network failure or an unreachable server, as distinct from a rejection. */
export class NetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NetworkError';
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;

  try {
    response = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...init.headers,
      },
    });
  } catch {
    // fetch only rejects on a transport failure, never on a 4xx/5xx.
    throw new NetworkError(
      'Could not reach the lending service. Check your connection and try again.',
    );
  }

  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      throw new NetworkError('The server returned a response that could not be read.');
    }
  }

  if (!response.ok) {
    const errorBody = (body as ApiError | null)?.error;
    if (errorBody) {
      throw new ApiRequestError(response.status, errorBody);
    }
    throw new NetworkError(`Request failed with status ${response.status}`);
  }

  return (body as ApiSuccess<T>).data;
}

/* -------------------------------------------------------------------------- */
/* Resource calls                                                             */
/* -------------------------------------------------------------------------- */

const createBusiness = (input: CreateBusinessInput) =>
  request<BusinessResource>('/api/v1/businesses', {
    method: 'POST',
    body: JSON.stringify(input),
  });

const updateBusiness = (id: string, input: CreateBusinessInput) =>
  request<BusinessResource>(`/api/v1/businesses/${id}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });

const createApplication = (input: {
  businessId: string;
  requestedAmount: number;
  tenureMonths: number;
  purpose: string;
}) =>
  request<ApplicationResource>('/api/v1/applications', {
    method: 'POST',
    body: JSON.stringify(input),
  });

const triggerDecision = (applicationId: string) =>
  request<DecisionStatusResource>(`/api/v1/applications/${applicationId}/decision`, {
    method: 'POST',
  });

export const fetchDecisionStatus = (applicationId: string) =>
  request<DecisionStatusResource>(`/api/v1/applications/${applicationId}/decision`);

/* -------------------------------------------------------------------------- */
/* Intake orchestration                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Creates the business profile, or updates it if one already exists for this
 * PAN.
 *
 * PAN identifies the borrower, so a repeat applicant is expected. The server
 * answers a duplicate with 409 and the existing id rather than silently
 * overwriting; the client then updates that profile, which matters because the
 * decision must be scored against the revenue submitted *now*, not a figure
 * left over from a previous application.
 */
async function upsertBusiness(input: CreateBusinessInput): Promise<BusinessResource> {
  try {
    return await createBusiness(input);
  } catch (error) {
    const existingId =
      error instanceof ApiRequestError && error.status === 409
        ? (error.conflict?.businessId as string | undefined)
        : undefined;

    if (!existingId) throw error;

    return updateBusiness(existingId, input);
  }
}

export interface SubmitResult {
  applicationId: string;
  /** Already settled when the server had a decision on file, or ran inline. */
  status: DecisionStatusResource;
}

/**
 * Runs the full intake and asks for a decision. Returns as soon as the request
 * is accepted — the caller polls from there.
 */
export async function submitApplication(values: LoanIntakeFormInput): Promise<SubmitResult> {
  const business = await upsertBusiness({
    ownerName: values.ownerName,
    pan: values.pan,
    businessType: values.businessType,
    monthlyRevenue: values.monthlyRevenue,
  });

  const application = await createApplication({
    businessId: business.id,
    requestedAmount: values.requestedAmount,
    tenureMonths: values.tenureMonths,
    purpose: values.purpose,
  });

  const status = await triggerDecision(application.id);

  return { applicationId: application.id, status };
}
