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

/** ₹12,34,567 — Indian lakh/crore digit grouping. */
const inr = (amount: number): string => `₹${amount.toLocaleString('en-IN')}`;

interface NumericFieldOptions {
  min: number;
  max: number;
  /** Reject fractional values, e.g. a tenure of 12.5 months. */
  integer?: boolean;
  /** How bounds are rendered in messages. Amounts use ₹; counts do not. */
  format?: (value: number) => string;
}

/**
 * A bounded numeric field.
 *
 * Two decisions worth naming:
 *
 * 1. **Numeric strings are accepted, lenient parsing is not.** JSON form
 *    submissions send `"50000"` often enough that a bare `z.number()` would
 *    reject perfectly good input. But `"50,000"` is an error rather than a
 *    silent reinterpretation — stripping separators would also let `"1,0,0"`
 *    through as 100, turning a typo into a plausible wrong number.
 *
 * 2. **One message per field, not a cascade.** Checks run in order inside a
 *    single transform and stop at the first failure, so `"abc"` reports only
 *    "must be a number" instead of also complaining that it is below the
 *    minimum and not greater than zero. Chained `.refine()` calls all run
 *    against the failed value and produce exactly that noise.
 */
const numericField = (fieldLabel: string, options: NumericFieldOptions) => {
  const format = options.format ?? inr;

  return z
    .union([z.number(), z.string()], {
      required_error: `${fieldLabel} is required`,
      invalid_type_error: `${fieldLabel} must be a number`,
    })
    .transform((value, ctx): number => {
      const fail = (message: string) => {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message });
        return z.NEVER;
      };

      let parsed: number;

      if (typeof value === 'number') {
        parsed = value;
      } else {
        const trimmed = value.trim();
        // Number('') and Number(' ') are both 0, so empty input must be
        // caught before parsing or it silently becomes zero.
        if (trimmed === '') return fail(`${fieldLabel} is required`);

        parsed = Number(trimmed);
      }

      // Covers NaN from an unparseable string, and Infinity from either source.
      if (!Number.isFinite(parsed)) return fail(`${fieldLabel} must be a number`);
      if (options.integer && !Number.isInteger(parsed)) {
        return fail(`${fieldLabel} must be a whole number`);
      }
      if (parsed <= 0) return fail(`${fieldLabel} must be greater than zero`);
      if (parsed < options.min) return fail(`${fieldLabel} must be at least ${format(options.min)}`);
      if (parsed > options.max) {
        return fail(`${fieldLabel} must not exceed ${format(options.max)}`);
      }

      return parsed;
    });
};

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
  monthlyRevenue: numericField('Monthly revenue', {
    min: INPUT_LIMITS.MIN_MONTHLY_REVENUE,
    max: INPUT_LIMITS.MAX_MONTHLY_REVENUE,
  }),
});

export const createApplicationSchema = z.object({
  businessId: z.string({ required_error: 'businessId is required' }).uuid('businessId must be a UUID'),
  requestedAmount: numericField('Requested amount', {
    min: INPUT_LIMITS.MIN_LOAN_AMOUNT,
    max: INPUT_LIMITS.MAX_LOAN_AMOUNT,
  }),
  tenureMonths: numericField('Tenure', {
    min: INPUT_LIMITS.MIN_TENURE_MONTHS,
    max: INPUT_LIMITS.MAX_TENURE_MONTHS,
    integer: true,
    format: (value) => `${value} months`,
  }),
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
