INSERT INTO `security_audit_events` (
  `actor_user_id`,
  `actor_identity`,
  `actor_name`,
  `actor_role`,
  `action`,
  `entity_type`,
  `entity_id`,
  `metadata_json`,
  `result`,
  `source`
)
SELECT
  NULL,
  'System',
  'System',
  'SYSTEM',
  'user_pre_authorization_corrected',
  'application_user',
  '2',
  '{"reason":"Institutional email was entered incorrectly as pgo41189@iiml.ac.in.","incorrectUser":{"id":2,"email":"pgo41189@iiml.ac.in"},"correctUser":{"id":3,"email":"pgp41189@iiml.ac.in"}}',
  'success',
  'migration'
FROM `application_users` AS `incorrect_user`
JOIN `application_users` AS `correct_user` ON `correct_user`.`id` = 3
WHERE `incorrect_user`.`id` = 2
  AND lower(trim(`incorrect_user`.`email`)) = 'pgo41189@iiml.ac.in'
  AND `incorrect_user`.`role` = 'PCOM'
  AND `incorrect_user`.`enabled` = 0
  AND `incorrect_user`.`last_login_at` = ''
  AND lower(trim(`correct_user`.`email`)) = 'pgp41189@iiml.ac.in'
  AND `correct_user`.`role` = 'PCOM'
  AND `correct_user`.`enabled` = 1
  AND NOT EXISTS (
    SELECT 1 FROM `application_identities`
    WHERE `application_identities`.`application_user_id` = `incorrect_user`.`id`
  )
  AND NOT EXISTS (
    SELECT 1 FROM `security_audit_events`
    WHERE `security_audit_events`.`actor_user_id` = `incorrect_user`.`id`
  )
  AND NOT EXISTS (
    SELECT 1 FROM `security_audit_events`
    WHERE `security_audit_events`.`action` = 'user_pre_authorization_corrected'
      AND `security_audit_events`.`entity_type` = 'application_user'
      AND `security_audit_events`.`entity_id` = '2'
  );
--> statement-breakpoint
DELETE FROM `application_users`
WHERE `id` = 2
  AND lower(trim(`email`)) = 'pgo41189@iiml.ac.in'
  AND `role` = 'PCOM'
  AND `enabled` = 0
  AND `last_login_at` = ''
  AND NOT EXISTS (
    SELECT 1 FROM `application_identities`
    WHERE `application_identities`.`application_user_id` = `application_users`.`id`
  )
  AND NOT EXISTS (
    SELECT 1 FROM `security_audit_events`
    WHERE `security_audit_events`.`actor_user_id` = `application_users`.`id`
  )
  AND EXISTS (
    SELECT 1 FROM `application_users` AS `correct_user`
    WHERE `correct_user`.`id` = 3
      AND lower(trim(`correct_user`.`email`)) = 'pgp41189@iiml.ac.in'
      AND `correct_user`.`role` = 'PCOM'
      AND `correct_user`.`enabled` = 1
  )
  AND EXISTS (
    SELECT 1 FROM `security_audit_events`
    WHERE `security_audit_events`.`action` = 'user_pre_authorization_corrected'
      AND `security_audit_events`.`entity_type` = 'application_user'
      AND `security_audit_events`.`entity_id` = '2'
  );
