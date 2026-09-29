# WhatsApp leave notifications — setup

Notifications sent automatically:

| When | To | Template |
|---|---|---|
| Employee submits a leave request | Admin number(s) | `leave_request_admin` |
| Admin approves a request | The employee | `leave_approved` |
| Admin declines a request | The employee | `leave_rejected` |
| Employee cancels a request (pending or approved) | Admin number(s) | `leave_cancelled_admin` |

How it works: a database trigger (`on_leave_whatsapp`, migration 006) calls the
`leave-whatsapp` Edge Function in the background. The function reads the leave
request and sends a WhatsApp template through Meta's Cloud API. If anything is
not configured or WhatsApp fails, the leave request itself still goes through;
the error shows up in the Edge Function logs.

> **Sending vs receiving number.** The number the app sends *from* must be a
> different number from the admin's number that *receives* alerts (WhatsApp
> can't message itself). The sending number must not be registered on the
> regular WhatsApp or WhatsApp Business app, unless you enable Meta's
> "coexistence" onboarding for it.

---

## 1. Database

In Supabase → **SQL Editor**, run `supabase/migrations/006_whatsapp_notifications.sql`.

This adds the `phone` column to employees, enables `pg_net`, and creates the trigger.
**Run this before deploying the app update**, because the Employees page now saves `phone`.

## 2. Meta: WhatsApp Business Platform

1. Go to <https://developers.facebook.com/apps> → **Create app** → use case
   **"Connect with customers through WhatsApp"** (type *Business*), and link it
   to your Meta Business portfolio (create one if asked).
2. In the app, open **WhatsApp → API Setup**.
   - Meta gives you a free **test number**, which is fine for trying things out.
     A test number can only message up to 5 recipient numbers that you add and
     verify under "To".
   - For real use, click **Add phone number** and register your sending number
     (verify it by SMS or call).
3. Note the **Phone number ID** (not the phone number itself) shown for the sending number.
4. Add a **payment method** in WhatsApp Manager → *Account tools → Payment methods*.
   Each utility template message is charged by Meta.

### Permanent access token

The token shown on the API Setup page expires after 24 hours. Create a permanent one:

1. <https://business.facebook.com/settings> → **Users → System users** → **Add**
   (role: Admin).
2. **Assign assets**: add your **app** (full control) and your **WhatsApp account** (full control).
3. **Generate new token** → choose the app → expiry **Never** → permissions
   `whatsapp_business_messaging` and `whatsapp_business_management`.
4. Copy the token. You won't be able to see it again.

## 3. Message templates

WhatsApp Manager → **Message templates** → **Create template**.
Create all four with **Category: Utility**, **Language: English** (code `en`).
Meta approval usually takes minutes to a day. The names must match exactly.

**`leave_request_admin`**
```
New leave request from {{1}} ({{2}}).

Dates: {{3}} ({{4}})
Reason: {{5}}

Please review it in the Sproutbien attendance app.
```
Sample values: `Priya Patel`, `Design`, `3 Oct 2026 – 5 Oct 2026`, `3 days`, `Family function`

**`leave_cancelled_admin`**
```
{{1}} ({{2}}) has cancelled their leave.

Dates: {{3}} ({{4}})
The request was {{5}} before it was cancelled.
```
Sample values: `Priya Patel`, `Design`, `3 Oct 2026 – 5 Oct 2026`, `3 days`, `approved`

**`leave_approved`**
```
Hi {{1}}, your leave request for {{2}} has been ✅ APPROVED.

Enjoy your time off!
```
Sample values: `Priya`, `3 Oct 2026 – 5 Oct 2026`

**`leave_rejected`**
```
Hi {{1}}, your leave request for {{2}} has been ❌ DECLINED.

Please contact your manager for details.
```
Sample values: `Priya`, `3 Oct 2026 – 5 Oct 2026`

You can change the wording, but keep the same number and order of `{{n}}` parameters.
If you choose a language other than plain "English" (e.g. "English (UK)" = `en_GB`),
set the `WHATSAPP_TEMPLATE_LANGUAGE` secret to that code.

## 4. Edge Function

Supabase → **Edge Functions** → **Deploy a new function** → **Via Editor**.

1. Name it exactly **`leave-whatsapp`**.
2. Replace the editor contents with `supabase/functions/leave-whatsapp/index.ts` → **Deploy**.
3. Open the function → **Details** → turn **off** "Enforce JWT verification" / "Verify JWT"
   → Save. The database calls it with its own shared secret instead of a user login.

   *(CLI alternative: `supabase functions deploy leave-whatsapp --no-verify-jwt`)*

Copy the function URL. It looks like `https://<project-ref>.supabase.co/functions/v1/leave-whatsapp`.

### Secrets

First generate a random shared secret. In the SQL Editor run:
```sql
select encode(extensions.gen_random_bytes(32), 'hex');
```

Edge Functions → **Secrets** → add:

| Name | Value |
|---|---|
| `WHATSAPP_TOKEN` | the permanent token from step 2 |
| `WHATSAPP_PHONE_NUMBER_ID` | the Phone number ID from step 2 |
| `ADMIN_WHATSAPP_NUMBERS` | admin number(s) with country code, digits only, comma-separated, e.g. `919876543210` |
| `LEAVE_WEBHOOK_SECRET` | the random secret you just generated |

Optional: `WHATSAPP_TEMPLATE_LANGUAGE` (default `en`), `WHATSAPP_API_VERSION` (default `v23.0`).

## 5. Point the database at the function

SQL Editor. Use your function URL and **the same** random secret:
```sql
select vault.create_secret('https://<project-ref>.supabase.co/functions/v1/leave-whatsapp', 'leave_whatsapp_url');
select vault.create_secret('<the-random-secret>', 'leave_whatsapp_secret');
```
Until these two exist, the trigger does nothing, so leave requests work as before.

To change one later:
```sql
select vault.update_secret(id, '<new value>') from vault.secrets where name = 'leave_whatsapp_url';
```

## 6. Employee numbers

Admin → **Employees** → **Edit** each employee → **WhatsApp number**.
Employees without a number are marked "no WhatsApp number" and simply won't get
approval/decline messages.

Let employees know they'll receive these messages. Meta requires recipients to
have agreed to receive them.

## 7. Test

1. Log in as an employee who has a phone number → submit a leave request → the admin
   number should get `leave_request_admin`.
2. As admin, approve or decline it → the employee should get `leave_approved` / `leave_rejected`.

### If nothing arrives

- **Edge Functions → leave-whatsapp → Logs.** Meta's error message is logged here
  (e.g. template not approved, wrong phone number ID, expired token, recipient not
  in the test-number allow list).
- **No log entry at all?** The database didn't reach the function. Check the last calls:
  ```sql
  select created, status_code, content from net._http_response order by created desc limit 5;
  ```
  `401` = the Vault secret and `LEAVE_WEBHOOK_SECRET` differ, or JWT verification
  is still on. No rows = the Vault secrets are missing or misnamed.
