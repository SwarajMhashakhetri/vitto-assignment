import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  ANNUAL_INTEREST_RATE_PCT,
  BUSINESS_TYPES,
  BUSINESS_TYPE_LABELS,
  LOAN_PURPOSES,
  LOAN_PURPOSE_LABELS,
  calculateEmi,
  loanIntakeFormSchema,
  type LoanIntakeFormInput,
  type LoanIntakeFormValues,
} from '@lds/shared';
import { formatInr, formatPct } from '../lib/format';
import { Field } from './Field';

interface ApplicationFormProps {
  onSubmit: (values: LoanIntakeFormInput) => void;
  isSubmitting: boolean;
  /** Field errors returned by the server, keyed by field name. */
  serverErrors: Record<string, string>;
  submitError: string | null;
}

/**
 * The single intake form.
 *
 * Validated with the *same* Zod schema the API validates against, imported
 * from the shared package. The client cannot accept anything the server
 * rejects, and the two cannot drift.
 */
export function ApplicationForm({
  onSubmit,
  isSubmitting,
  serverErrors,
  submitError,
}: ApplicationFormProps) {
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<LoanIntakeFormValues, unknown, LoanIntakeFormInput>({
    resolver: zodResolver(loanIntakeFormSchema),
    mode: 'onBlur',
    defaultValues: {
      ownerName: '',
      pan: '',
      businessType: 'RETAIL',
      monthlyRevenue: '',
      requestedAmount: '',
      tenureMonths: '',
      purpose: 'WORKING_CAPITAL',
    },
  });

  // Live affordability preview. Uses the shared EMI function, so this is
  // literally the number the engine will score — not an approximation of it.
  const preview = buildPreview({
    requestedAmount: watch('requestedAmount'),
    tenureMonths: watch('tenureMonths'),
    monthlyRevenue: watch('monthlyRevenue'),
  });

  const errorFor = (field: keyof LoanIntakeFormValues): string | undefined =>
    errors[field]?.message ?? serverErrors[field];

  return (
    <form className="form" onSubmit={handleSubmit(onSubmit)} noValidate>
      <fieldset className="form__section" disabled={isSubmitting}>
        <legend className="form__legend">Business profile</legend>

        <Field label="Business owner name" htmlFor="ownerName" error={errorFor('ownerName')}>
          <input
            id="ownerName"
            className="input"
            type="text"
            autoComplete="name"
            placeholder="e.g. Priya Nair"
            aria-invalid={Boolean(errorFor('ownerName'))}
            {...register('ownerName')}
          />
        </Field>

        <Field
          label="PAN"
          htmlFor="pan"
          error={errorFor('pan')}
          hint="Ten characters: five letters, four digits, one letter."
        >
          <input
            id="pan"
            className="input input--mono"
            type="text"
            maxLength={10}
            placeholder="ABCPE1234F"
            // PAN is always upper case; forcing it visually saves a
            // validation round trip for something the user cannot get wrong.
            style={{ textTransform: 'uppercase' }}
            aria-invalid={Boolean(errorFor('pan'))}
            {...register('pan')}
          />
        </Field>

        <div className="form__row">
          <Field label="Business type" htmlFor="businessType" error={errorFor('businessType')}>
            <select
              id="businessType"
              className="input"
              aria-invalid={Boolean(errorFor('businessType'))}
              {...register('businessType')}
            >
              {BUSINESS_TYPES.map((type) => (
                <option key={type} value={type}>
                  {BUSINESS_TYPE_LABELS[type]}
                </option>
              ))}
            </select>
          </Field>

          <Field
            label="Monthly revenue"
            htmlFor="monthlyRevenue"
            error={errorFor('monthlyRevenue')}
            hint="Average gross monthly turnover, in rupees."
          >
            <div className="input-group">
              <span className="input-group__prefix">₹</span>
              <input
                id="monthlyRevenue"
                className="input input--numeric"
                type="text"
                inputMode="numeric"
                placeholder="800000"
                aria-invalid={Boolean(errorFor('monthlyRevenue'))}
                {...register('monthlyRevenue')}
              />
            </div>
          </Field>
        </div>
      </fieldset>

      <fieldset className="form__section" disabled={isSubmitting}>
        <legend className="form__legend">Loan request</legend>

        <div className="form__row">
          <Field label="Loan amount" htmlFor="requestedAmount" error={errorFor('requestedAmount')}>
            <div className="input-group">
              <span className="input-group__prefix">₹</span>
              <input
                id="requestedAmount"
                className="input input--numeric"
                type="text"
                inputMode="numeric"
                placeholder="1000000"
                aria-invalid={Boolean(errorFor('requestedAmount'))}
                {...register('requestedAmount')}
              />
            </div>
          </Field>

          <Field
            label="Repayment tenure"
            htmlFor="tenureMonths"
            error={errorFor('tenureMonths')}
            hint="In months, 1 to 84."
          >
            <div className="input-group">
              <input
                id="tenureMonths"
                className="input input--numeric"
                type="text"
                inputMode="numeric"
                placeholder="24"
                aria-invalid={Boolean(errorFor('tenureMonths'))}
                {...register('tenureMonths')}
              />
              <span className="input-group__suffix">months</span>
            </div>
          </Field>
        </div>

        <Field label="Purpose of the loan" htmlFor="purpose" error={errorFor('purpose')}>
          <select
            id="purpose"
            className="input"
            aria-invalid={Boolean(errorFor('purpose'))}
            {...register('purpose')}
          >
            {LOAN_PURPOSES.map((purpose) => (
              <option key={purpose} value={purpose}>
                {LOAN_PURPOSE_LABELS[purpose]}
              </option>
            ))}
          </select>
        </Field>
      </fieldset>

      {preview && (
        <aside className="preview" aria-live="polite">
          <div className="preview__row">
            <span className="preview__label">Estimated instalment</span>
            <strong className="preview__value">{formatInr(preview.emi)}/mo</strong>
          </div>
          {preview.emiToRevenue !== null && (
            <div className="preview__row">
              <span className="preview__label">Share of monthly revenue</span>
              <strong
                className={`preview__value ${
                  preview.emiToRevenue > 0.3 ? 'preview__value--warn' : ''
                }`}
              >
                {formatPct(preview.emiToRevenue)}
              </strong>
            </div>
          )}
          <p className="preview__note">
            Indicative, at {ANNUAL_INTEREST_RATE_PCT}% p.a. reducing balance. Affordability is the
            heaviest factor in the assessment.
          </p>
        </aside>
      )}

      {submitError && (
        <p className="alert alert--error" role="alert">
          {submitError}
        </p>
      )}

      <button type="submit" className="button button--primary" disabled={isSubmitting}>
        {isSubmitting ? 'Submitting…' : 'Submit application'}
      </button>
    </form>
  );
}

interface Preview {
  emi: number;
  emiToRevenue: number | null;
}

/**
 * Computes the live preview, or returns null when the inputs are not yet
 * usable. Parsing is intentionally forgiving here — this is a hint shown
 * while typing, not a validation gate.
 */
function buildPreview(raw: {
  requestedAmount: string | number | undefined;
  tenureMonths: string | number | undefined;
  monthlyRevenue: string | number | undefined;
}): Preview | null {
  const amount = toFiniteNumber(raw.requestedAmount);
  const tenure = toFiniteNumber(raw.tenureMonths);
  const revenue = toFiniteNumber(raw.monthlyRevenue);

  if (amount === null || tenure === null || amount <= 0 || tenure <= 0) return null;
  // Guard the formula's domain; the schema enforces the real bounds.
  if (!Number.isInteger(tenure) || tenure > 600) return null;

  const emi = calculateEmi(amount, ANNUAL_INTEREST_RATE_PCT, tenure);

  return {
    emi,
    emiToRevenue: revenue !== null && revenue > 0 ? emi / revenue : null,
  };
}

function toFiniteNumber(value: string | number | undefined): number | null {
  if (value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(String(value).trim());
  return Number.isFinite(parsed) ? parsed : null;
}
