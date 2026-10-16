INSERT INTO `application_users` (
  `id`, `external_identity`, `display_name`, `email`, `role`, `enabled`, `last_login_at`
) VALUES (
  1, 'local-development-admin', 'Local Development Admin', 'local.admin@example.test', 'ADMIN', 1, CURRENT_TIMESTAMP
)
ON CONFLICT(`id`) DO UPDATE SET
  `external_identity` = excluded.`external_identity`,
  `display_name` = excluded.`display_name`,
  `email` = excluded.`email`,
  `role` = excluded.`role`,
  `enabled` = excluded.`enabled`;

INSERT INTO `application_identities` (
  `id`, `application_user_id`, `provider`, `provider_subject_id`, `verified_email`, `email_verified`, `provider_domain`, `last_authenticated_at`
) VALUES (
  1, 1, 'chatgpt', 'local-development-admin', 'local.admin@example.test', 1, 'example.test', CURRENT_TIMESTAMP
)
ON CONFLICT(`id`) DO UPDATE SET
  `application_user_id` = excluded.`application_user_id`,
  `provider` = excluded.`provider`,
  `provider_subject_id` = excluded.`provider_subject_id`,
  `verified_email` = excluded.`verified_email`,
  `email_verified` = excluded.`email_verified`;

INSERT INTO `application_users` (
  `id`, `external_identity`, `display_name`, `email`, `role`, `enabled`, `last_login_at`
) VALUES (
  2, 'local-development-pcom', 'Local Development PCOM', 'local.pcom@example.test', 'PCOM', 1, CURRENT_TIMESTAMP
)
ON CONFLICT(`id`) DO UPDATE SET
  `external_identity` = excluded.`external_identity`,
  `display_name` = excluded.`display_name`,
  `email` = excluded.`email`,
  `role` = excluded.`role`,
  `enabled` = excluded.`enabled`;

INSERT INTO `application_identities` (
  `id`, `application_user_id`, `provider`, `provider_subject_id`, `verified_email`, `email_verified`, `provider_domain`, `last_authenticated_at`
) VALUES (
  2, 2, 'chatgpt', 'local-development-pcom', 'local.pcom@example.test', 1, 'example.test', CURRENT_TIMESTAMP
)
ON CONFLICT(`id`) DO UPDATE SET
  `application_user_id` = excluded.`application_user_id`,
  `provider` = excluded.`provider`,
  `provider_subject_id` = excluded.`provider_subject_id`,
  `verified_email` = excluded.`verified_email`,
  `email_verified` = excluded.`email_verified`;

INSERT INTO `alumni` (
  `id`, `profile_key`, `name`, `initials`, `batch`, `graduation_year`, `programme`,
  `company`, `title`, `function`, `seniority`, `location`, `email`, `email_source`, `phone`, `phone_source`,
  `email_verification`, `phone_verification`, `professional_data_status`, `verified_label`, `outreach_status`,
  `iiml_relationship`, `warm_intro_potential`, `confidence`, `profile_match`,
  `current_company_verification`, `designation_verification`, `source`, `updated_by`
) VALUES (
  15, 'local-fixture-sahil-bansal', 'Sahil Bansal', 'SB', 2012, 2012, 'PGP',
  'Local Fixture Company', 'Director', 'Strategy', 'Director', 'India',
  'sahil.bansal@example.test', 'Manual verification', '', '', 'Verified', 'Unverified', 'Reviewed', 'Manually verified',
  'Contacted', 'Unknown / Not assessed', 'Confirmed relationship available', 65, 'Confirmed',
  'Verified', 'Verified', 'Internal alumni database', 'Local Development Admin'
)
ON CONFLICT(`id`) DO UPDATE SET
  `profile_key` = excluded.`profile_key`,
  `name` = excluded.`name`,
  `initials` = excluded.`initials`,
  `batch` = excluded.`batch`,
  `graduation_year` = excluded.`graduation_year`,
  `programme` = excluded.`programme`,
  `company` = excluded.`company`,
  `title` = excluded.`title`,
  `function` = excluded.`function`,
  `seniority` = excluded.`seniority`,
  `location` = excluded.`location`,
  `email` = excluded.`email`,
  `email_source` = excluded.`email_source`,
  `phone` = excluded.`phone`,
  `phone_source` = excluded.`phone_source`,
  `email_verification` = excluded.`email_verification`,
  `phone_verification` = excluded.`phone_verification`,
  `outreach_status` = excluded.`outreach_status`,
  `iiml_relationship` = excluded.`iiml_relationship`,
  `warm_intro_potential` = excluded.`warm_intro_potential`,
  `confidence` = excluded.`confidence`,
  `profile_match` = excluded.`profile_match`,
  `current_company_verification` = excluded.`current_company_verification`,
  `designation_verification` = excluded.`designation_verification`,
  `source` = excluded.`source`,
  `updated_by` = excluded.`updated_by`;

