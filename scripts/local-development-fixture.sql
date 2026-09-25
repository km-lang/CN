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

INSERT INTO `alumni` (
  `id`, `profile_key`, `name`, `initials`, `batch`, `graduation_year`, `programme`,
  `company`, `title`, `function`, `seniority`, `location`, `email`, `email_source`,
  `email_verification`, `professional_data_status`, `verified_label`, `source`, `updated_by`
) VALUES (
  15, 'local-fixture-sahil-bansal', 'Sahil Bansal', 'SB', 2012, 2012, 'PGP',
  'Local Fixture Company', 'Director', 'Strategy', 'Director', 'India',
  'sahil.bansal@example.test', 'Local fixture', 'Verified', 'Reviewed', 'Locally verified',
  'Local fixture', 'Local Development Admin'
)
ON CONFLICT(`id`) DO UPDATE SET
  `profile_key` = excluded.`profile_key`,
  `name` = excluded.`name`,
  `initials` = excluded.`initials`,
  `email` = excluded.`email`,
  `email_source` = excluded.`email_source`,
  `email_verification` = excluded.`email_verification`,
  `source` = excluded.`source`,
  `updated_by` = excluded.`updated_by`;

INSERT INTO `communication_preferences` (
  `alumnus_id`, `engagement_type`, `status`, `source`, `updated_by`
) VALUES (
  15, 'Professional', 'Allowed', 'Local fixture', 'Local Development Admin'
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
  'Professional Signal',
  'Historical outreach',
  'Completed historical email',
  'A completed historical email used to verify that a new legitimate draft may be prepared.',
  'Local fixture',
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
