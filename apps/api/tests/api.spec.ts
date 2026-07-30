import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import { createApp } from '../src/app';
import { disconnectDb } from '../src/db/client';
import { resetDatabase, uniquePan, validApplication, validBusiness } from './helpers/test-db';

/**
 * API integration tests.
 *
 * Run against the real Postgres from docker-compose — `docker compose up -d
 * postgres` is a prerequisite. Mocking the database here would defeat the
 * purpose: the failures these tests exist to catch are unique constraints,
 * cascades and NUMERIC round trips, none of which a mock reproduces.
 *
 * The organising principle is the distinction the README calls out: malformed
 * input is a 4xx, an unaffordable loan is a 200 with a REJECTED decision.
 */

let app: Express;

beforeAll(() => {
  app = createApp();
});

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await disconnectDb();
});

/** Creates a business and returns its id. */
async function createBusiness(overrides: Record<string, unknown> = {}): Promise<string> {
  const response = await request(app).post('/api/v1/businesses').send(validBusiness(overrides));
  expect(response.status).toBe(201);
  return response.body.data.id as string;
}

/** Runs a full intake and returns the settled decision payload. */
async function decideOn(
  businessOverrides: Record<string, unknown>,
  applicationOverrides: Record<string, unknown>,
) {
  const businessId = await createBusiness(businessOverrides);

  const application = await request(app)
    .post('/api/v1/applications')
    .send(validApplication(businessId, applicationOverrides));
  expect(application.status).toBe(201);

  const applicationId = application.body.data.id as string;
  const decision = await request(app).post(`/api/v1/applications/${applicationId}/decision`);

  return { applicationId, response: decision };
}

/* -------------------------------------------------------------------------- */

describe('response envelope', () => {
  it('wraps every success in { data, meta } with a request id', async () => {
    const response = await request(app).post('/api/v1/businesses').send(validBusiness());

    expect(response.status).toBe(201);
    expect(response.body).toHaveProperty('data');
    expect(response.body.meta.requestId).toEqual(expect.any(String));
  });

  it('wraps every error in { error: { code, message, details, requestId } }', async () => {
    const response = await request(app).post('/api/v1/businesses').send({});

    expect(response.status).toBe(422);
    expect(response.body.error).toMatchObject({
      code: 'VALIDATION_ERROR',
      message: expect.any(String),
      details: expect.any(Array),
      requestId: expect.any(String),
    });
  });

  it('echoes an inbound X-Request-Id so a caller can correlate its own logs', async () => {
    const response = await request(app)
      .get('/api/v1/businesses/00000000-0000-4000-8000-000000000000')
      .set('X-Request-Id', 'trace-me-123');

    expect(response.headers['x-request-id']).toBe('trace-me-123');
    expect(response.body.error.requestId).toBe('trace-me-123');
  });
});

describe('POST /businesses — validation', () => {
  it('reports every missing field at once rather than one at a time', async () => {
    const response = await request(app).post('/api/v1/businesses').send({});

    expect(response.status).toBe(422);
    const fields = response.body.error.details.map((d: { field: string }) => d.field);
    expect(fields).toEqual(
      expect.arrayContaining(['ownerName', 'pan', 'businessType', 'monthlyRevenue']),
    );
  });

  it.each([
    { label: 'malformed PAN', pan: 'NOTAPAN', expectedField: 'pan' },
    { label: 'PAN too short', pan: 'ABCPS123F', expectedField: 'pan' },
    { label: 'lowercase PAN is normalised, not rejected', pan: 'abcps1234f', expectedField: null },
    { label: 'invalid holder-type character', pan: 'ABCXS1234F', expectedField: 'pan' },
  ])('$label', async ({ pan, expectedField }) => {
    const response = await request(app).post('/api/v1/businesses').send(validBusiness({ pan }));

    if (expectedField === null) {
      expect(response.status).toBe(201);
      // Normalisation happens once, in the schema, so storage is canonical.
      expect(response.body.data.pan).toBe('ABCPS1234F');
      return;
    }

    expect(response.status).toBe(422);
    expect(response.body.error.details[0].field).toBe(expectedField);
  });

  it.each([
    { label: 'negative revenue', monthlyRevenue: -5_000 },
    { label: 'zero revenue', monthlyRevenue: 0 },
    { label: 'non-numeric revenue', monthlyRevenue: 'abc' },
    { label: 'comma-formatted revenue', monthlyRevenue: '50,000' },
    { label: 'revenue above the ceiling', monthlyRevenue: 99_999_999_999 },
    { label: 'null revenue', monthlyRevenue: null },
  ])('rejects $label with a 422', async ({ monthlyRevenue }) => {
    const response = await request(app)
      .post('/api/v1/businesses')
      .send(validBusiness({ monthlyRevenue }));

    expect(response.status).toBe(422);
    expect(response.body.error.details[0].field).toBe('monthlyRevenue');
  });

  it('gives exactly one message per field rather than a cascade', async () => {
    const response = await request(app)
      .post('/api/v1/businesses')
      .send(validBusiness({ monthlyRevenue: 'abc' }));

    const revenueErrors = response.body.error.details.filter(
      (d: { field: string }) => d.field === 'monthlyRevenue',
    );
    expect(revenueErrors).toHaveLength(1);
  });

  it('accepts a numeric string, since HTML forms submit strings', async () => {
    const response = await request(app)
      .post('/api/v1/businesses')
      .send(validBusiness({ monthlyRevenue: '800000' }));

    expect(response.status).toBe(201);
    expect(response.body.data.monthlyRevenue).toBe(800_000);
  });

  it('rejects an unknown business type and lists the permitted values', async () => {
    const response = await request(app)
      .post('/api/v1/businesses')
      .send(validBusiness({ businessType: 'AGRICULTURE' }));

    expect(response.status).toBe(422);
    expect(response.body.error.details[0].message).toContain('RETAIL');
  });

  it('returns 400, not 500, for a malformed JSON body', async () => {
    const response = await request(app)
      .post('/api/v1/businesses')
      .set('Content-Type', 'application/json')
      .send('{"broken":');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('MALFORMED_JSON');
  });
});