INSERT INTO `alumni` (
  `id`, `profile_key`, `name`, `initials`, `batch`, `graduation_year`, `programme`,
  `company`, `title`, `function`, `seniority`, `location`, `email`, `email_source`, `phone`, `phone_source`,
  `email_verification`, `phone_verification`, `professional_data_status`, `verified_label`, `outreach_status`,
  `iiml_relationship`, `warm_intro_potential`, `confidence`, `profile_match`,
  `current_company_verification`, `designation_verification`, `source`, `updated_by`
) VALUES (
  22, 'local-fixture-priya-sharma', 'Priya Sharma', 'PS', 2015, 2015, 'PGP',
  'Local Fixture Company', 'Vice President', 'HR', 'Vice President', 'Mumbai, India',
  'priya.sharma@example.test', 'Manual verification', '', '', 'Verified', 'Unverified', 'Reviewed', 'Manually verified', 'Responded',
  'Strong', 'Confirmed direct connection to decision-maker', 85, 'Confirmed',
  'Verified', 'Verified', 'Internal alumni database', 'Local Development Admin'
)
ON CONFLICT(`id`) DO UPDATE SET
  `profile_key` = excluded.`profile_key`,
  `name` = excluded.`name`,
  `initials` = excluded.`initials`,
  `batch` = excluded.`batch`,
  `graduation_year` = excluded.`graduation_year`,
  `programme` = excluded.`programme`,
  `company` = excluded.`company`,
  `title` = excluded.`title`,
  `function` = excluded.`function`,
  `seniority` = excluded.`seniority`,
  `location` = excluded.`location`,
  `email` = excluded.`email`,
  `email_source` = excluded.`email_source`,
  `phone` = excluded.`phone`,
  `phone_source` = excluded.`phone_source`,
  `email_verification` = excluded.`email_verification`,
  `phone_verification` = excluded.`phone_verification`,
  `outreach_status` = excluded.`outreach_status`,
  `iiml_relationship` = excluded.`iiml_relationship`,
  `warm_intro_potential` = excluded.`warm_intro_potential`,
  `confidence` = excluded.`confidence`,
  `profile_match` = excluded.`profile_match`,
  `current_company_verification` = excluded.`current_company_verification`,
  `designation_verification` = excluded.`designation_verification`,
  `source` = excluded.`source`,
  `updated_by` = excluded.`updated_by`;

INSERT INTO `company_priorities` (`company`, `priority`, `updated_by`) VALUES
  ('Example Company', 'Low Priority', 'Local Development Admin')
ON CONFLICT(`company`) DO UPDATE SET
  `priority` = excluded.`priority`,
  `updated_by` = excluded.`updated_by`;

INSERT INTO `alumni_relationships` (
  `intermediary_alumnus_id`, `target_alumnus_id`, `relationship_type`, `evidence`,
  `confirmed`, `successful_introductions`, `source`, `updated_by`
) VALUES (
  22, 15, 'Confirmed relationship',
  'Prior introduction confirmed by a committee member.',
  1, 1, 'Committee-confirmed relationship', 'Local Development Admin'
)
ON CONFLICT(`intermediary_alumnus_id`, `target_alumnus_id`) DO UPDATE SET
  `relationship_type` = excluded.`relationship_type`,
  `evidence` = excluded.`evidence`,
  `confirmed` = excluded.`confirmed`,
  `successful_introductions` = excluded.`successful_introductions`,
  `source` = excluded.`source`,
  `updated_by` = excluded.`updated_by`;

INSERT INTO `engagement_events` (
  `id`, `event_key`, `alumnus_id`, `company`, `event_type`, `event_subtype`, `event_title`,
  `event_description`, `source`, `source_reference_id`, `event_date`, `status`, `created_by`, `last_updated_by`
) VALUES (
  151, 'local-priya-promotion-signal', 22, 'Local Fixture Company', 'Professional Signal', 'Promotion',
  'Promotion requires review', 'Priya Sharma was promoted to Vice President.',
  'Professional Signals', 'local-signal-151', '2026-09-25', 'New',
  'Local Development Admin', 'Local Development Admin'
)
ON CONFLICT(`id`) DO UPDATE SET
  `event_key` = excluded.`event_key`,
  `alumnus_id` = excluded.`alumnus_id`,
  `company` = excluded.`company`,
  `event_type` = excluded.`event_type`,
  `event_subtype` = excluded.`event_subtype`,
  `event_title` = excluded.`event_title`,
  `event_description` = excluded.`event_description`,
  `source` = excluded.`source`,
  `source_reference_id` = excluded.`source_reference_id`,
  `event_date` = excluded.`event_date`,
  `status` = excluded.`status`;

