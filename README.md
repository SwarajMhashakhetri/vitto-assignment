# MSME Lending Decision System

An end-to-end lending decision system for Indian MSMEs. It accepts a business profile and a loan request, runs them through a documented credit scorecard, and returns a binary decision with a credit score and the reason codes behind it.

**Live demo** — frontend: _(see Deployment)_ · API: _(see Deployment)_

---

## Contents

- [What it does](#what-it-does)
- [Quick start](#quick-start)
- [Architecture](#architecture)
- [The decision engine](#the-decision-engine)
- [Reference scenarios](#reference-scenarios)
- [API reference](#api-reference)
- [Edge case strategy](#edge-case-strategy)
- [Testing](#testing)
- [Assumptions and known limitations](#assumptions-and-known-limitations)
- [Deployment](#deployment)

---

## What it does

1. An applicant submits their business profile (owner, PAN, sector, monthly revenue) and loan request (amount, tenure, purpose) on a single page.
2. The API validates the input, stores it, and queues the application for evaluation, returning `202 Accepted` immediately.
3. A background worker runs the credit engine and persists the decision.
4. The client polls until the decision settles, then shows the outcome, the credit score against its approval threshold, and every reason code that contributed.

---

## Quick start

### With Docker (recommended)

Requires Docker with Compose v2. Nothing else — no local Node, Postgres, Mongo or Redis.

```bash
git clone <repo-url>
cd lending-decision-system
docker compose up --build
```

That brings up Postgres, MongoDB, Redis, the API, the decision worker and the web client. Database migrations run automatically before the API binds its port.

| Service | URL |
| --- | --- |
| Web client | http://localhost:8080 |
| API | http://localhost:4000 |
| Liveness | http://localhost:4000/healthz |
| Readiness (per-dependency) | http://localhost:4000/readyz |

Verify the whole stack in one call:

```bash
curl -s localhost:4000/readyz
# {"status":"ready","dependencies":{"postgres":true,"redis":true,"mongo":true}}
```

### Without Docker

Requires Node 20+ and running Postgres, MongoDB and Redis instances.

```bash
npm install
cp .env.example .env          # then edit the connection strings
npm run db:migrate            # apply schema
npm run dev:api               # terminal 1 — API on :4000
npm run dev:worker            # terminal 2 — decision worker
npm run dev:web               # terminal 3 — Vite on :5173
```

> **Note on the Postgres port.** `docker-compose.yml` maps Postgres to host port **5433**, not the default 5432, so it does not collide with a Postgres you may already be running. `.env.example` matches.

> **Decision processing modes.** `DECISION_MODE` selects how decisions are executed. All three keep the identical public contract — `POST` returns `202`, the client polls until the status settles — so switching between them never changes what a client sees.
>
> | Mode | Behaviour | Used by |
> | --- | --- | --- |
> | `queue` | Enqueue to BullMQ; a **separate worker process** consumes it | docker-compose, paid hosting |
> | `embedded` | Enqueue to BullMQ; the worker runs **inside the API process** | Render free tier (no background workers on that plan) |
> | `inline` | No Redis — evaluate synchronously behind the same contract | Test suite, or running with only Postgres |
>
> `queue` is the right topology: the API and worker scale independently, and a slow evaluation cannot touch the API's event loop. `embedded` keeps the real queue with its retries and backoff and gives up only the process isolation.

### Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `4000` | API listen port |
| `DATABASE_URL` | — | Postgres connection string (required) |
| `MONGO_URL` | — | MongoDB connection string (required) |
| `REDIS_URL` | — | Redis connection string (required) |
| `CORS_ORIGIN` | `http://localhost:5173` | Comma-separated allowlist of browser origins, each with its scheme. Validated at boot; trailing slashes, whitespace and case are normalised before matching |
| `DECISION_MODE` | `queue` | `queue`, `embedded` or `inline` — see below |
| `NODE_VERSION` | — | Pinned to `22` on Render so a platform default cannot break the build |
| `DECISION_PROCESSING_DELAY_MS` | `1200` | Artificial worker delay so the polling flow is visible in a demo. Set `0` in production |
| `VITE_API_URL` | `http://localhost:4000` | API base URL, baked into the client bundle at build time |

Configuration is validated with Zod at boot. A missing or malformed variable exits the process with a message naming the offending key, rather than failing on the first request.

---

## Architecture

```
Browser (React SPA)
   │  POST /businesses → POST /applications → POST /applications/:id/decision → 202
   │  then polls GET /applications/:id/decision until the status settles
   ▼
Express API ──────────────────► Postgres    system of record
   │  requestId → CORS → JSON → validate(Zod) → route → errorHandler
   │
   └── BullMQ ──► Decision worker ──► engine (pure) ──► Postgres
                        │
                        └──────────► MongoDB    append-only audit trail
```

### Project layout

```
apps/api/src/
  config/      env.ts (Zod-validated at boot) · scoring.ts (every threshold)
  db/          client.ts · schema.ts · migrate.ts · mongo.ts
  engine/      index.ts · rules/hard-rules.ts · rules/factors.ts   ← pure, no I/O
  modules/     business/ · application/ · decision/ · health/
                 each: *.routes.ts → *.controller.ts → *.service.ts
  middleware/  request-id.ts · validate.ts · error-handler.ts
  lib/         errors.ts · logger.ts · audit.ts · respond.ts · serialize.ts
apps/web/src/  components/ · hooks/useDecisionPolling.ts · lib/api.ts
packages/shared/src/   schemas.ts · constants.ts · emi.ts · types.ts
```

The layering rule is that dependencies point inward: routes know about controllers, controllers know about services, services know about the database and the engine. The engine knows about nothing. That is what lets the worker reuse the same service functions the HTTP layer calls, with no Express in between.

### Why two databases

The brief specifies both, and each has a job that suits it:

**Postgres** holds the system of record. `business → application → decision → reasons` is a genuine relational chain with referential integrity, a status field that must transition atomically, and money that needs exact arithmetic. Reason codes live in a normalised child table rather than a JSONB column specifically so they stay queryable — *"how many declines cited `HIGH_EMI_BURDEN` this month?"* is a question a credit team actually asks.

**MongoDB** holds an append-only audit stream. Its documents vary in shape by event type (a validation failure and a completed decision share almost no fields), writes are frequent, and reads are only ever by application id or time range — never joined. That is a document store's shape.

Being straight about it: at this scale a single Postgres with a `JSONB` column would do the job with one fewer service to operate. The split is defensible on the shape of the data, but it is not yet load-bearing.

### Why decisions are asynchronous

Evaluation is fast today — the engine is pure arithmetic. It is modelled as a queued job because of what it becomes: a production engine calls a credit bureau, pulls GST filings and parses bank statements, any of which takes seconds and can fail and need retrying. Building the async boundary now means those can be added without changing a contract clients depend on.

The worker runs as its own process so a slow evaluation cannot consume the API's event loop, and so the two scale on their own curves.

---

## The decision engine

`evaluate(input)` is a **pure function** — no I/O, no database, no clock, no environment. Same input, same output, always. That makes the entire credit policy testable without infrastructure, and lets any historical decision be reproduced exactly from its stored inputs.

**Every threshold below lives in [`apps/api/src/config/scoring.ts`](apps/api/src/config/scoring.ts) and nowhere else.** If you disagree with a decision this system made, the disagreement is with a named constant on that page.

### Scale

Scores run **300–900**, deliberately mirroring the CIBIL range Indian borrowers and lenders already read fluently. Every application starts at a **base of 500**, factors move it, and the result is clamped to the range.

The base is 500 because the positive factors sum to at most +400, putting the theoretical maximum at exactly 900. A higher base would compress every strong application into a clamped 900 and throw away the engine's ability to distinguish a good file from an excellent one.

**Approval threshold: 650.**

### Stage 1 — Hard rules

Evaluated first. If any fires, the application is rejected at the floor score of 300 and the scorecard never runs.

These are policy floors, kept deliberately separate from the weighted factors. A scorecard expresses *how much worse does this make the file*; a hard rule expresses *this file is not lendable, full stop*. Mixing the two is how scorecards end up approving applications nobody intended to approve, because enough small positives outvoted one disqualifying fact.

| Rule | Condition | Reason code |
| --- | --- | --- |
| Loan grossly disproportionate | `amount > 36 × monthly revenue` | `DATA_INCONSISTENCY` |
| Instalment exceeds all income | `EMI ≥ monthly revenue` | `UNSERVICEABLE_EMI` |
| Below viable lending floor | `monthly revenue < ₹25,000` | `LOW_REVENUE` |

The 36× threshold is three years of *gross* revenue — not profit — borrowed at once. Past that, the likeliest explanation is a data-entry error or a fabricated figure, which is why the code says `DATA_INCONSISTENCY` rather than `HIGH_LOAN_RATIO`.

All matching rules are reported, not just the first, so an applicant sees every blocker at once rather than fixing one and discovering the next.

### Stage 2 — EMI estimation

Standard reducing-balance amortisation at a flat **18% p.a.** nominal rate, representative of unsecured MSME lending in India (typically 16–24%):

```
i = 0.18 / 12
EMI = P · i · (1 + i)^n / ((1 + i)^n − 1)
```

Reducing balance, not flat-rate interest — flat rate would understate the true cost by roughly a factor of two at these tenures.

### Stage 3 — Weighted factors

#### Factor 1 — EMI to revenue (affordability)

The heaviest-weighted signal, with the widest spread. Affordability is the best single predictor of repayment, and this factor can move a decision on its own.

| EMI ÷ revenue | Points |
| --- | --- |
| ≤ 10% | **+150** |
| 10–20% | +100 |
| 20–30% | +40 |
| 30–40% | −40 |
| 40–50% | −120 |
| > 50% | **−220** |

Bands are inclusive of their upper bound: exactly 30% scores +40, and 30.01% drops to −40. Attaches `STRONG_REVENUE_COVERAGE` at or below 10%, `HIGH_EMI_BURDEN` above 30%.

#### Factor 2 — Loan as a multiple of monthly revenue

Distinct from Factor 1: a long tenure can make a very large loan look affordable month-to-month while still representing an outsized exposure relative to the size of the business.

| Amount ÷ revenue | Points |
| --- | --- |
| ≤ 3× | +90 |
| 3–6× | +50 |
| 6–12× | 0 |
| 12–24× | −80 |
| > 24× | −200 |

#### Factor 3 — Tenure fit

Risk is **non-monotonic** in tenure, so this cannot be a gradient. Very short tenures concentrate repayment into few large instalments with no room to absorb a weak month. Very long tenures extend an *unsecured* exposure past the horizon over which any small business can be forecast — and past the point where the revenue figure on this application still means anything.

| Tenure | Points |
| --- | --- |
| 12–36 months | +60 (`HEALTHY_TENURE_FIT`) |
| 6–11 or 37–48 months | +10 |
| < 6 months | −60 (`SHORT_TENURE_RISK`) |
| > 48 months | −70 (`LONG_TENURE_RISK`) |

#### Factor 4 — Revenue scale

A proxy for resilience: larger businesses survive shocks that kill smaller ones, independent of how affordable this particular loan looks.

| Monthly revenue | Points |
| --- | --- |
| ≥ ₹10L | +80 |
| ₹5L–10L | +50 |
| ₹1L–5L | +20 |
| ₹50k–1L | 0 |
| < ₹50k | −100 (`LOW_REVENUE`) |

#### Factor 5 — Sector

`Services +20` · `Retail +10` · `Manufacturing 0`.

**This is a placeholder and should be read as one.** Capped at ±20 — a twentieth of the affordability factor's spread — so sector can nudge a borderline file but can never decide one alone. A real weighting comes from observed default rates in the lender's own portfolio, segmented far more finely than three buckets. The ordering here reflects only the generic cash-conversion-cycle argument: services carry low capex and collect fast, retail turns over steadily on thin margins, manufacturing carries inventory and receivables so cash flow is lumpiest.

#### Factor 6 — PAN / name consistency

The 5th character of an individual PAN is the first letter of the holder's surname. A mismatch against the surname on the application is a genuine, if weak, fraud signal that lenders do check. **−30 points, `PAN_NAME_MISMATCH`, non-blocking.**

Applied only to individual PANs (4th character `P`), because for a company or firm PAN the 5th character encodes the entity name, which this system does not collect. Skipped for mononyms. Weighted lightly because a legal name change or an unconventional name order is a far likelier explanation than fraud.

### Reason codes

Every reason is an object, not a bare string:

```json
{
  "code": "HIGH_EMI_BURDEN",
  "severity": "WARNING",
  "message": "The estimated instalment of ₹45,840 consumes 45.8% of monthly revenue…",
  "pointsImpact": -120
}
```

Severity drives colour in the UI; `pointsImpact` lets the result view sort by what actually moved the score. Every decision returns reasons — approvals included, so a borrower approved despite a concern still sees it.

| Code | Severity | Meaning |
| --- | --- | --- |
| `DATA_INCONSISTENCY` | Critical | Loan disproportionate to revenue; figures likely wrong |
| `UNSERVICEABLE_EMI` | Critical | Instalment meets or exceeds all revenue |
| `LOW_REVENUE` | Critical | Below the lending floor |
| `SCORE_BELOW_THRESHOLD` | Critical | Scorecard total under 650 |
| `HIGH_EMI_BURDEN` | Warning | Instalment above 30% of revenue |
| `HIGH_LOAN_RATIO` | Warning | Above 12× monthly revenue |
| `SHORT_TENURE_RISK` | Warning | Under 6 months |
| `LONG_TENURE_RISK` | Warning | Over 48 months |
| `PAN_NAME_MISMATCH` | Warning | PAN surname initial disagrees with the name given |
| `STRONG_REVENUE_COVERAGE` | Positive | Instalment at or under 10% of revenue |
| `COMFORTABLE_LOAN_RATIO` | Positive | At or under 3× monthly revenue |
| `HEALTHY_TENURE_FIT` | Positive | 12–36 months |

### Engine versioning

Every decision is stamped with `engineVersion` and stored with it. When thresholds are retuned, historical decisions remain interpretable — you can still tell which scorecard produced a given outcome.

---

## Reference scenarios

Produced by the engine itself; the first, fifth and seventh rows are asserted in the test suite.

| Scenario | Revenue | Loan | Tenure | EMI | EMI/Rev | Score | Outcome | Lead reason |
|---|---|---|---|---|---|---|---|---|
| Healthy services business | ₹8.0L | ₹10.0L | 24mo | ₹49,924 | 6.2% | **870** | APPROVED | `STRONG_REVENUE_COVERAGE` |
| Solid manufacturer | ₹5.0L | ₹10.0L | 24mo | ₹49,924 | 10.0% | **850** | APPROVED | `STRONG_REVENUE_COVERAGE` |
| Modest retailer, sensible ask | ₹2.0L | ₹10.0L | 24mo | ₹49,924 | 25.0% | **680** | APPROVED | `HEALTHY_TENURE_FIT` |
| Stretched: EMI a third of revenue | ₹1.5L | ₹10.0L | 24mo | ₹49,924 | 33.3% | **550** | REJECTED | `SCORE_BELOW_THRESHOLD` |
| Over-leveraged retailer | ₹1.0L | ₹5.0L | 12mo | ₹45,840 | 45.8% | **520** | REJECTED | `SCORE_BELOW_THRESHOLD` |
| Very short tenure | ₹5.0L | ₹10.0L | 3mo | ₹3,43,383 | 68.7% | **380** | REJECTED | `SCORE_BELOW_THRESHOLD` |
| Conflicting data (the brief's example) | ₹10.0L | ₹500.0L | 36mo | ₹18,07,620 | 180.8% | **300** | REJECTED | `DATA_INCONSISTENCY` |
| Below revenue floor | ₹0.2L | ₹1.0L | 12mo | ₹9,168 | 45.8% | **300** | REJECTED | `LOW_REVENUE` |

---

## API reference

Base path `/api/v1`. All responses are JSON.

### Response envelope

Success:

```json
{ "data": { }, "meta": { "requestId": "b3f1…" } }
```

Error:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "The request contains invalid fields",
    "details": [{ "field": "pan", "message": "PAN must be 5 letters, 4 digits, then 1 letter" }],
    "requestId": "b3f1…"
  }
}
```

One shape for every failure path. The central error handler is the only place in the codebase that writes an error response, which is what makes this consistent by construction rather than by convention.

Every request is assigned a `requestId`, returned in the `X-Request-Id` header and written into the audit trail, so an error a user reports can be traced to the exact stored record. An inbound `X-Request-Id` is honoured, so the id survives a proxy.

### Status codes

| Code | Meaning |
| --- | --- |
| `200` | Read, or an already-decided application |
| `201` | Resource created |
| `202` | Decision accepted for processing |
| `400` | Body is not valid JSON |
| `404` | Unknown resource or route |
| `409` | Conflicts with existing state (duplicate PAN) |
| `422` | Schema validation failed; see `details[]` |
| `500` | Unexpected fault — logged with a stack, never leaked to the client |
| `503` | A dependency is unavailable (`/readyz` only) |

---

### `POST /api/v1/businesses`

Create a business and owner profile.

```bash
curl -X POST localhost:4000/api/v1/businesses \
  -H 'Content-Type: application/json' \
  -d '{
    "ownerName": "Priya Nair",
    "pan": "ABCPN1234F",
    "businessType": "SERVICES",
    "monthlyRevenue": 800000
  }'
```

`201 Created`:

```json
{
  "data": {
    "id": "e24a19f4-730f-471b-bd6d-52ac934be586",
    "ownerName": "Priya Nair",
    "pan": "ABCPN1234F",
    "businessType": "SERVICES",
    "monthlyRevenue": 800000,
    "createdAt": "2026-07-30T15:45:01.932Z"
  },
  "meta": { "requestId": "c7e8208b-…" }
}
```

`businessType` is one of `RETAIL`, `MANUFACTURING`, `SERVICES`.

**Duplicate PAN → `409`.** PAN identifies the borrower, so a second profile under the same PAN is a conflict, not a new record. The response carries the existing id so the client can recover:

```json
{
  "error": {
    "code": "CONFLICT",
    "message": "A business profile already exists for PAN ABCPN1234F",
    "details": [],
    "requestId": "e5ee6727-…",
    "conflict": { "businessId": "e24a19f4-730f-471b-bd6d-52ac934be586" }
  }
}
```

The web client handles this by issuing a `PUT` to that id, which matters: the decision must be scored against the revenue submitted *now*, not a figure left over from a previous application.

### `GET /api/v1/businesses/:id`

`200` with the profile, `404` if unknown, `422` if the id is not a UUID.

### `PUT /api/v1/businesses/:id`

Full replacement of a profile. Same body as `POST`. Full replacement rather than `PATCH` because the profile is four fields, and a partial update of a credit input invites scoring a half-updated record.

### `POST /api/v1/applications`

```bash
curl -X POST localhost:4000/api/v1/applications \
  -H 'Content-Type: application/json' \
  -d '{
    "businessId": "e24a19f4-730f-471b-bd6d-52ac934be586",
    "requestedAmount": 1000000,
    "tenureMonths": 24,
    "purpose": "BUSINESS_EXPANSION"
  }'
```

`201 Created`, status `QUEUED`. Creating an application does **not** evaluate it — the decision is triggered explicitly, which keeps the resources independent and makes the async boundary visible in the API rather than hidden inside a create.

`purpose` is one of `WORKING_CAPITAL`, `INVENTORY_PURCHASE`, `EQUIPMENT_PURCHASE`, `BUSINESS_EXPANSION`, `DEBT_CONSOLIDATION`, `OTHER`.

### `POST /api/v1/applications/:id/decision`

Queue the application for evaluation.

`202 Accepted`:

```json
{
  "data": {
    "applicationId": "707db13c-…",
    "status": "QUEUED",
    "decision": null,
    "failureReason": null,
    "pollUrl": "/api/v1/applications/707db13c-…/decision"
  },
  "meta": { "requestId": "2907f789-…" }
}
```

**Idempotent.** Re-posting to an application that has already been decided returns `200` with the stored decision rather than re-running the engine. A client retrying after a dropped connection must not be able to produce a second, possibly different, decision on the same application.

### `GET /api/v1/applications/:id/decision`

The poll target. Always `200`, with the same envelope in every state — a pending decision is not an error, so it does not get an error status code.

While processing:

```json
{ "data": { "applicationId": "…", "status": "PROCESSING", "decision": null, "failureReason": null } }
```

Once settled:

```json
{
  "data": {
    "applicationId": "707db13c-…",
    "status": "DECIDED",
    "failureReason": null,
    "decision": {
      "id": "2d2ed7a0-…",
      "outcome": "APPROVED",
      "creditScore": 870,
      "estimatedEmi": 49924.1,
      "engineVersion": "1.0.0",
      "evaluatedAt": "2026-07-30T15:45:04.118Z",
      "reasons": [
        {
          "code": "STRONG_REVENUE_COVERAGE",
          "severity": "POSITIVE",
          "message": "The estimated instalment of ₹49,924 is only 6.2% of monthly revenue, leaving comfortable headroom.",
          "pointsImpact": 150
        }
      ]
    }
  }
}
```

`status` is `QUEUED`, `PROCESSING`, `DECIDED` or `FAILED`. `FAILED` means the worker exhausted its retries; `failureReason` explains why, so a polling client is told the job died instead of waiting forever.

### `GET /api/v1/applications/:id/audit`

The MongoDB audit trail for one application, newest first — exposed so the event stream is inspectable without a database shell.

### `GET /healthz` · `GET /readyz`

Two endpoints, because platforms need answers to two different questions. `/healthz` is liveness: is the process up? It never touches a dependency, so a database blip cannot get the container killed and restarted into the same blip. `/readyz` is readiness: it checks every dependency and returns `503` if a critical one is down.

MongoDB being down does not make the service unready — the audit trail is best-effort, and a borrower should not be denied a decision because a log store is briefly unreachable.

---

## Edge case strategy

### The distinction the design turns on

**Malformed input is a client error. An unaffordable loan is a credit decision.**

The brief's example — ₹10L monthly revenue against a ₹5Cr request — is *schema-valid*. Every field is the right type and inside its bounds. It is the *business case* that fails. So it returns `200` with a `REJECTED` decision and `DATA_INCONSISTENCY`, **not** a `422`.

Returning `422` there would be wrong in a way that matters: it would tell the client "you sent a bad request" when the client sent a perfectly well-formed one, and it would mean the rejection never gets recorded as a decision — no score, no reason codes, no audit trail, nothing to explain to the applicant or to a regulator. The API test suite asserts the status code precisely so this cannot regress.

### Handling matrix

| Input | Response | Notes |
| --- | --- | --- |
| Missing or partial fields | `422` | **Every** failing field listed at once, not first-error-only |
| Negative or zero revenue | `422` | |
| Non-numeric value (`"abc"`) | `422` | Exactly one message per field, not a cascade |
| Comma-formatted (`"50,000"`) | `422` | Deliberate: stripping separators would let `"1,0,0"` through as `100` |
| Numeric string (`"800000"`) | `201` | Accepted — HTML forms submit strings |
| Malformed PAN | `422` | Regex `^[A-Z]{5}[0-9]{4}[A-Z]$` |
| Invalid PAN holder type | `422` | 4th character checked against the valid set (`P`, `C`, `H`, `F`, …) |
| Lowercase PAN | `201` | Normalised to upper case, not rejected |
| `Infinity` / `NaN` | `422` | Plus an explicit ₹100 crore ceiling |
| Fractional tenure (`12.5`) | `422` | |
| Tenure > 84 months | `422` | |
| Unknown business type | `422` | Permitted values echoed in the message |
| Duplicate PAN | `409` | Carries the existing `businessId` |
| Malformed JSON body | `400` | Not a `500` |
| Unknown route or id | `404` | Same error envelope |
| **₹10L revenue, ₹5Cr loan** | **`200` REJECTED** | `DATA_INCONSISTENCY` — valid schema, invalid credit case |
| Worker crash mid-job | Retry ×3, then `FAILED` | Exponential backoff; `failureReason` set so polling terminates |
| Unexpected exception | `500` | Generic message; stack goes to the log, never the response |

### Validation design

Validation schemas live in `packages/shared` and are imported by **both** the React form and the Express middleware. One definition, so the client cannot accept something the server rejects, and the two cannot drift.

Two properties are deliberate:

1. **Every failing field is reported at once.** Returning one error at a time forces a fix-resubmit-discover loop, which is a poor experience on a form this size.
2. **One message per field.** Checks run in order inside a single transform and stop at the first failure, so `"abc"` reports only *"must be a number"* rather than also complaining it is below the minimum and not greater than zero. Chained refinements all run against the failed value and produce exactly that noise.

The parsed, coerced result replaces the raw input, so handlers downstream receive typed, trimmed, upper-cased values and never re-parse. There is exactly one place where untrusted input becomes trusted.

---

## Testing

```bash
docker compose up -d postgres mongo redis   # integration tests need real databases
npm test
```

**146 tests**, all passing.

| Suite | Count | Covers |
| --- | --- | --- |
| `engine.spec.ts` | 73 | Every threshold band and **both sides of every boundary** — 0.30 vs 0.3001. Hard rules, clamping, determinism, input immutability, reason ordering |
| `api.spec.ts` | 48 | Every row of the edge case matrix, envelope consistency, idempotency, the 409 recovery path, NUMERIC round trips, the CORS allowlist |
| `emi.spec.ts` | 14 | Amortisation against reference values cross-checked with a public EMI calculator, plus zero-rate and single-instalment edges |
| `config.spec.ts` | 11 | Origin validation and normalisation — a misconfigured allowlist fails at boot rather than on the first browser request |

Integration tests run against the real Postgres rather than a mock. The failures worth catching here are unique constraints, cascades and NUMERIC round trips — none of which a mock reproduces.

The engine's purity is what makes its 73 tests possible with no infrastructure at all: `evaluate()` takes plain numbers and returns a verdict, so the entire credit policy can be exercised in memory.

---

## Assumptions and known limitations

Stated plainly, because most of these are the first things a production system would fix.

### Credit assumptions

1. **Revenue is self-reported and unverified.** There is no bank-statement analysis, no GST cross-check, no bureau pull. In production, revenue would be corroborated before it was scored — this is the single largest gap between this system and a real one.
2. **Revenue is scored, not profit.** A retailer on 8% net margin and a services firm on 40% are treated identically by the affordability factor. This is the biggest weakness *within* the scorecard, and it exists because margin is not collected. Collecting it would be a better use of one extra form field than any refinement of the existing thresholds.
3. **A flat 18% interest rate.** A real engine prices the rate off the very risk band it is computing, so rate and score are mutually dependent and solved together. Holding the rate flat breaks that circularity, at the cost of overstating affordability for weak applicants and understating it for strong ones.
4. **No existing obligations.** True FOIR accounts for all current debt service. This system sees only the loan being applied for, so it will overstate affordability for any borrower already carrying debt.
5. **Thresholds are reasoned, not calibrated.** They come from published Indian MSME lending practice, not from observed default rates in a portfolio. Calibrating them against real outcomes is the first thing to do with real data.
6. **No collateral, guarantor or credit-history input.** All lending is treated as unsecured, first-time.

### Technical

7. **Money is `NUMERIC(14,2)`.** Correct in the database, but converted to a JS `number` at the serialisation boundary. Safe here because input is capped at ₹100 crore, far inside the range where doubles represent integers exactly. The production answer is to store minor units as `BIGINT` and format at the edge.
8. **The audit trail is best-effort.** Audit writes are fire-and-forget and swallow their own errors, so a Mongo outage cannot fail a borrower's decision. That is the right trade here, but it is a trade: a system under a regulatory retention obligation would write the audit record inside the decision transaction and fail the request if it could not persist.
9. **PAN is mock-format.** Validated for structure and holder type, never verified against NSDL.
10. **No authentication.** Every endpoint is public. A real system needs authentication, per-applicant authorisation, and rate limiting — deliberately out of scope here.
11. **No idempotency keys on submission.** A double-click could create two applications. The *decision* is idempotent; the intake is not.
12. **`DECISION_PROCESSING_DELAY_MS` defaults to 1200ms** so the polling flow is visible in a demo. Production sets it to `0`.

---

## Deployment

### Backend — Render

The repository includes [`render.yaml`](render.yaml), a Blueprint that provisions the API, Postgres and Redis in one apply.

1. In Render, choose **New → Blueprint** and point it at this repository.
2. After the first apply, set two variables in the dashboard (both marked `sync: false` because they are external or environment-specific):
   - `MONGO_URL` — a MongoDB Atlas connection string. Render has no managed MongoDB, which is why this is not in the Blueprint.
   - `CORS_ORIGIN` — the deployed frontend origin, **scheme included**: `https://your-app.vercel.app`, not `your-app.vercel.app`. A browser's `Origin` header always carries the scheme, so a bare host matches nothing. The API refuses to start on a malformed entry and names it, rather than booting into a state where every browser request fails and the preflight still returns 204. Trailing slashes, whitespace and case are normalised away, so a value pasted from the address bar is fine, and a denied origin is logged next to the configured allowlist.

Migrations run automatically before the API binds its port, so an instance never starts against a schema that does not match its code.

**Why there is no separate worker service.** Render's free plan does not offer background workers at all, so the API runs with `DECISION_MODE=embedded` and hosts the BullMQ worker in-process. The queue, the retries and the backoff are all real — only the process isolation is given up.

To split it back out on a paid plan, add a worker service running `node apps/api/dist/worker-entry.js` and set `DECISION_MODE=queue` on both services. No application code changes; `worker-entry.ts` already exists and is what docker-compose uses.

### Frontend — Vercel

1. Import the repository, set the root directory to `apps/web`.
2. Set `VITE_API_URL` to the Render API URL.

Vite inlines env vars at build time, so changing the API URL requires a redeploy, not just a restart.

### Note on free tiers

Render's free web services sleep after inactivity, so the first request after an idle period can take ~50 seconds. The client polls for up to 45 seconds before showing a recoverable error — if you hit a cold start on a demo, load `/healthz` first to wake the service.

---

## Tech stack

| Layer | Choice | Why |
| --- | --- | --- |
| API | Node · Express · TypeScript | Per the brief |
| Validation | Zod | One schema shared by client and server |
| Database | Postgres · Drizzle ORM | Drizzle is pure TypeScript with no native binary, so it builds identically everywhere. Prisma ships no engine for NixOS, the development platform here |
| Audit store | MongoDB · Mongoose | Append-only, variable-shape event stream |
| Queue | BullMQ · Redis | Real background jobs with retries and backoff |
| Frontend | React · Vite · TypeScript | The brief asks for a single page; Vite keeps it a single page |
| Forms | react-hook-form + Zod resolver | Same schema as the API |
| Styling | Hand-written CSS | One form and one result view. The severity palette needs to be a deliberate accessible set, and a framework would have added config to style ~200 lines of markup |
