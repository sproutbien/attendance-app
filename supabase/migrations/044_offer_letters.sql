-- ============================================================
-- Sproutbien — Offer letters
-- Run in: Supabase Dashboard → SQL Editor → New query
--
--   • offer_letter_settings (one row): company details for the letterhead,
--     the signatory and their signature image.
--   • offers: one row per letter sent to a candidate. Made when an admin
--     approves the final draft: the letter's details are frozen in `fields`
--     and the PDF is saved in the private 'offer-letters' bucket. The
--     offer-letter Edge Function emails it (docs/OFFER_LETTER_SETUP.md).
--       approved → sent → accepted / declined, or withdrawn by an admin.
--     A sent offer past its accept-by date shows as expired.
--   • The candidate answers on a public page (/offer/<token>) through
--     offer_public() and respond_offer(); the random token in the email
--     link is the only key, and it only ever shows that one offer.
--   • Admins only otherwise. Signatures and PDFs are never public.
-- ============================================================

CREATE TABLE IF NOT EXISTS offer_letter_settings (
  id                 boolean     PRIMARY KEY DEFAULT true CHECK (id),   -- a single row
  company_legal_name text        NOT NULL DEFAULT 'Sproutbien LLP' CHECK (length(trim(company_legal_name)) BETWEEN 1 AND 120),
  company_address    text        NOT NULL DEFAULT 'TC-4/2111, Opp. IOB Bank, Kuravankonam, Kowdiar, Thiruvananthapuram, Kerala'
                                 CHECK (length(company_address) <= 300),
  company_phone      text        NOT NULL DEFAULT '+91 75588 00550 / +91 75588 00551' CHECK (length(company_phone) <= 80),
  company_email      text        NOT NULL DEFAULT 'hr@sproutbien.com' CHECK (length(company_email) <= 120),
  company_website    text        NOT NULL DEFAULT '' CHECK (length(company_website) <= 120),
  jurisdiction       text        NOT NULL DEFAULT 'Thiruvananthapuram' CHECK (length(jurisdiction) <= 60),   -- courts named in the terms
  ref_prefix         text        NOT NULL DEFAULT 'SB/HR' CHECK (length(ref_prefix) BETWEEN 1 AND 20),
  signatory_name     text        NOT NULL DEFAULT 'Arun Sivaraj' CHECK (length(trim(signatory_name)) BETWEEN 1 AND 80),
  signatory_title    text        NOT NULL DEFAULT 'Chief Executive Officer' CHECK (length(signatory_title) <= 80),
  signature_path     text,       -- object in 'offer-letters' (signature/…)
  updated_at         timestamptz NOT NULL DEFAULT now(),
  updated_by         uuid        REFERENCES employees(id) ON DELETE SET NULL
);
INSERT INTO offer_letter_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

ALTER TABLE offer_letter_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "offer settings: admin read" ON offer_letter_settings;
CREATE POLICY "offer settings: admin read" ON offer_letter_settings FOR SELECT USING (is_admin());
DROP POLICY IF EXISTS "offer settings: admin update" ON offer_letter_settings;
CREATE POLICY "offer settings: admin update" ON offer_letter_settings FOR UPDATE USING (is_admin()) WITH CHECK (is_admin());

CREATE SEQUENCE IF NOT EXISTS offer_ref_seq;

CREATE TABLE IF NOT EXISTS offers (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id   uuid        NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  ref_no         text        NOT NULL UNIQUE,                 -- e.g. SB/HR/2026/007, set on insert
  status         text        NOT NULL DEFAULT 'approved'
                             CHECK (status IN ('approved', 'sent', 'accepted', 'declined', 'withdrawn')),
  fields         jsonb       NOT NULL,                        -- everything printed on the letter (see src/lib/offerLetter.ts)
  email_to       text        NOT NULL CHECK (length(email_to) BETWEEN 3 AND 200),
  letter_date    date        NOT NULL,
  joining_date   date        NOT NULL,
  accept_by      date        NOT NULL,
  pdf_path       text,                                        -- object in 'offer-letters'
  token          uuid        NOT NULL UNIQUE DEFAULT gen_random_uuid(),   -- the candidate's link
  approved_by    uuid        REFERENCES employees(id) ON DELETE SET NULL DEFAULT auth.uid(),
  approved_at    timestamptz NOT NULL DEFAULT now(),
  sent_at        timestamptz,
  send_count     smallint    NOT NULL DEFAULT 0,
  email_error    text,                                        -- last failed send, cleared on success
  viewed_at      timestamptz,                                 -- first time the candidate opened the link
  responded_at   timestamptz,
  response_name  text        CHECK (response_name IS NULL OR length(response_name) <= 120),   -- name typed to accept
  decline_reason text        CHECK (decline_reason IS NULL OR length(decline_reason) <= 1000),
  response_meta  jsonb,                                       -- IP address and browser of the response
  withdrawn_at   timestamptz,
  CHECK (accept_by >= letter_date)
);

CREATE INDEX IF NOT EXISTS offers_candidate_idx ON offers (candidate_id, approved_at DESC);

ALTER TABLE offers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "offers: admin all" ON offers;
CREATE POLICY "offers: admin all" ON offers FOR ALL USING (is_admin()) WITH CHECK (is_admin());

-- Reference number from the settings prefix and the letter's year
CREATE OR REPLACE FUNCTION set_offer_ref()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.ref_no := (SELECT ref_prefix FROM offer_letter_settings WHERE id)
             || '/' || extract(year FROM NEW.letter_date)::int
             || '/' || lpad(nextval('offer_ref_seq')::text, 3, '0');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_offer_ref ON offers;
CREATE TRIGGER on_offer_ref BEFORE INSERT ON offers FOR EACH ROW EXECUTE FUNCTION set_offer_ref();