INSERT INTO `birthday_data` (`alumnus_id`, `birth_month_day`, `source`, `status`, `last_verified_at`, `last_updated_by`) VALUES
  (22, '09-25', 'Alumni-confirmed record', 'Confirmed internally', '2026-09-20T10:00:00.000Z', 'Local Development Admin'),
  (15, '09-27', 'Internal alumni database', 'Confirmed internally', '2026-09-20T10:00:00.000Z', 'Local Development Admin')
ON CONFLICT(`alumnus_id`) DO UPDATE SET
  `birth_month_day` = excluded.`birth_month_day`,
  `source` = excluded.`source`,
  `status` = excluded.`status`,
  `last_verified_at` = excluded.`last_verified_at`,
  `last_updated_by` = excluded.`last_updated_by`;

INSERT INTO `alumni_privacy_controls` (`alumnus_id`, `general_contact_status`, `professional_engagement_status`, `birthday_engagement_status`, `consent_source`, `notes`, `updated_by`) VALUES
  (22, 'Standard engagement allowed', 'Professional engagement only', 'Birthday engagement allowed', 'Alumni-confirmed', '', 'Local Development Admin'),
  (15, 'Professional engagement only', 'Professional engagement only', 'Unknown', 'Internal institutional record', '', 'Local Development Admin')
ON CONFLICT(`alumnus_id`) DO UPDATE SET
  `general_contact_status` = excluded.`general_contact_status`,
  `professional_engagement_status` = excluded.`professional_engagement_status`,
  `birthday_engagement_status` = excluded.`birthday_engagement_status`,
  `consent_source` = excluded.`consent_source`,
  `notes` = excluded.`notes`,
  `updated_by` = excluded.`updated_by`;

INSERT INTO `engagement_events` (
  `id`, `event_key`, `alumnus_id`, `company`, `event_type`, `event_subtype`, `event_title`,
  `event_description`, `source`, `source_reference_id`, `event_date`, `status`, `assigned_to`,
  `follow_up_required`, `follow_up_date`, `skip_reason`, `created_by`, `last_updated_by`
) VALUES
  (152, 'local-priya-birthday-2026', 22, 'Local Fixture Company', 'Birthday', 'Birthday', 'Priya Sharma birthday', 'Review a birthday message before sending.', 'Internal alumni database', 'birthday-22-2026', '2026-09-25', 'New', '', 0, '', '', 'Local Development Admin', 'Local Development Admin'),
  (153, 'local-sahil-birthday-2026', 15, 'Local Fixture Company', 'Birthday', 'Birthday', 'Sahil Bansal birthday', 'Birthday is confirmed but communication permission is unknown.', 'Internal alumni database', 'birthday-15-2026', '2026-09-27', 'New', '', 0, '', '', 'Local Development Admin', 'Local Development Admin'),
  (154, 'local-priya-follow-up', 22, 'Local Fixture Company', 'Manual Relationship', 'Follow-up', 'Placement conversation follow-up', 'A committee follow-up is due for review.', 'Manual PCOM selection', 'manual-follow-up-22', '2026-09-25', 'Follow-up Due', 'Local Development Admin', 1, '2026-09-25', '', 'Local Development Admin', 'Local Development Admin'),
  (155, 'local-sahil-skipped', 15, 'Local Fixture Company', 'Manual Relationship', 'Institutional outreach', 'Earlier outreach opportunity', 'This item remains available as skipped audit history.', 'Manual PCOM selection', 'manual-skipped-15', '2026-09-10', 'Skipped', '', 0, '', 'Already covered through another relationship', 'Local Development Admin', 'Local Development Admin')
ON CONFLICT(`id`) DO UPDATE SET
  `event_key` = excluded.`event_key`,
  `status` = excluded.`status`,
  `assigned_to` = excluded.`assigned_to`,
  `follow_up_required` = excluded.`follow_up_required`,
  `follow_up_date` = excluded.`follow_up_date`,
  `skip_reason` = excluded.`skip_reason`,
  `last_updated_by` = excluded.`last_updated_by`;

