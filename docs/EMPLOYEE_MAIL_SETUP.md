# Mail to employees — setup

Admins open **Mail** in the admin menu, write an update or a greeting, pick who gets it, check the preview and send.
Each person gets their **own email**, addressed only to them, with their details filled in:

| Field | Becomes |
|---|---|
| `{{first_name}}` | Priya |
| `{{full_name}}` | Priya Nair |
| `{{designation}}` | Senior Designer |
| `{{department}}` | Design |
| `{{employee_code}}` | SB004 |
| `{{joining_date}}` | 8 November 2023 |
| `{{years}}` | 3 (whole years with the company, on the day it's sent) |
| `{{company_name}}` | Sproutbien (from Branding) |

Fields work in the subject too. The page warns you when someone would get a blank (no designation saved, say), and
won't send if a field name is misspelt.

It uses the same Resend account as the offer letters (`docs/OFFER_LETTER_SETUP.md`). If those already work,
there are only three steps.

## 1. Database

In Supabase → SQL Editor, run `supabase/migrations/049_employee_mail.sql`.
It adds the history tables and four starter templates (birthday, work anniversary, festival, important update).

## 2. Secrets

**Edge Functions → Secrets.** `RESEND_API_KEY` is already there from the offer letters. Optionally add:

- `MAIL_FROM`: the sender, e.g. `Sproutbien HR <hr@sproutbien.com>`. If it's not set, `OFFER_FROM` is used.
- `MAIL_REPLY_TO`: where replies go. If it's not set, the HR email in Letter settings is used.

## 3. Deploy the function

**Edge Functions → Deploy a new function → Via Editor**. Name it exactly `employee-mail`, replace the editor
contents with `supabase/functions/employee-mail/index.ts`, and click **Deploy**.
Leave **Verify JWT** on. Only signed-in admins call this function, and it checks that they are admins.

With the CLI instead: `supabase functions deploy employee-mail`.

## 4. Try it

Pick only yourself, send a short update, and check that it arrives and that the details are right. Then try a greeting.

## How it behaves

- **Updates** go to everyone you pick. **Greetings** skip anyone with "no celebrations" ticked on their profile.
  They're listed as *skipped* in History.
- The list shows current staff only (not resigned, terminated, inactive or in the bin).
  It tags upcoming birthdays and anniversaries for the next 7 days. **Celebrating today** picks those people in one click.
- **History** shows every message with sent, failed and skipped counts. Open one to see each person's result and the reason
  for any failure. **Retry failed** sends those again using their current details, so fix a wrong email address
  on the employee's profile first.
- **Formatting:** a blank line starts a new paragraph, `**two stars**` make text bold, and links become clickable.
- **Limits:** Resend's free plan sends 100 emails a day and 3,000 a month. If you hit the limit, the rest show as
  failed with Resend's message; use **Retry failed** the next day, or move to a paid plan.
  One send can go to up to 1,000 people.