-- A letter's content can't change once approved; admins only move it along
CREATE OR REPLACE FUNCTION guard_offer_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.fields IS DISTINCT FROM OLD.fields OR NEW.ref_no IS DISTINCT FROM OLD.ref_no
     OR NEW.token IS DISTINCT FROM OLD.token OR NEW.candidate_id IS DISTINCT FROM OLD.candidate_id
     OR NEW.letter_date IS DISTINCT FROM OLD.letter_date OR NEW.accept_by IS DISTINCT FROM OLD.accept_by
     OR NEW.joining_date IS DISTINCT FROM OLD.joining_date OR NEW.email_to IS DISTINCT FROM OLD.email_to
     OR (OLD.pdf_path IS NOT NULL AND NEW.pdf_path IS DISTINCT FROM OLD.pdf_path) THEN
    RAISE EXCEPTION 'An approved offer letter can''t be changed. Withdraw it and send a revised one.';
  END IF;
  IF NEW.status = 'withdrawn' AND OLD.status <> 'withdrawn' THEN
    IF OLD.status IN ('accepted', 'declined') THEN
      RAISE EXCEPTION 'This offer was already % and can''t be withdrawn', OLD.status;
    END IF;
    NEW.withdrawn_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_offer_update ON offers;
CREATE TRIGGER on_offer_update BEFORE UPDATE ON offers FOR EACH ROW EXECUTE FUNCTION guard_offer_update();

-- ── The candidate's page ────────────────────────────────────

CREATE OR REPLACE FUNCTION offer_effective_status(o offers)
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN o.status = 'sent' AND (now() AT TIME ZONE 'Asia/Kolkata')::date > o.accept_by
              THEN 'expired' ELSE o.status END
$$;

-- What the candidate's page shows (nothing for an unknown token)
CREATE OR REPLACE FUNCTION offer_public(p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  o offers;
BEGIN
  SELECT * INTO o FROM offers WHERE token = p_token AND status <> 'approved';
  IF o.id IS NULL THEN RETURN NULL; END IF;
  IF o.viewed_at IS NULL THEN
    UPDATE offers SET viewed_at = now() WHERE id = o.id;
  END IF;
  RETURN jsonb_build_object(
    'ref_no',        o.ref_no,
    'status',        offer_effective_status(o),
    'candidate_name', o.fields->>'candidate_name',
    'designation',   o.fields->>'designation',
    'department',    o.fields->>'department',
    'company_name',  o.fields->>'company_legal_name',
    'company_email', o.fields->>'company_email',
    'company_phone', o.fields->>'company_phone',
    'ctc_annual',    (o.fields->>'ctc_annual')::numeric,
    'joining_date',  o.joining_date,
    'letter_date',   o.letter_date,
    'accept_by',     o.accept_by,
    'responded_at',  o.responded_at,
    'response_name', o.response_name
  );
END;
$$;

CREATE OR REPLACE FUNCTION respond_offer(p_token uuid, p_accept boolean, p_name text, p_reason text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  o       offers;
  v_hdr   json := COALESCE(nullif(current_setting('request.headers', true), '')::json, '{}'::json);
BEGIN
  SELECT * INTO o FROM offers WHERE token = p_token FOR UPDATE;
  IF o.id IS NULL OR o.status = 'approved' THEN
    RAISE EXCEPTION 'Offer not found';
  END IF;
  IF o.status IN ('accepted', 'declined') THEN
    RAISE EXCEPTION 'You have already % this offer', o.status;
  END IF;
  IF o.status = 'withdrawn' THEN
    RAISE EXCEPTION 'This offer has been withdrawn. Please contact us if you have any questions.';
  END IF;
  IF offer_effective_status(o) = 'expired' THEN
    RAISE EXCEPTION 'This offer lapsed on %. Please contact us if you are still interested.', to_char(o.accept_by, 'FMDD Mon YYYY');
  END IF;
  IF p_accept AND length(trim(COALESCE(p_name, ''))) < 2 THEN
    RAISE EXCEPTION 'Type your full name to accept';
  END IF;

  UPDATE offers SET
    status         = CASE WHEN p_accept THEN 'accepted' ELSE 'declined' END,
    responded_at   = now(),
    response_name  = left(nullif(trim(p_name), ''), 120),
    decline_reason = CASE WHEN p_accept THEN NULL ELSE left(nullif(trim(p_reason), ''), 1000) END,
    response_meta  = jsonb_build_object(
                       'ip', split_part(COALESCE(v_hdr->>'x-forwarded-for', v_hdr->>'x-real-ip', ''), ',', 1),
                       'user_agent', left(COALESCE(v_hdr->>'user-agent', ''), 300))
  WHERE id = o.id;
  RETURN CASE WHEN p_accept THEN 'accepted' ELSE 'declined' END;
END;
$$;

REVOKE EXECUTE ON FUNCTION offer_public(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION offer_public(uuid) TO anon, authenticated;
REVOKE EXECUTE ON FUNCTION respond_offer(uuid, boolean, text, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION respond_offer(uuid, boolean, text, text) TO anon, authenticated;

-- ── Storage: signatures and PDFs, admins only ───────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('offer-letters', 'offer-letters', false, 10485760, ARRAY['application/pdf', 'image/png', 'image/jpeg'])
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "offer-letters: admin read" ON storage.objects;
CREATE POLICY "offer-letters: admin read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'offer-letters' AND public.is_admin());
DROP POLICY IF EXISTS "offer-letters: admin insert" ON storage.objects;
CREATE POLICY "offer-letters: admin insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'offer-letters' AND public.is_admin());
DROP POLICY IF EXISTS "offer-letters: admin delete" ON storage.objects;
CREATE POLICY "offer-letters: admin delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'offer-letters' AND public.is_admin());
