	-- ============================================================
	-- Sproutbien — Mail to employees (announcements and greetings)
	-- Run in: Supabase Dashboard → SQL Editor → New query
	--
	--   • Admins write one message with merge fields ({{first_name}} …) and pick
	--     who gets it. The employee-mail Edge Function sends each person their
	--     own email (nobody sees anyone else's address) through Resend.
	--   • mail_campaigns: one row per message sent; mail_recipients: one row
	--     per person, with sent / failed / skipped and the error.
	--   • Greetings skip anyone with employees.no_celebrations ticked;
	--     updates always go to everyone picked.
	--   • mail_templates: saved messages admins can start from (a few
	--     greetings are added below).
	--   Admins only. Campaigns and recipients are written by the Edge Function
	--   (service role); the app only reads them.
	-- Setup: docs/EMPLOYEE_MAIL_SETUP.md
	-- ============================================================

	CREATE TABLE IF NOT EXISTS mail_campaigns (
	  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
	  kind          text        NOT NULL CHECK (kind IN ('update', 'greeting')),
	  subject       text        NOT NULL CHECK (length(trim(subject)) BETWEEN 1 AND 200),
	  body          text        NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 20000),
	  sent_by       uuid        REFERENCES employees(id) ON DELETE SET NULL,
	  total         int         NOT NULL DEFAULT 0,
	  sent_count    int         NOT NULL DEFAULT 0,
	  failed_count  int         NOT NULL DEFAULT 0,
	  skipped_count int         NOT NULL DEFAULT 0,
	  created_at    timestamptz NOT NULL DEFAULT now(),
	  finished_at   timestamptz
	);
	CREATE INDEX IF NOT EXISTS mail_campaigns_created_idx ON mail_campaigns (created_at DESC);

	CREATE TABLE IF NOT EXISTS mail_recipients (
	  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
	  campaign_id  uuid        NOT NULL REFERENCES mail_campaigns(id) ON DELETE CASCADE,
	  employee_id  uuid        REFERENCES employees(id) ON DELETE SET NULL,
	  full_name    text        NOT NULL,           -- kept as sent, even if the employee is later removed
	  email        text        NOT NULL,
	  status       text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
	  error        text,
	  provider_id  text,                           -- Resend's email id
	  sent_at      timestamptz,
	  UNIQUE (campaign_id, employee_id)
	);
	CREATE INDEX IF NOT EXISTS mail_recipients_campaign_idx ON mail_recipients (campaign_id);

	CREATE TABLE IF NOT EXISTS mail_templates (
	  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
	  name        text        NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
	  kind        text        NOT NULL CHECK (kind IN ('update', 'greeting')),
	  subject     text        NOT NULL CHECK (length(trim(subject)) BETWEEN 1 AND 200),
	  body        text        NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 20000),
	  created_at  timestamptz NOT NULL DEFAULT now(),
	  updated_at  timestamptz NOT NULL DEFAULT now()
	);

	ALTER TABLE mail_campaigns  ENABLE ROW LEVEL SECURITY;
	ALTER TABLE mail_recipients ENABLE ROW LEVEL SECURITY;
	ALTER TABLE mail_templates  ENABLE ROW LEVEL SECURITY;

	DROP POLICY IF EXISTS "mail campaigns: admin read" ON mail_campaigns;
	CREATE POLICY "mail campaigns: admin read" ON mail_campaigns FOR SELECT USING (is_admin());
	DROP POLICY IF EXISTS "mail recipients: admin read" ON mail_recipients;
	CREATE POLICY "mail recipients: admin read" ON mail_recipients FOR SELECT USING (is_admin());

	DROP POLICY IF EXISTS "mail templates: admin all" ON mail_templates;
	CREATE POLICY "mail templates: admin all" ON mail_templates FOR ALL USING (is_admin()) WITH CHECK (is_admin());

	-- ── Starter templates (only when there are none yet) ───────
	INSERT INTO mail_templates (name, kind, subject, body)
	SELECT * FROM (VALUES
	  ('Birthday wishes', 'greeting', 'Happy birthday, {{first_name}}! 🎂',
	   E'Dear {{first_name}},\n\nWishing you a very happy birthday from all of us at {{company_name}}!\n\nThank you for everything you bring to the team as our {{designation}}. We hope the year ahead is full of good health, happiness and success.\n\nHave a wonderful day!\n\nWarm wishes,\nThe {{company_name}} team'),
	  ('Work anniversary', 'greeting', 'Happy {{years}}-year work anniversary, {{first_name}}! 🎉',
	   E'Dear {{first_name}},\n\nToday marks {{years}} year(s) since you joined {{company_name}} on {{joining_date}}. Congratulations, and thank you!\n\nYour work and commitment make a real difference to the {{department}} team and to all of us. Here''s to many more years together.\n\nWith gratitude,\nThe {{company_name}} team'),
	  ('Festival greetings', 'greeting', 'Warm festive wishes, {{first_name}}',
	   E'Dear {{first_name}},\n\nOn behalf of everyone at {{company_name}}, we wish you and your family a joyful and prosperous festival.\n\nMay this season bring you happiness, good health and time with the people you love.\n\nWarm regards,\nThe {{company_name}} team'),
	  ('Important update', 'update', 'Important: ',
	   E'Dear {{first_name}},\n\n\n\nIf you have any questions, simply reply to this email.\n\nRegards,\nHR, {{company_name}}')
	) AS t(name, kind, subject, body)
	WHERE NOT EXISTS (SELECT 1 FROM mail_templates);