describe('POST /businesses — duplicate PAN', () => {
  it('returns 409 with the existing id so the client can recover', async () => {
    const pan = uniquePan('S');
    const first = await request(app).post('/api/v1/businesses').send(validBusiness({ pan }));
    expect(first.status).toBe(201);

    const second = await request(app).post('/api/v1/businesses').send(validBusiness({ pan }));

    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('CONFLICT');
    expect(second.body.error.conflict.businessId).toBe(first.body.data.id);
  });

  it('lets the client update that profile, so a stale revenue is not scored', async () => {
    const pan = uniquePan('S');
    const created = await request(app)
      .post('/api/v1/businesses')
      .send(validBusiness({ pan, monthlyRevenue: 500_000 }));

    const updated = await request(app)
      .put(`/api/v1/businesses/${created.body.data.id}`)
      .send(validBusiness({ pan, monthlyRevenue: 900_000 }));

    expect(updated.status).toBe(200);
    expect(updated.body.data.monthlyRevenue).toBe(900_000);
    expect(updated.body.data.id).toBe(created.body.data.id);
  });
});

describe('GET /businesses/:id', () => {
  it('returns 404 for an unknown id', async () => {
    const response = await request(app).get(
      '/api/v1/businesses/00000000-0000-4000-8000-000000000000',
    );
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 422 for a malformed id rather than treating it as missing', async () => {
    const response = await request(app).get('/api/v1/businesses/not-a-uuid');
    expect(response.status).toBe(422);
  });
});

describe('POST /applications', () => {
  it('creates an application in QUEUED status without evaluating it', async () => {
    const businessId = await createBusiness();
    const response = await request(app)
      .post('/api/v1/applications')
      .send(validApplication(businessId));

    expect(response.status).toBe(201);
    expect(response.body.data.status).toBe('QUEUED');
  });

  it('returns 404 when the business does not exist', async () => {
    const response = await request(app)
      .post('/api/v1/applications')
      .send(validApplication('00000000-0000-4000-8000-000000000000'));

    expect(response.status).toBe(404);
  });

  it.each([
    { label: 'fractional tenure', tenureMonths: 12.5 },
    { label: 'zero tenure', tenureMonths: 0 },
    { label: 'negative tenure', tenureMonths: -6 },
    { label: 'tenure beyond the 84-month ceiling', tenureMonths: 120 },
  ])('rejects $label with a 422', async ({ tenureMonths }) => {
    const businessId = await createBusiness();
    const response = await request(app)
      .post('/api/v1/applications')
      .send(validApplication(businessId, { tenureMonths }));

    expect(response.status).toBe(422);
    expect(response.body.error.details[0].field).toBe('tenureMonths');
  });

  it.each([
    { label: 'Infinity', requestedAmount: 'Infinity' },
    { label: 'NaN', requestedAmount: 'NaN' },
    { label: 'below the minimum loan size', requestedAmount: 500 },
  ])('rejects $label with a 422', async ({ requestedAmount }) => {
    const businessId = await createBusiness();
    const response = await request(app)
      .post('/api/v1/applications')
      .send(validApplication(businessId, { requestedAmount }));

    expect(response.status).toBe(422);
  });

  it('preserves money exactly through the NUMERIC round trip', async () => {
    const businessId = await createBusiness();
    const response = await request(app)
      .post('/api/v1/applications')
      .send(validApplication(businessId, { requestedAmount: 1_234_567.89 }));

    expect(response.body.data.requestedAmount).toBe(1_234_567.89);
  });
});

