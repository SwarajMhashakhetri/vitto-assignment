import { z } from 'zod';
import {
  BUSINESS_TYPES,
  INPUT_LIMITS,
  LOAN_PURPOSES,
  PAN_HOLDER_TYPES,
  PAN_REGEX,
} from './constants';

/**
 * Request schemas, shared verbatim between the Express validation middleware
 * and the React form's `zodResolver`. One definition, so the client cannot
 * accept something the server rejects.
 */

/**
 * Money and counts arrive from JSON forms as strings often enough that a bare
 * `z.number()` produces a confusing "expected number, received string" for a
 * user who typed a perfectly good figure. So we accept a numeric string but
 * reject anything that is not fully numeric — `"50000"` passes, `"50,000"` and
 * `"abc"` do not. This is deliberate: silently stripping commas would let
 * `"1,0,0"` through as 100.
 */
const numericInput = (fieldLabel: string) =>
  z
    .union([z.number(), z.string()])
    .transform((value, ctx) => {
      if (typeof value === 'number') return value;

      const trimmed = value.trim();
      if (trimmed === '') {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${fieldLabel} is required` });
        return z.NEVER;
      }
      // Number('') is 0 and Number(' ') is 0, both already handled above.
      const parsed = Number(trimmed);
      if (!Number.isFinite(parsed)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${fieldLabel} must be a number`,
        });
        return z.NEVER;
      }
      return parsed;
    })
    .pipe(
      z
        .number({ invalid_type_error: `${fieldLabel} must be a number` })
        .finite(`${fieldLabel} must be a finite number`),
    );

/**
 * PAN check in two stages so the message tells the applicant what to fix:
 * shape first, then the holder-type character.
 */
export const panSchema = z
  .string({ required_error: 'PAN is required' })
  .trim()
  .toUpperCase()
  .regex(PAN_REGEX, 'PAN must be 5 letters, 4 digits, then 1 letter (e.g. ABCPE1234F)')
  .refine((pan) => PAN_HOLDER_TYPES[pan.charAt(3)] !== undefined, {
    message: `The 4th character of a PAN must be a valid holder type (${Object.keys(
      PAN_HOLDER_TYPES,
    ).join(', ')})`,
  });

export const createBusinessSchema = z.object({
  ownerName: z
    .string({ required_error: 'Owner name is required' })
    .trim()
    .min(2, 'Owner name must be at least 2 characters')
    .max(
      INPUT_LIMITS.MAX_OWNER_NAME_LENGTH,
      `Owner name must be at most ${INPUT_LIMITS.MAX_OWNER_NAME_LENGTH} characters`,
    ),
  pan: panSchema,
  businessType: z.enum(BUSINESS_TYPES, {
    errorMap: () => ({ message: `Business type must be one of: ${BUSINESS_TYPES.join(', ')}` }),
  }),
  monthlyRevenue: numericInput('Monthly revenue')
    .refine((n) => n > 0, 'Monthly revenue must be greater than zero')
    .refine(
      (n) => n >= INPUT_LIMITS.MIN_MONTHLY_REVENUE,
      `Monthly revenue must be at least ₹${INPUT_LIMITS.MIN_MONTHLY_REVENUE.toLocaleString('en-IN')}`,
    )
    .refine(
      (n) => n <= INPUT_LIMITS.MAX_MONTHLY_REVENUE,
      `Monthly revenue must not exceed ₹${INPUT_LIMITS.MAX_MONTHLY_REVENUE.toLocaleString('en-IN')}`,
    ),
});

export const createApplicationSchema = z.object({
  businessId: z.string({ required_error: 'businessId is required' }).uuid('businessId must be a UUID'),
  requestedAmount: numericInput('Requested amount')
    .refine((n) => n > 0, 'Requested amount must be greater than zero')
    .refine(
      (n) => n >= INPUT_LIMITS.MIN_LOAN_AMOUNT,
      `Requested amount must be at least ₹${INPUT_LIMITS.MIN_LOAN_AMOUNT.toLocaleString('en-IN')}`,
    )
    .refine(
      (n) => n <= INPUT_LIMITS.MAX_LOAN_AMOUNT,
      `Requested amount must not exceed ₹${INPUT_LIMITS.MAX_LOAN_AMOUNT.toLocaleString('en-IN')}`,
    ),
  tenureMonths: numericInput('Tenure')
    .refine((n) => Number.isInteger(n), 'Tenure must be a whole number of months')
    .refine(
      (n) => n >= INPUT_LIMITS.MIN_TENURE_MONTHS,
      `Tenure must be at least ${INPUT_LIMITS.MIN_TENURE_MONTHS} month`,
    )
    .refine(
      (n) => n <= INPUT_LIMITS.MAX_TENURE_MONTHS,
      `Tenure must not exceed ${INPUT_LIMITS.MAX_TENURE_MONTHS} months`,
    ),
  purpose: z.enum(LOAN_PURPOSES, {
    errorMap: () => ({ message: `Purpose must be one of: ${LOAN_PURPOSES.join(', ')}` }),
  }),
});

/**
 * The single form the SPA renders: business profile and loan request together.
 * Composed from the two API schemas rather than redefined, so a rule can only
 * ever be written once.
 */
export const loanIntakeFormSchema = createBusinessSchema.merge(
  createApplicationSchema.omit({ businessId: true }),
);

export const uuidParamSchema = z.object({
  id: z.string().uuid('Must be a valid UUID'),
});

export type CreateBusinessInput = z.infer<typeof createBusinessSchema>;
export type CreateApplicationInput = z.infer<typeof createApplicationSchema>;
export type LoanIntakeFormInput = z.infer<typeof loanIntakeFormSchema>;
/** The un-parsed shape, i.e. what the form holds while the user is typing. */
export type LoanIntakeFormValues = z.input<typeof loanIntakeFormSchema>;
