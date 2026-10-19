-- ============================================================
-- 046 — The product is now "People Desk" (was "Attendance Tracker")
-- Only replaces the old default; a name a customer set themselves is kept.
-- ============================================================

ALTER TABLE branding ALTER COLUMN product_name SET DEFAULT 'People Desk';

UPDATE branding SET product_name = 'People Desk', updated_at = now()
 WHERE product_name = 'Attendance Tracker';
