import { relations } from 'drizzle-orm';
import {
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Postgres schema — the system of record.
 *
 * Drizzle rather than Prisma: Prisma ships no query-engine binary for NixOS,
 * this project's development platform, so it cannot generate a client there at
 * all. Drizzle is pure TypeScript with no native dependency, which also means
 * no engine download during the container build.
 */

export const businessTypeEnum = pgEnum('business_type', [
  'RETAIL',
  'MANUFACTURING',
  'SERVICES',
]);

export const applicationStatusEnum = pgEnum('application_status', [
  'QUEUED',
  'PROCESSING',
  'DECIDED',
  'FAILED',
]);

export const decisionOutcomeEnum = pgEnum('decision_outcome', ['APPROVED', 'REJECTED']);

export const reasonSeverityEnum = pgEnum('reason_severity', [
  'CRITICAL',
  'WARNING',
  'INFO',
  'POSITIVE',
]);

/**
 * The MSME and its owner.
 *
 * PAN is the borrower's natural key and is unique: a repeat applicant updates
 * this row rather than creating a second identity for the same person.
 *
 * Money is NUMERIC(14,2), not a float. Drizzle returns numerics as strings to
 * avoid silent precision loss, and they are converted at the serialisation
 * boundary — see lib/serialize.ts.
 */
export const businesses = pgTable('businesses', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerName: text('owner_name').notNull(),
  pan: text('pan').notNull().unique(),
  businessType: businessTypeEnum('business_type').notNull(),
  monthlyRevenue: numeric('monthly_revenue', { precision: 14, scale: 2 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const loanApplications = pgTable(
  'loan_applications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    requestedAmount: numeric('requested_amount', { precision: 14, scale: 2 }).notNull(),
    tenureMonths: integer('tenure_months').notNull(),
    purpose: text('purpose').notNull(),
    status: applicationStatusEnum('status').notNull().default('QUEUED'),
    /**
     * Set when the worker exhausts its retries, so a polling client can be
     * told the job died rather than waiting forever on a status that will
     * never change.
     */
    failureReason: text('failure_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('loan_applications_business_id_idx').on(table.businessId),
    index('loan_applications_status_idx').on(table.status),
  ],
);

/**
 * One decision per application. The unique constraint on application_id is
 * what makes re-triggering the decision endpoint idempotent — a retry after a
 * dropped connection cannot produce a second, different decision.
 */
export const decisions = pgTable('decisions', {
  id: uuid('id').primaryKey().defaultRandom(),
  applicationId: uuid('application_id')
    .notNull()
    .unique()
    .references(() => loanApplications.id, { onDelete: 'cascade' }),
  outcome: decisionOutcomeEnum('outcome').notNull(),
  creditScore: integer('credit_score').notNull(),
  estimatedEmi: numeric('estimated_emi', { precision: 14, scale: 2 }).notNull(),
  /**
   * Which version of the scorecard produced this row, so stored decisions stay
   * interpretable after the thresholds are retuned.
   */
  engineVersion: text('engine_version').notNull(),
  evaluatedAt: timestamp('evaluated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Reason codes as a normalised child table rather than a JSONB blob, so they
 * stay queryable: "how many declines cited HIGH_EMI_BURDEN this month" is a
 * question a credit team actually asks. The unstructured full scoring trace
 * lives in MongoDB instead.
 */
export const decisionReasons = pgTable(
  'decision_reasons',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    decisionId: uuid('decision_id')
      .notNull()
      .references(() => decisions.id, { onDelete: 'cascade' }),
    code: text('code').notNull(),
    severity: reasonSeverityEnum('severity').notNull(),
    message: text('message').notNull(),
    pointsImpact: integer('points_impact').notNull(),
  },
  (table) => [
    index('decision_reasons_decision_id_idx').on(table.decisionId),
    index('decision_reasons_code_idx').on(table.code),
  ],
);

/* -------------------------------------------------------------------------- */
/* Relations — enable Drizzle's nested `with` queries                          */
/* -------------------------------------------------------------------------- */

export const businessesRelations = relations(businesses, ({ many }) => ({
  applications: many(loanApplications),
}));

export const loanApplicationsRelations = relations(loanApplications, ({ one }) => ({
  business: one(businesses, {
    fields: [loanApplications.businessId],
    references: [businesses.id],
  }),
  decision: one(decisions, {
    fields: [loanApplications.id],
    references: [decisions.applicationId],
  }),
}));

export const decisionsRelations = relations(decisions, ({ one, many }) => ({
  application: one(loanApplications, {
    fields: [decisions.applicationId],
    references: [loanApplications.id],
  }),
  reasons: many(decisionReasons),
}));

export const decisionReasonsRelations = relations(decisionReasons, ({ one }) => ({
  decision: one(decisions, {
    fields: [decisionReasons.decisionId],
    references: [decisions.id],
  }),
}));

/* -------------------------------------------------------------------------- */
/* Inferred row types                                                         */
/* -------------------------------------------------------------------------- */

export type BusinessRow = typeof businesses.$inferSelect;
export type LoanApplicationRow = typeof loanApplications.$inferSelect;
export type DecisionRow = typeof decisions.$inferSelect;
export type DecisionReasonRow = typeof decisionReasons.$inferSelect;
