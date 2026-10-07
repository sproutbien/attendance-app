# Offer letters — setup

Admins write an offer letter from **Hiring → candidate → Offer letter**, check the final draft, and approve it.
The app then saves the letter as a PDF and emails it from `hr@sproutbien.com`, with a copy to HR. The candidate
accepts or declines on a private link. When you **Hire** someone who accepted, the letter is filed under their
documents ("Offer letter").

Email goes through [Resend](https://resend.com), a transactional email service. Its free plan is plenty for offer letters.

## 1. Database

In Supabase → SQL Editor, run `supabase/migrations/044_offer_letters.sql` (and `043_…` if it hasn't been run yet).

## 2. Let Resend send as sproutbien.com

1. Sign up at resend.com (use the HR or admin email).
2. **Domains → Add domain** → `sproutbien.com`. Pick the region closest to India (e.g. Tokyo or Singapore, if offered).
3. Resend shows a few DNS records (TXT records for SPF and DKIM, and an MX record). Add each one where the domain's DNS
   is managed (the registrar, e.g. GoDaddy, or Cloudflare), exactly as shown.
   These don't affect your existing mailboxes: they are added on a `send.` subdomain plus one `resend._domainkey` record.
4. Back in Resend, click **Verify**. It usually takes minutes; it can take a few hours.
5. **API Keys → Create API key** with *Sending access*, and copy it.

`hr@sproutbien.com` should be a real mailbox: candidates' replies go there, and it gets a copy of every offer sent.

## 3. Supabase secrets and the function

In the Supabase dashboard (same way as the WhatsApp function):

1. **Edge Functions → Secrets** → add:
   - `RESEND_API_KEY` = the key from Resend (`re_…`)
   - `OFFER_FROM` = `Sproutbien HR <hr@sproutbien.com>`
   - `APP_URL` = the app's web address, e.g. `https://your-app.vercel.app` (no trailing slash)
   - optional `OFFER_BCC` = where the HR copy goes, if not the HR email in Letter settings
2. **Edge Functions → Deploy a new function → Via Editor**. Name it exactly `offer-letter`, replace the editor
   contents with `supabase/functions/offer-letter/index.ts`, and click **Deploy**.
3. Open the function → **Details** → turn **off** "Verify JWT" (the switch may say "Enforce JWT verification")
   → **Save**. The candidate's page calls it without signing in; the function checks admins itself.

With the CLI instead: `supabase secrets set NAME=value` for each secret, then
`supabase functions deploy offer-letter --no-verify-jwt`.

`APP_URL` is the address employees use to open the app (no trailing slash). It goes into the email's
"View and respond" link.

## 4. Letter settings (in the app)

Hiring → any candidate → **Offer letter → Letter settings**:

- **Signature:** upload `private/sign-clean.png`, the Director's signature with a transparent background.
  Don't put signatures in `public/`; everything there is published on the website.
- Check the signatory (Arun Sivaraj, Chief Executive Officer), company name, address, phone, HR email,
  and the city whose courts are named in the terms.

## 5. Try it

Add yourself as a candidate with your own email, write a letter, approve it, and check:
the email arrives (and the HR copy), the PDF opens, and the link lets you accept.
Then use **Withdraw** on that test offer and delete the test candidate.

## How it behaves

- **Approved letters can't be edited.** To change anything, write a revised offer. Sending it withdraws the earlier one,
  and the old link then says so.
- **Reference numbers** are `SB/HR/<year>/<number>`. Change the prefix in Letter settings.
- **Reply by:** after that date the offer shows as *Expired*, and the candidate can't accept it.
  Send a revised offer with a new date if needed.
- **Accepting** records the name the candidate typed, the time, their IP address and browser.
  That's normal practice for online acceptance. If you ever need a stronger signature, ask the candidate to sign the
  printed acceptance on the last page and return it.
- If an email fails (e.g. a typo in the address), the letter stays saved with the error shown. Use **Send** to try again.