INSERT INTO `communication_preferences` (
  `alumnus_id`, `engagement_type`, `status`, `source`, `updated_by`
) VALUES (
  15, 'Professional', 'Allowed', 'Internal institutional record', 'Local Development Admin'
)
ON CONFLICT(`alumnus_id`, `engagement_type`) DO UPDATE SET
  `status` = excluded.`status`,
  `source` = excluded.`source`,
  `updated_by` = excluded.`updated_by`;

INSERT INTO `message_templates` (
  `id`, `template_key`, `name`, `event_type`, `subject`, `body`, `status`, `version`, `updated_by`
) VALUES (
  1,
  'local-professional-outreach',
  'Local professional outreach',
  'Professional Signal',
  'Connecting with IIM Lucknow',
  'Hello {{name}},\n\nWe would value a conversation with you.\n\nRegards,\nPlacement Committee, IIM Lucknow',
  'Approved',
  1,
  'Local Development Admin'
)
ON CONFLICT(`id`) DO UPDATE SET
  `template_key` = excluded.`template_key`,
  `name` = excluded.`name`,
  `event_type` = excluded.`event_type`,
  `subject` = excluded.`subject`,
  `body` = excluded.`body`,
  `status` = excluded.`status`,
  `version` = excluded.`version`;

INSERT INTO `message_templates` (`id`, `template_key`, `name`, `event_type`, `subject`, `body`, `status`, `version`, `updated_by`) VALUES (
  2, 'local-birthday-wish', 'Birthday wish', 'Birthday', 'Birthday wishes from IIM Lucknow',
  'Hello {{name}},\n\nWishing you a very happy birthday.\n\nRegards,\nPlacement Committee, IIM Lucknow',
  'Approved', 1, 'Local Development Admin'
)
ON CONFLICT(`id`) DO UPDATE SET
  `template_key` = excluded.`template_key`,
  `name` = excluded.`name`,
  `event_type` = excluded.`event_type`,
  `subject` = excluded.`subject`,
  `body` = excluded.`body`,
  `status` = excluded.`status`,
  `version` = excluded.`version`;

INSERT INTO `engagement_events` (
  `id`, `event_key`, `alumnus_id`, `company`, `event_type`, `event_subtype`, `event_title`,
  `event_description`, `source`, `source_reference_id`, `event_date`, `status`,
  `action_taken_at`, `action_taken_by`, `action_type`, `action_channel`,
  `message_template_id`, `message_subject`, `delivery_status`, `created_by`, `last_updated_by`
) VALUES (
  150,
  'local-fixture-sahil-completed-email',
  15,
  'Local Fixture Company',
  'Manual Relationship',
  'Historical outreach',
  'Completed historical email',
  'A completed historical email used to verify that a new legitimate draft may be prepared.',
  'Institutional mail history',
  'local-history-150',
  '2026-08-01',
  'Completed',
  '2026-08-01T10:00:00.000Z',
  'Local Development Admin',
  'Email',
  'Email',
  1,
  'Previous IIM Lucknow outreach',
  'Delivered',
  'Local Development Admin',
  'Local Development Admin'
)
ON CONFLICT(`id`) DO UPDATE SET
  `event_key` = excluded.`event_key`,
  `alumnus_id` = excluded.`alumnus_id`,
  `event_type` = excluded.`event_type`,
  `status` = excluded.`status`,
  `action_taken_at` = excluded.`action_taken_at`,
  `action_type` = excluded.`action_type`,
  `action_channel` = excluded.`action_channel`,
  `delivery_status` = excluded.`delivery_status`;

INSERT INTO `engagement_actions` (
  `action_key`, `event_id`, `alumnus_id`, `action_type`, `channel`, `performed_by`,
  `template_id`, `subject`, `message_summary`, `external_message_id`, `delivery_status`,
  `sender`, `recipient`, `purpose`, `template_version`, `approved_by`, `approved_at`
) VALUES (
  'local-fixture-sahil-completed-email-action',
  150,
  15,
  'Email',
  'Email',
  'Local Development Admin',
  1,
  'Previous IIM Lucknow outreach',
  'Historical local fixture message',
  'local-fixture-message-150',
  'Delivered',
  'local.admin@example.test',
  'sahil.bansal@example.test',
  'Institutional outreach',
  1,
  'Local Development Admin',
  '2026-08-01T10:00:00.000Z'
)
ON CONFLICT(`action_key`) DO NOTHING;
