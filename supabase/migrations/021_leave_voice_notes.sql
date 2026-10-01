-- 021: Optional voice note on leave requests
--
--   • Employees can record up to 2 minutes of audio when requesting leave.
--   • A written reason OR a voice note is required (either is enough).
--   • Recordings live in the private 'leave-voice-notes' bucket under <employee id>/…
--     Employees can hear their own; admins can hear everyone's. Kept forever.

ALTER TABLE leave_requests
  ADD COLUMN IF NOT EXISTS voice_note_path    text,       -- object path in the 'leave-voice-notes' bucket
  ADD COLUMN IF NOT EXISTS voice_note_seconds smallint;

-- The recording must sit in the requester's own folder
ALTER TABLE leave_requests DROP CONSTRAINT IF EXISTS leave_requests_voice_note_owner;
ALTER TABLE leave_requests ADD CONSTRAINT leave_requests_voice_note_owner
  CHECK (voice_note_path IS NULL OR voice_note_path LIKE employee_id::text || '/%');

ALTER TABLE leave_requests DROP CONSTRAINT IF EXISTS leave_requests_voice_note_length;
ALTER TABLE leave_requests ADD CONSTRAINT leave_requests_voice_note_length
  CHECK (voice_note_seconds IS NULL OR voice_note_seconds BETWEEN 0 AND 125);

-- Written reason or voice note (NOT VALID: older rows aren't re-checked)
ALTER TABLE leave_requests DROP CONSTRAINT IF EXISTS leave_requests_reason_or_voice;
ALTER TABLE leave_requests ADD CONSTRAINT leave_requests_reason_or_voice
  CHECK (length(trim(reason)) > 0 OR voice_note_path IS NOT NULL) NOT VALID;

-- ── Storage ────────────────────────────────────────────────
-- Private bucket; 5 MB covers 2 minutes in every browser's format (Safari's AAC is the largest)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('leave-voice-notes', 'leave-voice-notes', false, 5242880,
        ARRAY['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/aac', 'audio/x-m4a'])
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "leave-voice-notes: own folder insert" ON storage.objects;
CREATE POLICY "leave-voice-notes: own folder insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'leave-voice-notes' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "leave-voice-notes: own folder or admin read" ON storage.objects;
CREATE POLICY "leave-voice-notes: own folder or admin read"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'leave-voice-notes' AND ((storage.foldername(name))[1] = auth.uid()::text OR public.is_admin()));

-- Only lets the app clean up an upload whose leave request then failed to save;
-- once a request points at the recording, the employee can't remove it
DROP POLICY IF EXISTS "leave-voice-notes: unattached own delete" ON storage.objects;
CREATE POLICY "leave-voice-notes: unattached own delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'leave-voice-notes'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND NOT EXISTS (SELECT 1 FROM public.leave_requests lr WHERE lr.voice_note_path = storage.objects.name)
  );
