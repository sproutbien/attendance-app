-- ============================================================
-- Sproutbien — WhatsApp leave notifications
-- Run in: Supabase Dashboard → SQL Editor → New query
-- Setup steps (Meta app, Edge Function, Vault secrets): docs/WHATSAPP_SETUP.md
-- ============================================================

-- Employee WhatsApp number, digits only with country code (e.g. 919876543210)
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS phone text
  CHECK (phone ~ '^[1-9][0-9]{7,14}$');

-- pg_net lets the trigger call the Edge Function asynchronously
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ── Trigger: notify on new request / approval / rejection ────

CREATE OR REPLACE FUNCTION notify_leave_whatsapp()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_event  text;
  v_url    text;
  v_secret text;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status = 'pending' THEN
    v_event := 'leave_submitted';
  ELSIF TG_OP = 'UPDATE'
    AND NEW.status IS DISTINCT FROM OLD.status
    AND NEW.status IN ('approved', 'rejected') THEN
    v_event := 'leave_reviewed';
  ELSE
    RETURN NEW;
  END IF;

  SELECT decrypted_secret INTO v_url    FROM vault.decrypted_secrets WHERE name = 'leave_whatsapp_url';
  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'leave_whatsapp_secret';

  -- Not configured yet: skip silently so leave requests keep working
  IF v_url IS NULL OR v_secret IS NULL THEN
    RETURN NEW;
  END IF;

  -- Fire-and-forget; only the id is sent, the function re-reads the row itself
  PERFORM net.http_post(
    url     := v_url,
    body    := jsonb_build_object('event', v_event, 'leave_id', NEW.id),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', v_secret
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_leave_whatsapp ON leave_requests;

CREATE TRIGGER on_leave_whatsapp
  AFTER INSERT OR UPDATE OF status ON leave_requests
  FOR EACH ROW EXECUTE FUNCTION notify_leave_whatsapp();