describe('POST /applications/:id/decision', () => {
  it('accepts the request with 202 and a poll URL', async () => {
    const { applicationId, response } = await decideOn({}, {});

    expect(response.status).toBe(202);
    expect(response.body.data.pollUrl).toBe(`/api/v1/applications/${applicationId}/decision`);
  });

  it('is idempotent — a retry returns the stored decision with 200', async () => {
    const { applicationId, response: first } = await decideOn({}, {});
    expect(first.status).toBe(202);

    const settled = await request(app).get(`/api/v1/applications/${applicationId}/decision`);
    const originalDecisionId = settled.body.data.decision.id;

    const retry = await request(app).post(`/api/v1/applications/${applicationId}/decision`);

    expect(retry.status).toBe(200);
    expect(retry.body.data.decision.id).toBe(originalDecisionId);
  });

  it('returns 404 for an unknown application', async () => {
    const response = await request(app).post(
      '/api/v1/applications/00000000-0000-4000-8000-000000000000/decision',
    );
    expect(response.status).toBe(404);
  });
});

describe('GET /applications/:id/decision — the poll target', () => {
  it('uses one envelope in every state so the client does not branch on status', async () => {
    const { applicationId } = await decideOn({}, {});
    const response = await request(app).get(`/api/v1/applications/${applicationId}/decision`);

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      applicationId,
      status: expect.any(String),
      decision: expect.any(Object),
      failureReason: null,
    });
  });

  it('persists the reason codes alongside the decision', async () => {
    const { applicationId } = await decideOn({}, {});
    const response = await request(app).get(`/api/v1/applications/${applicationId}/decision`);

    const reasons = response.body.data.decision.reasons;
    expect(reasons.length).toBeGreaterThan(0);
    expect(reasons[0]).toMatchObject({
      code: expect.any(String),
      severity: expect.any(String),
      message: expect.any(String),
      pointsImpact: expect.any(Number),
    });
  });
});

/* -------------------------------------------------------------------------- */
/* The distinction the whole design turns on                                  */
/* -------------------------------------------------------------------------- */

describe('credit rejections are decisions, not validation errors', () => {
  it('returns 200 REJECTED with DATA_INCONSISTENCY for ₹10L revenue against ₹5Cr', async () => {
    const { applicationId, response } = await decideOn(
      { monthlyRevenue: 1_000_000 },
      { requestedAmount: 50_000_000, tenureMonths: 36 },
    );

    // The decisive assertion: the payload is schema-valid, so this is NOT a 4xx.
    expect(response.status).toBe(202);

    const settled = await request(app).get(`/api/v1/applications/${applicationId}/decision`);
    expect(settled.status).toBe(200);
    expect(settled.body.data.decision.outcome).toBe('REJECTED');
    expect(settled.body.data.decision.creditScore).toBe(300);

    const codes = settled.body.data.decision.reasons.map((r: { code: string }) => r.code);
    expect(codes).toContain('DATA_INCONSISTENCY');
  });

  it('approves a healthy application', async () => {
    const { applicationId } = await decideOn(
      { monthlyRevenue: 800_000, businessType: 'SERVICES' },
      { requestedAmount: 1_000_000, tenureMonths: 24 },
    );

    const settled = await request(app).get(`/api/v1/applications/${applicationId}/decision`);
    expect(settled.body.data.decision.outcome).toBe('APPROVED');
    expect(settled.body.data.decision.creditScore).toBeGreaterThanOrEqual(650);
  });

  it('declines an over-leveraged application on affordability', async () => {
    const { applicationId } = await decideOn(
      { monthlyRevenue: 100_000, businessType: 'RETAIL' },
      { requestedAmount: 500_000, tenureMonths: 12 },
    );

    const settled = await request(app).get(`/api/v1/applications/${applicationId}/decision`);
    const codes = settled.body.data.decision.reasons.map((r: { code: string }) => r.code);

    expect(settled.body.data.decision.outcome).toBe('REJECTED');
    expect(codes).toContain('HIGH_EMI_BURDEN');
  });

  it('stamps the engine version so a stored decision stays interpretable', async () => {
    const { applicationId } = await decideOn({}, {});
    const settled = await request(app).get(`/api/v1/applications/${applicationId}/decision`);
    expect(settled.body.data.decision.engineVersion).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe('health checks', () => {
  it('reports liveness without touching a dependency', async () => {
    const response = await request(app).get('/healthz');
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
  });

  it('reports readiness with per-dependency detail', async () => {
    const response = await request(app).get('/readyz');
    expect(response.body.dependencies).toHaveProperty('postgres');
  });
});

describe('unmatched routes', () => {
  it('uses the standard error envelope for a 404', async () => {
    const response = await request(app).get('/api/v1/does-not-exist');
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });
});
