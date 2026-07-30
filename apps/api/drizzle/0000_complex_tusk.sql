CREATE TYPE "public"."application_status" AS ENUM('QUEUED', 'PROCESSING', 'DECIDED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."business_type" AS ENUM('RETAIL', 'MANUFACTURING', 'SERVICES');--> statement-breakpoint
CREATE TYPE "public"."decision_outcome" AS ENUM('APPROVED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."reason_severity" AS ENUM('CRITICAL', 'WARNING', 'INFO', 'POSITIVE');--> statement-breakpoint
CREATE TABLE "businesses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_name" text NOT NULL,
	"pan" text NOT NULL,
	"business_type" "business_type" NOT NULL,
	"monthly_revenue" numeric(14, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "businesses_pan_unique" UNIQUE("pan")
);
--> statement-breakpoint
CREATE TABLE "decision_reasons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"decision_id" uuid NOT NULL,
	"code" text NOT NULL,
	"severity" "reason_severity" NOT NULL,
	"message" text NOT NULL,
	"points_impact" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"outcome" "decision_outcome" NOT NULL,
	"credit_score" integer NOT NULL,
	"estimated_emi" numeric(14, 2) NOT NULL,
	"engine_version" text NOT NULL,
	"evaluated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "decisions_application_id_unique" UNIQUE("application_id")
);
--> statement-breakpoint
CREATE TABLE "loan_applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"requested_amount" numeric(14, 2) NOT NULL,
	"tenure_months" integer NOT NULL,
	"purpose" text NOT NULL,
	"status" "application_status" DEFAULT 'QUEUED' NOT NULL,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "decision_reasons" ADD CONSTRAINT "decision_reasons_decision_id_decisions_id_fk" FOREIGN KEY ("decision_id") REFERENCES "public"."decisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_application_id_loan_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."loan_applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan_applications" ADD CONSTRAINT "loan_applications_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "decision_reasons_decision_id_idx" ON "decision_reasons" USING btree ("decision_id");--> statement-breakpoint
CREATE INDEX "decision_reasons_code_idx" ON "decision_reasons" USING btree ("code");--> statement-breakpoint
CREATE INDEX "loan_applications_business_id_idx" ON "loan_applications" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "loan_applications_status_idx" ON "loan_applications" USING btree ("status");