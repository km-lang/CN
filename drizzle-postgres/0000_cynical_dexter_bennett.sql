CREATE TABLE "activity_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"actor" text NOT NULL,
	"details" text DEFAULT '' NOT NULL,
	"mutation_request_key" text DEFAULT '' NOT NULL,
	"created_at" text DEFAULT to_char(timezone('UTC', CURRENT_TIMESTAMP), 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alumni" (
	"id" serial PRIMARY KEY NOT NULL,
	"profile_key" text NOT NULL,
	"name" text NOT NULL,
	"initials" text NOT NULL,
	"batch" integer NOT NULL,
	"graduation_year" integer DEFAULT 0 NOT NULL,
	"programme" text NOT NULL,
	"education" text DEFAULT 'Indian Institute of Management Lucknow' NOT NULL,
	"company" text NOT NULL,
	"title" text NOT NULL,
	"raw_title" text DEFAULT '' NOT NULL,
	"function" text NOT NULL,
	"seniority" text NOT NULL,
	"location" text NOT NULL,
	"previous_companies" text DEFAULT '' NOT NULL,
	"experience_years" integer DEFAULT 0 NOT NULL,
	"confidence" integer DEFAULT 50 NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"linkedin_url" text DEFAULT '' NOT NULL,
	"pdl_person_id" text DEFAULT '' NOT NULL,
	"coresignal_employee_id" text DEFAULT '' NOT NULL,
	"lusha_person_id" text DEFAULT '' NOT NULL,
	"discovery_source" text DEFAULT 'Manual import' NOT NULL,
	"discovery_date" text DEFAULT '' NOT NULL,
	"last_pdl_refresh" text DEFAULT '' NOT NULL,
	"last_professional_data_refresh" text DEFAULT '' NOT NULL,
	"professional_data_provider" text DEFAULT '' NOT NULL,
	"provider_freshness_at" text DEFAULT '' NOT NULL,
	"iiml_affiliation_status" text DEFAULT 'Not assessed' NOT NULL,
	"iiml_education_programme" text DEFAULT '' NOT NULL,
	"iiml_education_start_date" text DEFAULT '' NOT NULL,
	"iiml_education_end_date" text DEFAULT '' NOT NULL,
	"iiml_institution_id" text DEFAULT '' NOT NULL,
	"iiml_institution_url" text DEFAULT '' NOT NULL,
	"current_company_id" text DEFAULT '' NOT NULL,
	"current_company_url" text DEFAULT '' NOT NULL,
	"current_role_start_date" text DEFAULT '' NOT NULL,
	"current_industry" text DEFAULT '' NOT NULL,
	"current_role_ambiguous" boolean DEFAULT false NOT NULL,
	"last_lusha_enrichment" text DEFAULT '' NOT NULL,
	"email_source" text DEFAULT '' NOT NULL,
	"phone_source" text DEFAULT '' NOT NULL,
	"email_retrieved_at" text DEFAULT '' NOT NULL,
	"phone_retrieved_at" text DEFAULT '' NOT NULL,
	"professional_data_status" text DEFAULT 'Needs assessment' NOT NULL,
	"professional_data_note" text DEFAULT '' NOT NULL,
	"verified_label" text DEFAULT 'Not yet verified' NOT NULL,
	"intake_status" text DEFAULT 'REVIEW_REQUIRED' NOT NULL,
	"outreach_status" text DEFAULT 'Not contacted' NOT NULL,
	"note" text DEFAULT 'No placement context recorded.' NOT NULL,
	"hiring_influence" text DEFAULT 'Unknown / Not assessed' NOT NULL,
	"iiml_relationship" text DEFAULT 'Unknown / Not assessed' NOT NULL,
	"warm_intro_potential" text DEFAULT 'Unknown / Not assessed' NOT NULL,
	"profile_match" text DEFAULT 'Unverified' NOT NULL,
	"current_company_verification" text DEFAULT 'Unverified' NOT NULL,
	"designation_verification" text DEFAULT 'Unverified' NOT NULL,
	"email_verification" text DEFAULT 'Unverified' NOT NULL,
	"phone_verification" text DEFAULT 'Unverified' NOT NULL,
	"location_verification" text DEFAULT 'Unverified' NOT NULL,
	"source" text DEFAULT 'Manual import' NOT NULL,
	"record_version" integer DEFAULT 1 NOT NULL,
	"last_mutation_request_key" text DEFAULT '' NOT NULL,
	"updated_by" text DEFAULT 'System' NOT NULL,
	"created_at" text DEFAULT to_char(timezone('UTC', CURRENT_TIMESTAMP), 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	"updated_at" text DEFAULT to_char(timezone('UTC', CURRENT_TIMESTAMP), 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alumni_data_lifecycle" (
	"id" serial PRIMARY KEY NOT NULL,
	"alumnus_id" integer NOT NULL,
	"status" text DEFAULT 'Active' NOT NULL,
	"deletion_requested_at" text DEFAULT '' NOT NULL,
	"archived_at" text DEFAULT '' NOT NULL,
	"anonymized_at" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"updated_by" text DEFAULT 'System' NOT NULL,
	"updated_at" text DEFAULT to_char(timezone('UTC', CURRENT_TIMESTAMP), 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alumni_employment_evidence" (
	"id" serial PRIMARY KEY NOT NULL,
	"alumnus_id" integer,
	"discovery_result_id" integer,
	"evidence_source" text NOT NULL,
	"provider_employee_id" text DEFAULT '' NOT NULL,
	"provider_response_id" integer,
	"stable_company_id" text DEFAULT '' NOT NULL,
	"original_company_name" text NOT NULL,
	"original_job_title" text NOT NULL,
	"normalized_job_title" text DEFAULT '' NOT NULL,
	"start_date" text DEFAULT '' NOT NULL,
	"end_date" text DEFAULT '' NOT NULL,
	"is_current" boolean DEFAULT false NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"observed_at" text NOT NULL,
	"evidence_version" text DEFAULT '1' NOT NULL,
	"verification_status" text DEFAULT 'UNVERIFIED' NOT NULL,
	"reviewer_status" text DEFAULT 'PENDING' NOT NULL,
	"created_at" text DEFAULT to_char(timezone('UTC', CURRENT_TIMESTAMP), 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alumni_privacy_controls" (
	"id" serial PRIMARY KEY NOT NULL,
	"alumnus_id" integer NOT NULL,
	"general_contact_status" text DEFAULT 'Unknown' NOT NULL,
	"professional_engagement_status" text DEFAULT 'Unknown' NOT NULL,
	"birthday_engagement_status" text DEFAULT 'Unknown' NOT NULL,
	"consent_source" text DEFAULT 'Unknown' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"updated_by" text DEFAULT 'System' NOT NULL,
	"updated_at" text DEFAULT to_char(timezone('UTC', CURRENT_TIMESTAMP), 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alumni_profile_change_proposals" (
	"id" serial PRIMARY KEY NOT NULL,
	"alumnus_id" integer NOT NULL,
	"field" text NOT NULL,
	"old_value" text DEFAULT '' NOT NULL,
	"proposed_value" text DEFAULT '' NOT NULL,
	"source" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"expected_record_version" integer NOT NULL,
	"proposed_by" text NOT NULL,
	"reviewed_by" text DEFAULT '' NOT NULL,
	"reviewed_at" text DEFAULT '' NOT NULL,
	"review_note" text DEFAULT '' NOT NULL,
	"mutation_request_key" text DEFAULT '' NOT NULL,
	"decision_mutation_request_key" text DEFAULT '' NOT NULL,
	"created_at" text DEFAULT to_char(timezone('UTC', CURRENT_TIMESTAMP), 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	CONSTRAINT "profile_change_proposal_status_check" CHECK ("alumni_profile_change_proposals"."status" in ('PENDING', 'ACCEPTED', 'REJECTED'))
);
--> statement-breakpoint
CREATE TABLE "alumni_relationships" (
	"id" serial PRIMARY KEY NOT NULL,
	"intermediary_alumnus_id" integer NOT NULL,
	"target_alumnus_id" integer NOT NULL,
	"relationship_type" text NOT NULL,
	"evidence" text NOT NULL,
	"confirmed" boolean DEFAULT false NOT NULL,
	"successful_introductions" integer DEFAULT 0 NOT NULL,
	"source" text DEFAULT 'Manual confirmation' NOT NULL,
	"updated_by" text DEFAULT 'System' NOT NULL,
	"updated_at" text DEFAULT to_char(timezone('UTC', CURRENT_TIMESTAMP), 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alumni_source_observations" (
	"id" serial PRIMARY KEY NOT NULL,
	"alumnus_id" integer NOT NULL,
	"mutation_request_key" text NOT NULL,
	"source_row_key" text NOT NULL,
	"filename" text NOT NULL,
	"source_system" text NOT NULL,
	"source_date" text DEFAULT '' NOT NULL,
	"observed_json" text DEFAULT '{}' NOT NULL,
	"imported_by" text NOT NULL,
	"created_at" text DEFAULT to_char(timezone('UTC', CURRENT_TIMESTAMP), 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "application_identities" (
	"id" serial PRIMARY KEY NOT NULL,
	"application_user_id" integer NOT NULL,
	"provider" text NOT NULL,
	"provider_subject_id" text NOT NULL,
	"verified_email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"provider_domain" text DEFAULT '' NOT NULL,
	"created_at" text DEFAULT to_char(timezone('UTC', CURRENT_TIMESTAMP), 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	"updated_at" text DEFAULT to_char(timezone('UTC', CURRENT_TIMESTAMP), 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	"last_authenticated_at" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "application_users" (
	"id" serial PRIMARY KEY NOT NULL,
	"external_identity" text DEFAULT '' NOT NULL,
	"display_name" text NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" text DEFAULT to_char(timezone('UTC', CURRENT_TIMESTAMP), 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	"updated_at" text DEFAULT to_char(timezone('UTC', CURRENT_TIMESTAMP), 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	"last_login_at" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "birthday_data" (
	"id" serial PRIMARY KEY NOT NULL,
	"alumnus_id" integer NOT NULL,
	"birth_month_day" text NOT NULL,
	"full_birth_date" text DEFAULT '' NOT NULL,
	"source" text NOT NULL,
	"status" text NOT NULL,
	"last_verified_at" text DEFAULT '' NOT NULL,
	"last_updated_by" text DEFAULT 'System' NOT NULL,
	"updated_at" text DEFAULT to_char(timezone('UTC', CURRENT_TIMESTAMP), 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brightdata_snapshot_evidence" (
	"attempt_id" integer PRIMARY KEY NOT NULL,
	"provider" text DEFAULT 'brightdata' NOT NULL,
	"snapshot_id" text NOT NULL,
	"dataset_id" text NOT NULL,
	"requested_url" text NOT NULL,
	"returned_url" text DEFAULT '' NOT NULL,
	"canonical_returned_url" text DEFAULT '' NOT NULL,
	"identity_url_status" text DEFAULT 'UNVERIFIED' NOT NULL,
	"requested_at" text NOT NULL,
	"retrieved_at" text NOT NULL,
	"provider_timestamp_json" text DEFAULT '' NOT NULL,
	"normalizer_version" integer NOT NULL,
	"raw_json" text NOT NULL,
	"raw_sha256" text NOT NULL,
	"normalized_json" text NOT NULL,
	"retention_until" text NOT NULL,
	"created_at" text DEFAULT to_char(timezone('UTC', CURRENT_TIMESTAMP), 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	CONSTRAINT "brightdata_snapshot_identity_status_check" CHECK ("brightdata_snapshot_evidence"."identity_url_status" in ('MATCH', 'MISMATCH', 'UNVERIFIED'))
);
--> statement-breakpoint
CREATE TABLE "communication_preferences" (
	"id" serial PRIMARY KEY NOT NULL,
	"alumnus_id" integer NOT NULL,
	"engagement_type" text DEFAULT 'All' NOT NULL,
	"status" text DEFAULT 'Unknown' NOT NULL,
	"source" text DEFAULT 'Not recorded' NOT NULL,
	"updated_by" text DEFAULT 'System' NOT NULL,
	"updated_at" text DEFAULT to_char(timezone('UTC', CURRENT_TIMESTAMP), 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_priorities" (
	"company" text PRIMARY KEY NOT NULL,
	"priority" text NOT NULL,
	"updated_by" text DEFAULT 'System' NOT NULL,
	"updated_at" text DEFAULT to_char(timezone('UTC', CURRENT_TIMESTAMP), 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coresignal_webhook_coverage" (
	"id" serial PRIMARY KEY NOT NULL,
	"subscription_id" integer NOT NULL,
	"alumnus_id" integer NOT NULL,
	"employee_id" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" text DEFAULT to_char(timezone('UTC', CURRENT_TIMESTAMP), 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coresignal_webhook_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider" text DEFAULT 'coresignal' NOT NULL,
	"dataset" text DEFAULT 'employee_base_experience' NOT NULL,
	"source_provenance" text DEFAULT 'Base Employee Experience webhook' NOT NULL,
	"subscription_id" integer NOT NULL,
	"alumnus_id" integer,
	"employee_id" text NOT NULL,
	"change_type" text NOT NULL,
	"changed_fields_json" text DEFAULT '[]' NOT NULL,
	"provider_at" text DEFAULT '' NOT NULL,
	"received_at" text DEFAULT to_char(timezone('UTC', CURRENT_TIMESTAMP), 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	"payload_digest" text NOT NULL,
	"dedupe_window" text NOT NULL,
	"status" text NOT NULL,
	"review_outcome" text DEFAULT '' NOT NULL,
	"error_state" text DEFAULT '' NOT NULL,
	"collect_history_id" integer
);
--> statement-breakpoint
CREATE TABLE "coresignal_webhook_identities" (
	"id" serial PRIMARY KEY NOT NULL,
	"alumnus_id" integer NOT NULL,
	"employee_id" text NOT NULL,
	"namespace" text DEFAULT 'employee_base' NOT NULL,
	"status" text DEFAULT 'VERIFIED' NOT NULL,
	"evidence_reference" text NOT NULL,
	"verified_by" text NOT NULL,
	"verified_at" text DEFAULT to_char(timezone('UTC', CURRENT_TIMESTAMP), 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coresignal_webhook_operations" (
	"id" serial PRIMARY KEY NOT NULL,
	"subscription_id" integer NOT NULL,
	"action" text NOT NULL,
	"request_key" text NOT NULL,
	"actor" text NOT NULL,
	"status" text NOT NULL,
	"request_json" text DEFAULT '{}' NOT NULL,
	"response_json" text DEFAULT '{}' NOT NULL,
	"created_at" text DEFAULT to_char(timezone('UTC', CURRENT_TIMESTAMP), 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	"updated_at" text DEFAULT to_char(timezone('UTC', CURRENT_TIMESTAMP), 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coresignal_webhook_subscriptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"cohort_type" text NOT NULL,
	"selection_json" text NOT NULL,
	"selection_version" text NOT NULL,
	"membership_json" text NOT NULL,
	"provider_subscription_id" text DEFAULT '' NOT NULL,
	"provider_mode" text DEFAULT 'mock' NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" text DEFAULT to_char(timezone('UTC', CURRENT_TIMESTAMP), 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	"activated_at" text DEFAULT '' NOT NULL,
	"expires_at" text DEFAULT '' NOT NULL,
	"last_reconciled_at" text DEFAULT '' NOT NULL,
	"last_error" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "corporate_opportunities" (
	"id" serial PRIMARY KEY NOT NULL,
	"opportunity_key" text NOT NULL,
	"company" text NOT NULL,
	"alumnus_id" integer,
	"engagement_id" integer,
	"owner_user_id" integer NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"stage" text DEFAULT 'IDENTIFIED' NOT NULL,
	"next_action" text DEFAULT '' NOT NULL,
	"follow_up_date" text DEFAULT '' NOT NULL,
	"outcome" text DEFAULT '' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by_user_id" integer NOT NULL,
	"last_updated_by_user_id" integer NOT NULL,
	"created_at" text DEFAULT to_char(timezone('UTC', CURRENT_TIMESTAMP), 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	"updated_at" text DEFAULT to_char(timezone('UTC', CURRENT_TIMESTAMP), 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	CONSTRAINT "corporate_opportunity_company_check" CHECK (length(trim("corporate_opportunities"."company")) > 0),
	CONSTRAINT "corporate_opportunity_title_check" CHECK (length(trim("corporate_opportunities"."title")) > 0),
	CONSTRAINT "corporate_opportunity_version_check" CHECK ("corporate_opportunities"."version" > 0),
	CONSTRAINT "corporate_opportunity_stage_check" CHECK ("corporate_opportunities"."stage" in ('IDENTIFIED', 'QUALIFYING', 'OUTREACH_IN_PROGRESS', 'IN_DISCUSSION', 'CONFIRMED', 'ON_HOLD', 'CLOSED_LOST')),
	CONSTRAINT "corporate_opportunity_outcome_check" CHECK ("corporate_opportunities"."stage" not in ('CONFIRMED', 'CLOSED_LOST') or length(trim("corporate_opportunities"."outcome")) > 0)
);
--> statement-breakpoint
CREATE TABLE "corporate_opportunity_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"opportunity_id" integer NOT NULL,
	"actor_user_id" integer NOT NULL,
	"action" text NOT NULL,
	"from_stage" text DEFAULT '' NOT NULL,
	"to_stage" text DEFAULT '' NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"changes_json" text DEFAULT '{}' NOT NULL,
	"created_at" text DEFAULT to_char(timezone('UTC', CURRENT_TIMESTAMP), 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "engagement_actions" (
	"id" serial PRIMARY KEY NOT NULL,
	"action_key" text NOT NULL,
	"event_id" integer NOT NULL,
	"alumnus_id" integer NOT NULL,
	"action_type" text NOT NULL,
	"channel" text NOT NULL,
	"performed_by" text NOT NULL,
	"performed_at" text DEFAULT to_char(timezone('UTC', CURRENT_TIMESTAMP), 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	"template_id" integer,
	"subject" text DEFAULT '' NOT NULL,
	"message_summary" text DEFAULT '' NOT NULL,
	"external_message_id" text DEFAULT '' NOT NULL,
	"delivery_status" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"sender" text DEFAULT '' NOT NULL,
	"recipient" text DEFAULT '' NOT NULL,
	"purpose" text DEFAULT '' NOT NULL,
	"template_version" integer DEFAULT 1 NOT NULL,
	"approved_by" text DEFAULT '' NOT NULL,
	"approved_at" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "engagement_audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_id" integer NOT NULL,
	"action" text NOT NULL,
	"actor" text NOT NULL,
	"details" text DEFAULT '' NOT NULL,
	"created_at" text DEFAULT to_char(timezone('UTC', CURRENT_TIMESTAMP), 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "engagement_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_key" text NOT NULL,
	"alumnus_id" integer NOT NULL,
	"company" text DEFAULT '' NOT NULL,
	"event_type" text NOT NULL,
	"event_subtype" text DEFAULT '' NOT NULL,
	"event_title" text NOT NULL,
	"event_description" text DEFAULT '' NOT NULL,
	"source" text NOT NULL,
	"source_reference_id" text DEFAULT '' NOT NULL,
	"source_detected_date" text DEFAULT '' NOT NULL,
	"provider_event_at" text DEFAULT '' NOT NULL,
	"previous_company" text DEFAULT '' NOT NULL,
	"previous_role" text DEFAULT '' NOT NULL,
	"new_company" text DEFAULT '' NOT NULL,
	"new_role" text DEFAULT '' NOT NULL,
	"source_confidence" text DEFAULT 'Unknown' NOT NULL,
	"source_status" text DEFAULT 'Unreviewed' NOT NULL,
	"event_date" text NOT NULL,
	"status" text DEFAULT 'New' NOT NULL,
	"first_viewed_at" text DEFAULT '' NOT NULL,
	"last_viewed_by" text DEFAULT '' NOT NULL,
	"acknowledged_at" text DEFAULT '' NOT NULL,
	"assigned_to" text DEFAULT '' NOT NULL,
	"assigned_at" text DEFAULT '' NOT NULL,
	"action_planned_at" text DEFAULT '' NOT NULL,
	"action_taken_at" text DEFAULT '' NOT NULL,
	"action_taken_by" text DEFAULT '' NOT NULL,
	"action_type" text DEFAULT '' NOT NULL,
	"action_channel" text DEFAULT '' NOT NULL,
	"message_template_id" integer,
	"message_subject" text DEFAULT '' NOT NULL,
	"message_summary" text DEFAULT '' NOT NULL,
	"provider_message_id" text DEFAULT '' NOT NULL,
	"delivery_status" text DEFAULT '' NOT NULL,
	"response_received" boolean DEFAULT false NOT NULL,
	"response_received_at" text DEFAULT '' NOT NULL,
	"response_type" text DEFAULT '' NOT NULL,
	"follow_up_required" boolean DEFAULT false NOT NULL,
	"follow_up_date" text DEFAULT '' NOT NULL,
	"response_notes" text DEFAULT '' NOT NULL,
	"closed_at" text DEFAULT '' NOT NULL,
	"skipped_at" text DEFAULT '' NOT NULL,
	"skip_reason" text DEFAULT '' NOT NULL,
	"created_by" text DEFAULT 'System' NOT NULL,
	"last_updated_by" text DEFAULT 'System' NOT NULL,
	"created_at" text DEFAULT to_char(timezone('UTC', CURRENT_TIMESTAMP), 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	"last_updated_at" text DEFAULT to_char(timezone('UTC', CURRENT_TIMESTAMP), 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "engagement_responses" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_id" integer NOT NULL,
	"response_type" text NOT NULL,
	"received_at" text NOT NULL,
	"recorded_by" text NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"follow_up_required" boolean DEFAULT false NOT NULL,
	"follow_up_date" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_views" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"viewed_at" text DEFAULT to_char(timezone('UTC', CURRENT_TIMESTAMP), 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "external_discovery_candidate_evidence" (
	"id" serial PRIMARY KEY NOT NULL,
	"search_id" integer NOT NULL,
	"result_id" integer NOT NULL,
	"provider" text NOT NULL,
	"provider_person_id" text NOT NULL,
	"source_type" text NOT NULL,
	"source_url" text NOT NULL,
	"source_provenance" text NOT NULL,
	"profile_url" text DEFAULT '' NOT NULL,
	"observed_institution" text DEFAULT '' NOT NULL,
	"education_start_year" integer,
	"education_end_year" integer,
	"graduation_year" integer,
	"programme" text DEFAULT '' NOT NULL,
	"current_company" text DEFAULT '' NOT NULL,
	"current_designation" text DEFAULT '' NOT NULL,
	"seniority" text DEFAULT '' NOT NULL,
	"location" text DEFAULT '' NOT NULL,
	"decisions_json" text NOT NULL,
	"reviewer_decision" text NOT NULL,
	"verification_reason" text NOT NULL,
	"reviewer_user_id" integer NOT NULL,
	"reviewer_name" text NOT NULL,
	"request_key" text NOT NULL,
	"reviewed_at" text NOT NULL,
	CONSTRAINT "external_candidate_evidence_decision_check" CHECK ("external_discovery_candidate_evidence"."reviewer_decision" in ('SUPPORTS', 'REJECTS', 'INSUFFICIENT'))
);
--> statement-breakpoint
CREATE TABLE "external_discovery_results" (
	"id" serial PRIMARY KEY NOT NULL,
	"search_id" integer NOT NULL,
	"provider" text DEFAULT 'pdl' NOT NULL,
	"provider_result_id" text NOT NULL,
	"name" text NOT NULL,
	"education" text NOT NULL,
	"current_company" text NOT NULL,
	"role" text NOT NULL,
	"raw_title" text DEFAULT '' NOT NULL,
	"function" text NOT NULL,
	"seniority" text NOT NULL,
	"location" text NOT NULL,
	"graduation_year" integer DEFAULT 0 NOT NULL,
	"linkedin_url" text DEFAULT '' NOT NULL,
	"provider_person_id" text DEFAULT '' NOT NULL,
	"affiliation_status" text DEFAULT 'Potential alumnus — review required' NOT NULL,
	"education_programme" text DEFAULT '' NOT NULL,
	"education_start_date" text DEFAULT '' NOT NULL,
	"education_end_date" text DEFAULT '' NOT NULL,
	"institution_id" text DEFAULT '' NOT NULL,
	"institution_url" text DEFAULT '' NOT NULL,
	"current_company_id" text DEFAULT '' NOT NULL,
	"current_company_url" text DEFAULT '' NOT NULL,
	"current_role_start_date" text DEFAULT '' NOT NULL,
	"current_industry" text DEFAULT '' NOT NULL,
	"current_role_ambiguous" boolean DEFAULT false NOT NULL,
	"provider_freshness_at" text DEFAULT '' NOT NULL,
	"match_status" text NOT NULL,
	"match_confidence" integer DEFAULT 50 NOT NULL,
	"linked_internal_alumnus_id" integer,
	"review_status" text DEFAULT 'Pending review' NOT NULL,
	"review_note" text DEFAULT '' NOT NULL,
	"created_at" text DEFAULT to_char(timezone('UTC', CURRENT_TIMESTAMP), 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	"reviewed_at" text DEFAULT '' NOT NULL,
	"reviewed_by" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "external_discovery_searches" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider" text DEFAULT 'pdl' NOT NULL,
	"filters_json" text NOT NULL,
	"criteria_summary" text NOT NULL,
	"requested_count" integer DEFAULT 0 NOT NULL,
	"result_count" integer DEFAULT 0 NOT NULL,
	"existing_count" integer DEFAULT 0 NOT NULL,
	"new_count" integer DEFAULT 0 NOT NULL,
	"duplicate_count" integer DEFAULT 0 NOT NULL,
	"credits_used" integer DEFAULT 0 NOT NULL,
	"mode" text NOT NULL,
	"initiated_by" text NOT NULL,
	"created_at" text DEFAULT to_char(timezone('UTC', CURRENT_TIMESTAMP), 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "field_change_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"alumnus_id" integer NOT NULL,
	"field" text NOT NULL,
	"old_value" text DEFAULT '' NOT NULL,
	"new_value" text DEFAULT '' NOT NULL,
	"source" text NOT NULL,
	"provider_action" text DEFAULT '' NOT NULL,
	"credits_charged" integer DEFAULT 0 NOT NULL,
	"initiated_by" text NOT NULL,
	"mutation_request_key" text DEFAULT '' NOT NULL,
	"created_at" text DEFAULT to_char(timezone('UTC', CURRENT_TIMESTAMP), 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"filename" text NOT NULL,
	"row_count" integer NOT NULL,
	"imported_by" text NOT NULL,
	"mutation_request_key" text DEFAULT '' NOT NULL,
	"created_at" text DEFAULT to_char(timezone('UTC', CURRENT_TIMESTAMP), 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"template_key" text NOT NULL,
	"name" text NOT NULL,
	"event_type" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"status" text DEFAULT 'Approved' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text DEFAULT 'System' NOT NULL,
	"updated_at" text DEFAULT to_char(timezone('UTC', CURRENT_TIMESTAMP), 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mutation_commit_guards" (
	"id" serial PRIMARY KEY NOT NULL,
	"request_key" text NOT NULL,
	"alumnus_id" integer NOT NULL,
	"operation" text NOT NULL,
	"valid" integer NOT NULL,
	"created_at" text DEFAULT to_char(timezone('UTC', CURRENT_TIMESTAMP), 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	CONSTRAINT "mutation_commit_guard_valid_check" CHECK ("mutation_commit_guards"."valid" = 1)
);
--> statement-breakpoint
CREATE TABLE "mutation_request_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"request_key" text NOT NULL,
	"item_key" text NOT NULL,
	"status" text DEFAULT 'COMPLETED' NOT NULL,
	"outcome_json" text DEFAULT '{}' NOT NULL,
	"completed_at" text DEFAULT to_char(timezone('UTC', CURRENT_TIMESTAMP), 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	CONSTRAINT "mutation_request_item_status_check" CHECK ("mutation_request_items"."status" in ('COMPLETED', 'FAILED'))
);
--> statement-breakpoint
CREATE TABLE "mutation_requests" (
	"request_key" text PRIMARY KEY NOT NULL,
	"client_key_hash" text NOT NULL,
	"actor_user_id" integer NOT NULL,
	"operation_type" text NOT NULL,
	"target_key" text NOT NULL,
	"payload_hash" text NOT NULL,
	"status" text DEFAULT 'IN_PROGRESS' NOT NULL,
	"attempt_count" integer DEFAULT 1 NOT NULL,
	"lease_expires_at" text DEFAULT '' NOT NULL,
	"http_status" integer DEFAULT 0 NOT NULL,
	"response_json" text DEFAULT '' NOT NULL,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" text DEFAULT to_char(timezone('UTC', CURRENT_TIMESTAMP), 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	"updated_at" text DEFAULT to_char(timezone('UTC', CURRENT_TIMESTAMP), 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	CONSTRAINT "mutation_request_status_check" CHECK ("mutation_requests"."status" in ('IN_PROGRESS', 'COMPLETED', 'FAILED'))
);
--> statement-breakpoint
CREATE TABLE "programme_options" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"updated_by" text DEFAULT 'System' NOT NULL,
	"created_at" text DEFAULT to_char(timezone('UTC', CURRENT_TIMESTAMP), 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	"updated_at" text DEFAULT to_char(timezone('UTC', CURRENT_TIMESTAMP), 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_collection_attempts" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"operation" text NOT NULL,
	"actor_user_id" integer NOT NULL,
	"alumnus_id" integer,
	"target_reference" text NOT NULL,
	"target_fingerprint" text NOT NULL,
	"request_key" text NOT NULL,
	"dataset_id" text DEFAULT '' NOT NULL,
	"provider_job_id" text DEFAULT '' NOT NULL,
	"attempt_count" integer DEFAULT 1 NOT NULL,
	"generation" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'CLAIMED' NOT NULL,
	"last_status_check_at" text DEFAULT '' NOT NULL,
	"completed_at" text DEFAULT '' NOT NULL,
	"error_category" text DEFAULT '' NOT NULL,
	"result_provider_history_id" integer,
	"evidence_json" text DEFAULT '' NOT NULL,
	"usage_state" text DEFAULT 'not_applicable' NOT NULL,
	"provider_reported_usage" integer,
	"created_at" text DEFAULT to_char(timezone('UTC', CURRENT_TIMESTAMP), 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	"updated_at" text DEFAULT to_char(timezone('UTC', CURRENT_TIMESTAMP), 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	CONSTRAINT "provider_collection_attempt_count_check" CHECK ("provider_collection_attempts"."attempt_count" = 1),
	CONSTRAINT "provider_collection_generation_check" CHECK ("provider_collection_attempts"."generation" > 0),
	CONSTRAINT "provider_collection_status_check" CHECK ("provider_collection_attempts"."status" in ('CLAIMED', 'TRIGGER_IN_PROGRESS', 'SNAPSHOT_PENDING', 'SNAPSHOT_RUNNING', 'SNAPSHOT_READY', 'RESULT_RETRIEVED', 'EVIDENCE_STORED', 'REVIEW_REQUIRED', 'FAILED_BEFORE_TRIGGER', 'TRIGGER_OUTCOME_UNKNOWN', 'FAILED_AFTER_TRIGGER', 'BLOCKED'))
);
--> statement-breakpoint
CREATE TABLE "provider_company_aliases" (
	"id" serial PRIMARY KEY NOT NULL,
	"mapping_id" integer NOT NULL,
	"normalized_alias" text NOT NULL,
	"display_alias" text NOT NULL,
	"status" text DEFAULT 'VERIFIED' NOT NULL,
	"verified_by" text NOT NULL,
	"verified_at" text NOT NULL,
	"created_at" text DEFAULT to_char(timezone('UTC', CURRENT_TIMESTAMP), 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	CONSTRAINT "provider_company_alias_status_check" CHECK ("provider_company_aliases"."status" in ('VERIFIED', 'CONFLICT'))
);
--> statement-breakpoint
CREATE TABLE "provider_company_mappings" (
	"id" serial PRIMARY KEY NOT NULL,
	"normalized_company_key" text NOT NULL,
	"display_name" text NOT NULL,
	"provider" text NOT NULL,
	"provider_company_id" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'UNVERIFIED' NOT NULL,
	"mapping_source" text DEFAULT '' NOT NULL,
	"evidence_reference" text DEFAULT '' NOT NULL,
	"provider_source_id" text DEFAULT '' NOT NULL,
	"provider_company_url" text DEFAULT '' NOT NULL,
	"verified_by" text DEFAULT '' NOT NULL,
	"verified_at" text DEFAULT '' NOT NULL,
	"created_at" text DEFAULT to_char(timezone('UTC', CURRENT_TIMESTAMP), 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	"updated_at" text DEFAULT to_char(timezone('UTC', CURRENT_TIMESTAMP), 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	CONSTRAINT "provider_company_mapping_status_check" CHECK ("provider_company_mappings"."status" in ('VERIFIED', 'UNVERIFIED', 'CONFLICT')),
	CONSTRAINT "provider_company_mapping_identity_check" CHECK (length(trim("provider_company_mappings"."normalized_company_key")) > 0 and length(trim("provider_company_mappings"."display_name")) > 0 and length(trim("provider_company_mappings"."provider")) > 0),
	CONSTRAINT "provider_company_mapping_verified_check" CHECK ("provider_company_mappings"."status" != 'VERIFIED' or (length(trim("provider_company_mappings"."provider_company_id")) > 0 and length(trim("provider_company_mappings"."verified_by")) > 0 and length(trim("provider_company_mappings"."verified_at")) > 0))
);
--> statement-breakpoint
CREATE TABLE "provider_refresh_reviews" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider_response_id" integer NOT NULL,
	"alumnus_id" integer NOT NULL,
	"proposed_changes_json" text DEFAULT '[]' NOT NULL,
	"status" text DEFAULT 'Pending review' NOT NULL,
	"requested_by" text NOT NULL,
	"reviewed_by" text DEFAULT '' NOT NULL,
	"created_at" text DEFAULT to_char(timezone('UTC', CURRENT_TIMESTAMP), 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	"reviewed_at" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_response_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"alumnus_id" integer,
	"alumnus_name" text NOT NULL,
	"search_id" integer,
	"operation" text NOT NULL,
	"mode" text NOT NULL,
	"status" text NOT NULL,
	"credits_used" integer DEFAULT 0 NOT NULL,
	"application_units" integer DEFAULT 0 NOT NULL,
	"provider_reported_credits" integer,
	"usage_state" text DEFAULT 'not_applicable' NOT NULL,
	"reconciled_credits" integer,
	"reconciliation_source" text DEFAULT '' NOT NULL,
	"reconciled_by" text DEFAULT '' NOT NULL,
	"reconciled_at" text DEFAULT '' NOT NULL,
	"result_count" integer DEFAULT 0 NOT NULL,
	"request_summary" text DEFAULT '' NOT NULL,
	"response_summary" text DEFAULT '' NOT NULL,
	"error_message" text DEFAULT '' NOT NULL,
	"requested_by" text DEFAULT 'Public workspace user' NOT NULL,
	"created_at" text DEFAULT to_char(timezone('UTC', CURRENT_TIMESTAMP), 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_settings" (
	"provider" text PRIMARY KEY NOT NULL,
	"monthly_credit_limit" integer NOT NULL,
	"updated_at" text DEFAULT to_char(timezone('UTC', CURRENT_TIMESTAMP), 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provisional_alumni_intakes" (
	"id" serial PRIMARY KEY NOT NULL,
	"alumnus_id" integer NOT NULL,
	"discovery_result_id" integer NOT NULL,
	"search_id" integer NOT NULL,
	"provider" text NOT NULL,
	"provider_person_id" text NOT NULL,
	"source_profile_url" text NOT NULL,
	"normalized_profile_key" text NOT NULL,
	"provider_observations_json" text NOT NULL,
	"query_constraints_json" text NOT NULL,
	"verification_state_json" text NOT NULL,
	"intake_actor_user_id" integer NOT NULL,
	"intake_actor_name" text NOT NULL,
	"created_at" text DEFAULT to_char(timezone('UTC', CURRENT_TIMESTAMP), 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	CONSTRAINT "provisional_intake_provider_check" CHECK ("provisional_alumni_intakes"."provider" = 'coresignal')
);
--> statement-breakpoint
CREATE TABLE "security_audit_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"actor_user_id" integer,
	"actor_identity" text DEFAULT 'System' NOT NULL,
	"actor_name" text DEFAULT 'System' NOT NULL,
	"actor_role" text DEFAULT 'SYSTEM' NOT NULL,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text DEFAULT '' NOT NULL,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"result" text DEFAULT 'success' NOT NULL,
	"source" text DEFAULT 'application' NOT NULL,
	"mutation_request_key" text DEFAULT '' NOT NULL,
	"created_at" text DEFAULT to_char(timezone('UTC', CURRENT_TIMESTAMP), 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
ALTER TABLE "alumni_data_lifecycle" ADD CONSTRAINT "alumni_data_lifecycle_alumnus_id_alumni_id_fk" FOREIGN KEY ("alumnus_id") REFERENCES "public"."alumni"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alumni_employment_evidence" ADD CONSTRAINT "alumni_employment_evidence_alumnus_id_alumni_id_fk" FOREIGN KEY ("alumnus_id") REFERENCES "public"."alumni"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alumni_privacy_controls" ADD CONSTRAINT "alumni_privacy_controls_alumnus_id_alumni_id_fk" FOREIGN KEY ("alumnus_id") REFERENCES "public"."alumni"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alumni_profile_change_proposals" ADD CONSTRAINT "alumni_profile_change_proposals_alumnus_id_alumni_id_fk" FOREIGN KEY ("alumnus_id") REFERENCES "public"."alumni"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alumni_relationships" ADD CONSTRAINT "alumni_relationships_intermediary_alumnus_id_alumni_id_fk" FOREIGN KEY ("intermediary_alumnus_id") REFERENCES "public"."alumni"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alumni_relationships" ADD CONSTRAINT "alumni_relationships_target_alumnus_id_alumni_id_fk" FOREIGN KEY ("target_alumnus_id") REFERENCES "public"."alumni"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alumni_source_observations" ADD CONSTRAINT "alumni_source_observations_alumnus_id_alumni_id_fk" FOREIGN KEY ("alumnus_id") REFERENCES "public"."alumni"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_identities" ADD CONSTRAINT "application_identities_application_user_id_application_users_id_fk" FOREIGN KEY ("application_user_id") REFERENCES "public"."application_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "birthday_data" ADD CONSTRAINT "birthday_data_alumnus_id_alumni_id_fk" FOREIGN KEY ("alumnus_id") REFERENCES "public"."alumni"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brightdata_snapshot_evidence" ADD CONSTRAINT "brightdata_snapshot_evidence_attempt_id_provider_collection_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."provider_collection_attempts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communication_preferences" ADD CONSTRAINT "communication_preferences_alumnus_id_alumni_id_fk" FOREIGN KEY ("alumnus_id") REFERENCES "public"."alumni"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coresignal_webhook_coverage" ADD CONSTRAINT "coresignal_webhook_coverage_subscription_id_coresignal_webhook_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."coresignal_webhook_subscriptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coresignal_webhook_coverage" ADD CONSTRAINT "coresignal_webhook_coverage_alumnus_id_alumni_id_fk" FOREIGN KEY ("alumnus_id") REFERENCES "public"."alumni"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coresignal_webhook_events" ADD CONSTRAINT "coresignal_webhook_events_subscription_id_coresignal_webhook_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."coresignal_webhook_subscriptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coresignal_webhook_events" ADD CONSTRAINT "coresignal_webhook_events_alumnus_id_alumni_id_fk" FOREIGN KEY ("alumnus_id") REFERENCES "public"."alumni"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coresignal_webhook_events" ADD CONSTRAINT "coresignal_webhook_events_collect_history_id_provider_response_history_id_fk" FOREIGN KEY ("collect_history_id") REFERENCES "public"."provider_response_history"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coresignal_webhook_identities" ADD CONSTRAINT "coresignal_webhook_identities_alumnus_id_alumni_id_fk" FOREIGN KEY ("alumnus_id") REFERENCES "public"."alumni"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coresignal_webhook_operations" ADD CONSTRAINT "coresignal_webhook_operations_subscription_id_coresignal_webhook_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."coresignal_webhook_subscriptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corporate_opportunities" ADD CONSTRAINT "corporate_opportunities_alumnus_id_alumni_id_fk" FOREIGN KEY ("alumnus_id") REFERENCES "public"."alumni"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corporate_opportunities" ADD CONSTRAINT "corporate_opportunities_engagement_id_engagement_events_id_fk" FOREIGN KEY ("engagement_id") REFERENCES "public"."engagement_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corporate_opportunities" ADD CONSTRAINT "corporate_opportunities_owner_user_id_application_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."application_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corporate_opportunities" ADD CONSTRAINT "corporate_opportunities_created_by_user_id_application_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."application_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corporate_opportunities" ADD CONSTRAINT "corporate_opportunities_last_updated_by_user_id_application_users_id_fk" FOREIGN KEY ("last_updated_by_user_id") REFERENCES "public"."application_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corporate_opportunity_history" ADD CONSTRAINT "corporate_opportunity_history_opportunity_id_corporate_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."corporate_opportunities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corporate_opportunity_history" ADD CONSTRAINT "corporate_opportunity_history_actor_user_id_application_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."application_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement_actions" ADD CONSTRAINT "engagement_actions_event_id_engagement_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."engagement_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement_actions" ADD CONSTRAINT "engagement_actions_alumnus_id_alumni_id_fk" FOREIGN KEY ("alumnus_id") REFERENCES "public"."alumni"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement_actions" ADD CONSTRAINT "engagement_actions_template_id_message_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."message_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement_audit_log" ADD CONSTRAINT "engagement_audit_log_event_id_engagement_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."engagement_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement_events" ADD CONSTRAINT "engagement_events_alumnus_id_alumni_id_fk" FOREIGN KEY ("alumnus_id") REFERENCES "public"."alumni"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement_events" ADD CONSTRAINT "engagement_events_message_template_id_message_templates_id_fk" FOREIGN KEY ("message_template_id") REFERENCES "public"."message_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement_responses" ADD CONSTRAINT "engagement_responses_event_id_engagement_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."engagement_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_views" ADD CONSTRAINT "event_views_event_id_engagement_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."engagement_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_discovery_candidate_evidence" ADD CONSTRAINT "external_discovery_candidate_evidence_search_id_external_discovery_searches_id_fk" FOREIGN KEY ("search_id") REFERENCES "public"."external_discovery_searches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_discovery_candidate_evidence" ADD CONSTRAINT "external_discovery_candidate_evidence_result_id_external_discovery_results_id_fk" FOREIGN KEY ("result_id") REFERENCES "public"."external_discovery_results"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_discovery_candidate_evidence" ADD CONSTRAINT "external_discovery_candidate_evidence_reviewer_user_id_application_users_id_fk" FOREIGN KEY ("reviewer_user_id") REFERENCES "public"."application_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_discovery_results" ADD CONSTRAINT "external_discovery_results_search_id_external_discovery_searches_id_fk" FOREIGN KEY ("search_id") REFERENCES "public"."external_discovery_searches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_discovery_results" ADD CONSTRAINT "external_discovery_results_linked_internal_alumnus_id_alumni_id_fk" FOREIGN KEY ("linked_internal_alumnus_id") REFERENCES "public"."alumni"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_change_history" ADD CONSTRAINT "field_change_history_alumnus_id_alumni_id_fk" FOREIGN KEY ("alumnus_id") REFERENCES "public"."alumni"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mutation_commit_guards" ADD CONSTRAINT "mutation_commit_guards_request_key_mutation_requests_request_key_fk" FOREIGN KEY ("request_key") REFERENCES "public"."mutation_requests"("request_key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mutation_commit_guards" ADD CONSTRAINT "mutation_commit_guards_alumnus_id_alumni_id_fk" FOREIGN KEY ("alumnus_id") REFERENCES "public"."alumni"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mutation_request_items" ADD CONSTRAINT "mutation_request_items_request_key_mutation_requests_request_key_fk" FOREIGN KEY ("request_key") REFERENCES "public"."mutation_requests"("request_key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mutation_requests" ADD CONSTRAINT "mutation_requests_actor_user_id_application_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."application_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_collection_attempts" ADD CONSTRAINT "provider_collection_attempts_actor_user_id_application_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."application_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_collection_attempts" ADD CONSTRAINT "provider_collection_attempts_alumnus_id_alumni_id_fk" FOREIGN KEY ("alumnus_id") REFERENCES "public"."alumni"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_collection_attempts" ADD CONSTRAINT "provider_collection_attempts_result_provider_history_id_provider_response_history_id_fk" FOREIGN KEY ("result_provider_history_id") REFERENCES "public"."provider_response_history"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_company_aliases" ADD CONSTRAINT "provider_company_aliases_mapping_id_provider_company_mappings_id_fk" FOREIGN KEY ("mapping_id") REFERENCES "public"."provider_company_mappings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_refresh_reviews" ADD CONSTRAINT "provider_refresh_reviews_provider_response_id_provider_response_history_id_fk" FOREIGN KEY ("provider_response_id") REFERENCES "public"."provider_response_history"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_refresh_reviews" ADD CONSTRAINT "provider_refresh_reviews_alumnus_id_alumni_id_fk" FOREIGN KEY ("alumnus_id") REFERENCES "public"."alumni"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_response_history" ADD CONSTRAINT "provider_response_history_alumnus_id_alumni_id_fk" FOREIGN KEY ("alumnus_id") REFERENCES "public"."alumni"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provisional_alumni_intakes" ADD CONSTRAINT "provisional_alumni_intakes_alumnus_id_alumni_id_fk" FOREIGN KEY ("alumnus_id") REFERENCES "public"."alumni"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provisional_alumni_intakes" ADD CONSTRAINT "provisional_alumni_intakes_discovery_result_id_external_discovery_results_id_fk" FOREIGN KEY ("discovery_result_id") REFERENCES "public"."external_discovery_results"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provisional_alumni_intakes" ADD CONSTRAINT "provisional_alumni_intakes_search_id_external_discovery_searches_id_fk" FOREIGN KEY ("search_id") REFERENCES "public"."external_discovery_searches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provisional_alumni_intakes" ADD CONSTRAINT "provisional_alumni_intakes_intake_actor_user_id_application_users_id_fk" FOREIGN KEY ("intake_actor_user_id") REFERENCES "public"."application_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_audit_events" ADD CONSTRAINT "security_audit_events_actor_user_id_application_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."application_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_activity_log_mutation" ON "activity_log" USING btree ("mutation_request_key") WHERE "activity_log"."mutation_request_key" != '';--> statement-breakpoint
CREATE UNIQUE INDEX "idx_alumni_profile_key" ON "alumni" USING btree ("profile_key");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_alumni_email" ON "alumni" USING btree ("email") WHERE "alumni"."email" != '';--> statement-breakpoint
CREATE INDEX "idx_alumni_company" ON "alumni" USING btree ("company");--> statement-breakpoint
CREATE INDEX "idx_alumni_pdl_person_id" ON "alumni" USING btree ("pdl_person_id");--> statement-breakpoint
CREATE INDEX "idx_alumni_coresignal_employee_id" ON "alumni" USING btree ("coresignal_employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_alumni_coresignal_employee_id_unique" ON "alumni" USING btree ("coresignal_employee_id") WHERE "alumni"."coresignal_employee_id" != '';--> statement-breakpoint
CREATE INDEX "idx_alumni_intake_status" ON "alumni" USING btree ("intake_status");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_alumni_lifecycle_alumnus" ON "alumni_data_lifecycle" USING btree ("alumnus_id");--> statement-breakpoint
CREATE INDEX "idx_alumni_lifecycle_status" ON "alumni_data_lifecycle" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_employment_evidence_source_position" ON "alumni_employment_evidence" USING btree ("evidence_source","provider_response_id","provider_employee_id","stable_company_id","original_job_title","start_date");--> statement-breakpoint
CREATE INDEX "idx_employment_evidence_alumnus_current" ON "alumni_employment_evidence" USING btree ("alumnus_id","is_current","is_deleted");--> statement-breakpoint
CREATE INDEX "idx_employment_evidence_employee" ON "alumni_employment_evidence" USING btree ("provider_employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_alumni_privacy_alumnus" ON "alumni_privacy_controls" USING btree ("alumnus_id");--> statement-breakpoint
CREATE INDEX "idx_alumni_privacy_general_status" ON "alumni_privacy_controls" USING btree ("general_contact_status");--> statement-breakpoint
CREATE INDEX "idx_profile_change_proposal_alumnus_status" ON "alumni_profile_change_proposals" USING btree ("alumnus_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_profile_change_proposal_mutation_field" ON "alumni_profile_change_proposals" USING btree ("mutation_request_key","field") WHERE "alumni_profile_change_proposals"."mutation_request_key" != '';--> statement-breakpoint
CREATE UNIQUE INDEX "idx_alumni_relationship_pair" ON "alumni_relationships" USING btree ("intermediary_alumnus_id","target_alumnus_id");--> statement-breakpoint
CREATE INDEX "idx_alumni_relationship_target" ON "alumni_relationships" USING btree ("target_alumnus_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_alumni_source_observation_request_row" ON "alumni_source_observations" USING btree ("mutation_request_key","source_row_key");--> statement-breakpoint
CREATE INDEX "idx_alumni_source_observation_alumnus_date" ON "alumni_source_observations" USING btree ("alumnus_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_application_identities_provider_subject" ON "application_identities" USING btree ("provider","provider_subject_id");--> statement-breakpoint
CREATE INDEX "idx_application_identities_user" ON "application_identities" USING btree ("application_user_id");--> statement-breakpoint
CREATE INDEX "idx_application_identities_verified_email" ON "application_identities" USING btree ("verified_email");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_application_users_email" ON "application_users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_application_users_email_normalized" ON "application_users" USING btree (lower(trim("email")));--> statement-breakpoint
CREATE UNIQUE INDEX "idx_application_users_external_identity" ON "application_users" USING btree ("external_identity") WHERE "application_users"."external_identity" != '';--> statement-breakpoint
CREATE INDEX "idx_application_users_role_enabled" ON "application_users" USING btree ("role","enabled");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_birthday_data_alumnus" ON "birthday_data" USING btree ("alumnus_id");--> statement-breakpoint
CREATE INDEX "idx_birthday_data_month_day" ON "birthday_data" USING btree ("birth_month_day");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_brightdata_snapshot_evidence_snapshot" ON "brightdata_snapshot_evidence" USING btree ("snapshot_id");--> statement-breakpoint
CREATE INDEX "idx_brightdata_snapshot_evidence_retention" ON "brightdata_snapshot_evidence" USING btree ("retention_until");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_communication_preference_alumnus_type" ON "communication_preferences" USING btree ("alumnus_id","engagement_type");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_csw_coverage_subscription_employee" ON "coresignal_webhook_coverage" USING btree ("subscription_id","employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_csw_coverage_employee_active" ON "coresignal_webhook_coverage" USING btree ("employee_id") WHERE "coresignal_webhook_coverage"."status" = 'ACTIVE';--> statement-breakpoint
CREATE INDEX "idx_csw_coverage_alumnus" ON "coresignal_webhook_coverage" USING btree ("alumnus_id","status");--> statement-breakpoint
CREATE INDEX "idx_csw_coverage_employee" ON "coresignal_webhook_coverage" USING btree ("employee_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_csw_event_dedupe" ON "coresignal_webhook_events" USING btree ("subscription_id","payload_digest","dedupe_window");--> statement-breakpoint
CREATE INDEX "idx_csw_event_alumnus_date" ON "coresignal_webhook_events" USING btree ("alumnus_id","received_at");--> statement-breakpoint
CREATE INDEX "idx_csw_event_status_date" ON "coresignal_webhook_events" USING btree ("status","received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_csw_identity_alumnus" ON "coresignal_webhook_identities" USING btree ("alumnus_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_csw_identity_employee" ON "coresignal_webhook_identities" USING btree ("employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_csw_operation_request" ON "coresignal_webhook_operations" USING btree ("request_key");--> statement-breakpoint
CREATE INDEX "idx_csw_operation_subscription" ON "coresignal_webhook_operations" USING btree ("subscription_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_csw_provider_subscription" ON "coresignal_webhook_subscriptions" USING btree ("provider_subscription_id") WHERE "coresignal_webhook_subscriptions"."provider_subscription_id" != '';--> statement-breakpoint
CREATE INDEX "idx_csw_status_expiry" ON "coresignal_webhook_subscriptions" USING btree ("status","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_corporate_opportunities_key" ON "corporate_opportunities" USING btree ("opportunity_key");--> statement-breakpoint
CREATE INDEX "idx_corporate_opportunities_company" ON "corporate_opportunities" USING btree ("company");--> statement-breakpoint
CREATE INDEX "idx_corporate_opportunities_alumnus" ON "corporate_opportunities" USING btree ("alumnus_id");--> statement-breakpoint
CREATE INDEX "idx_corporate_opportunities_engagement" ON "corporate_opportunities" USING btree ("engagement_id");--> statement-breakpoint
CREATE INDEX "idx_corporate_opportunities_owner_stage" ON "corporate_opportunities" USING btree ("owner_user_id","stage");--> statement-breakpoint
CREATE INDEX "idx_corporate_opportunities_follow_up" ON "corporate_opportunities" USING btree ("follow_up_date");--> statement-breakpoint
CREATE INDEX "idx_corporate_opportunity_history_opportunity" ON "corporate_opportunity_history" USING btree ("opportunity_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_corporate_opportunity_history_actor" ON "corporate_opportunity_history" USING btree ("actor_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_engagement_action_key" ON "engagement_actions" USING btree ("action_key");--> statement-breakpoint
CREATE INDEX "idx_engagement_action_event" ON "engagement_actions" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "idx_engagement_audit_event" ON "engagement_audit_log" USING btree ("event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_engagement_event_key" ON "engagement_events" USING btree ("event_key");--> statement-breakpoint
CREATE INDEX "idx_engagement_event_status_date" ON "engagement_events" USING btree ("status","event_date");--> statement-breakpoint
CREATE INDEX "idx_engagement_event_alumnus" ON "engagement_events" USING btree ("alumnus_id");--> statement-breakpoint
CREATE INDEX "idx_engagement_response_event" ON "engagement_responses" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "idx_event_view_event_user" ON "event_views" USING btree ("event_id","user_id");--> statement-breakpoint
CREATE INDEX "idx_external_candidate_evidence_result" ON "external_discovery_candidate_evidence" USING btree ("result_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_external_candidate_evidence_request" ON "external_discovery_candidate_evidence" USING btree ("result_id","request_key");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_external_result_search_provider" ON "external_discovery_results" USING btree ("search_id","provider_result_id");--> statement-breakpoint
CREATE INDEX "idx_external_result_search" ON "external_discovery_results" USING btree ("search_id");--> statement-breakpoint
CREATE INDEX "idx_external_result_match_status" ON "external_discovery_results" USING btree ("match_status");--> statement-breakpoint
CREATE INDEX "idx_external_result_linked_alumnus_date" ON "external_discovery_results" USING btree ("linked_internal_alumnus_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_field_change_alumnus" ON "field_change_history" USING btree ("alumnus_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_field_change_mutation_field" ON "field_change_history" USING btree ("mutation_request_key","field") WHERE "field_change_history"."mutation_request_key" != '';--> statement-breakpoint
CREATE UNIQUE INDEX "idx_import_run_mutation" ON "import_runs" USING btree ("mutation_request_key") WHERE "import_runs"."mutation_request_key" != '';--> statement-breakpoint
CREATE UNIQUE INDEX "idx_message_template_key" ON "message_templates" USING btree ("template_key");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_mutation_commit_guard_request_alumnus" ON "mutation_commit_guards" USING btree ("request_key","alumnus_id","operation");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_mutation_request_item_unique" ON "mutation_request_items" USING btree ("request_key","item_key");--> statement-breakpoint
CREATE INDEX "idx_mutation_request_item_request" ON "mutation_request_items" USING btree ("request_key");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_mutation_request_client_scope" ON "mutation_requests" USING btree ("actor_user_id","operation_type","target_key","client_key_hash");--> statement-breakpoint
CREATE INDEX "idx_mutation_request_status_lease" ON "mutation_requests" USING btree ("status","lease_expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_programme_options_code" ON "programme_options" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_provider_collection_request_key" ON "provider_collection_attempts" USING btree ("request_key");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_provider_collection_job" ON "provider_collection_attempts" USING btree ("provider","provider_job_id") WHERE "provider_collection_attempts"."provider_job_id" != '';--> statement-breakpoint
CREATE UNIQUE INDEX "idx_provider_collection_active_target" ON "provider_collection_attempts" USING btree ("provider","target_fingerprint") WHERE "provider_collection_attempts"."status" in ('CLAIMED', 'TRIGGER_IN_PROGRESS', 'SNAPSHOT_PENDING', 'SNAPSHOT_RUNNING', 'SNAPSHOT_READY', 'RESULT_RETRIEVED');--> statement-breakpoint
CREATE INDEX "idx_provider_collection_target" ON "provider_collection_attempts" USING btree ("provider","target_fingerprint","created_at");--> statement-breakpoint
CREATE INDEX "idx_provider_collection_alumnus_date" ON "provider_collection_attempts" USING btree ("alumnus_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_provider_collection_status" ON "provider_collection_attempts" USING btree ("provider","status","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_provider_company_alias_unique" ON "provider_company_aliases" USING btree ("normalized_alias");--> statement-breakpoint
CREATE INDEX "idx_provider_company_alias_mapping" ON "provider_company_aliases" USING btree ("mapping_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_provider_company_mapping_company_provider" ON "provider_company_mappings" USING btree ("normalized_company_key","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_provider_company_mapping_provider_id" ON "provider_company_mappings" USING btree ("provider","provider_company_id") WHERE "provider_company_mappings"."provider_company_id" != '';--> statement-breakpoint
CREATE INDEX "idx_provider_company_mapping_status" ON "provider_company_mappings" USING btree ("provider","status");--> statement-breakpoint
CREATE INDEX "idx_provider_refresh_review_alumnus" ON "provider_refresh_reviews" USING btree ("alumnus_id","status");--> statement-breakpoint
CREATE INDEX "idx_provider_response_history_alumnus_date" ON "provider_response_history" USING btree ("alumnus_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_provisional_intake_alumnus" ON "provisional_alumni_intakes" USING btree ("alumnus_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_provisional_intake_result" ON "provisional_alumni_intakes" USING btree ("discovery_result_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_provisional_intake_provider_person" ON "provisional_alumni_intakes" USING btree ("provider","provider_person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_provisional_intake_profile" ON "provisional_alumni_intakes" USING btree ("normalized_profile_key");--> statement-breakpoint
CREATE INDEX "idx_provisional_intake_search" ON "provisional_alumni_intakes" USING btree ("search_id");--> statement-breakpoint
CREATE INDEX "idx_security_audit_actor" ON "security_audit_events" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "idx_security_audit_entity" ON "security_audit_events" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "idx_security_audit_created_at" ON "security_audit_events" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_security_audit_mutation" ON "security_audit_events" USING btree ("mutation_request_key") WHERE "security_audit_events"."mutation_request_key" != '';