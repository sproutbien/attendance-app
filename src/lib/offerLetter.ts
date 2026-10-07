import { supabase } from './supabase'
import type { Candidate } from '../types'

// Offer letters — must match migration 044. The letter is built once as a list
// of blocks (letterBlocks), which both the on-screen preview (LetterPreview)
// and the PDF (offerPdf.ts) draw, so what you approve is what gets sent.

export const OFFER_BUCKET = 'offer-letters'

export type OfferSettings = {
  company_legal_name: string
  company_address: string
  company_phone: string
  company_email: string
  company_website: string
  jurisdiction: string
  ref_prefix: string
  signatory_name: string
  signatory_title: string
  signature_path: string | null
}

/** Everything printed on a letter. Frozen in offers.fields when approved. */
export type OfferFields = {
  letter_date: string           // ISO date
  salutation: '' | 'Mr.' | 'Ms.' | 'Mx.' | 'Dr.'
  candidate_name: string
  candidate_address: string     // one line per line of the address
  candidate_email: string
  designation: string
  department: string
  reporting_to: string
  employment_type: string       // e.g. Full-time
  joining_date: string
  accept_by: string
  ctc_annual: number            // rupees per year
  probation_months: number      // 0 = no probation
  probation_notice_days: number
  notice_days: number
  work_location: string
  working_hours: string         // e.g. Monday to Saturday, 9:30 AM to 6:30 PM
  additional_terms: string
  // From the settings at the time of approval
  company_legal_name: string
  company_address: string
  company_phone: string
  company_email: string
  company_website: string
  jurisdiction: string
  signatory_name: string
  signatory_title: string
}

export type OfferStatus = 'approved' | 'sent' | 'accepted' | 'declined' | 'withdrawn'

export type Offer = {
  id: string
  candidate_id: string
  ref_no: string
  status: OfferStatus
  fields: OfferFields
  email_to: string
  letter_date: string
  joining_date: string
  accept_by: string
  pdf_path: string | null
  token: string                 // the candidate's link: /offer/<token>
  approved_at: string
  sent_at: string | null
  send_count: number
  email_error: string | null
  viewed_at: string | null
  responded_at: string | null
  response_name: string | null
  decline_reason: string | null
  withdrawn_at: string | null
}

export type OfferShownStatus = OfferStatus | 'expired'

export const OFFER_STATUS: Record<OfferShownStatus, { label: string; bg: string; text: string }> = {
  approved:  { label: 'Not sent',  bg: '#fef3c7', text: '#92400e' },
  sent:      { label: 'Sent',      bg: '#e0f2fe', text: '#075985' },
  accepted:  { label: 'Accepted',  bg: '#dcfce7', text: '#166534' },
  declined:  { label: 'Declined',  bg: '#fee2e2', text: '#991b1b' },
  withdrawn: { label: 'Withdrawn', bg: '#f1f5f9', text: '#475569' },
  expired:   { label: 'Expired',   bg: '#f1f5f9', text: '#475569' },
}

/** A sent offer past its accept-by date is expired. Mirrors offer_effective_status(). */
export function shownStatus(o: Pick<Offer, 'status' | 'accept_by'>, today: string): OfferShownStatus {
  return o.status === 'sent' && today > o.accept_by ? 'expired' : o.status
}

// ── Formatting ───────────────────────────────────────────────

/** "8 October 2026" */
export function fmtLetterDate(iso: string) {
  if (!iso) return '—'
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
}

/** 360000 → "3,60,000" */
export function fmtINR(n: number) {
  return Math.round(n).toLocaleString('en-IN')
}

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve',
  'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen']
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']

function belowHundred(n: number) {
  return n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ' ' + ONES[n % 10] : ''}`
}

function belowThousand(n: number) {
  const h = Math.floor(n / 100), r = n % 100
  return [h ? `${ONES[h]} Hundred` : '', r ? belowHundred(r) : ''].filter(Boolean).join(' ')
}

/** 360000 → "Three Lakh Sixty Thousand" (Indian numbering) */
export function amountInWords(amount: number) {
  let n = Math.round(amount)
  if (n === 0) return 'Zero'
  const parts: string[] = []
  const crore = Math.floor(n / 1_00_00_000); n %= 1_00_00_000
  const lakh = Math.floor(n / 1_00_000); n %= 1_00_000
  const thousand = Math.floor(n / 1000); n %= 1000
  if (crore) parts.push(`${amountInWords(crore)} Crore`)
  if (lakh) parts.push(`${belowHundred(lakh)} Lakh`)
  if (thousand) parts.push(`${belowHundred(thousand)} Thousand`)
  if (n) parts.push(belowThousand(n))
  return parts.join(' ')
}

export function ctcText(n: number) {
  return `INR ${fmtINR(n)} (Rupees ${amountInWords(n)} Only) per annum`
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`
const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? ''

// ── The letter ───────────────────────────────────────────────

/**
 * Text may use **bold**. Blocks are drawn top to bottom; the PDF starts a new
 * page when one doesn't fit.
 */
export type LetterBlock =
  | { kind: 'meta'; left: string; right: string }
  | { kind: 'label'; text: string }
  | { kind: 'lines'; lines: string[] }
  | { kind: 'subject'; text: string }
  | { kind: 'para'; text: string; small?: boolean }
  | { kind: 'table'; rows: [string, string][] }
  | { kind: 'list'; items: string[] }
  | { kind: 'signature' }
  | { kind: 'pagebreak' }
  | { kind: 'heading'; text: string }
  | { kind: 'clause'; number: number; title: string; text: string }
  | { kind: 'signlines'; labels: string[] }

export function letterBlocks(f: OfferFields, refNo: string): LetterBlock[] {
  const company = f.company_legal_name
  const name = [f.salutation, f.candidate_name.trim()].filter(Boolean).join(' ')
  const probation = f.probation_months > 0
  const joining = fmtLetterDate(f.joining_date)
  const contact = [f.company_phone, f.company_email].filter(Boolean).join(' or ')

  const summary: [string, string][] = [
    ['Position', f.designation],
    ...(f.department.trim() ? [['Department', f.department.trim()] as [string, string]] : []),
    ...(f.reporting_to.trim() ? [['Reporting to', f.reporting_to.trim()] as [string, string]] : []),
    ['Employment type', f.employment_type || 'Full-time'],
    ['Date of joining', `On or before ${joining}`],
    ['Place of work', f.work_location],
    ['Annual CTC', `INR ${fmtINR(f.ctc_annual)} (Rupees ${amountInWords(f.ctc_annual)} Only)`],
    ...(probation ? [['Probation', plural(f.probation_months, 'month')] as [string, string]] : []),
    ['Notice period', `${plural(f.notice_days, 'day')}${probation ? ' (after confirmation)' : ''}`],
  ]

  const clauses: [string, string][] = [
    ['Commencement',
      `Your employment will begin on the date you join, which should be on or before ${joining}. If you are unable to join by this date, please let us know in advance; unless a later date is agreed in writing, this offer may be withdrawn.`],
    ['Probation', probation
      ? `You will be on probation for ${plural(f.probation_months, 'month')} from your date of joining. During probation, either you or the Company may end your employment by giving ${plural(f.probation_notice_days, 'day')}’ written notice. On successful completion, your confirmation will be communicated to you in writing. If needed, the Company may extend your probation by up to three months, and will inform you in writing.`
      : 'Your employment will be confirmed from your date of joining; there is no probation period.'],
    ['Compensation',
      `Your annual Cost to Company (CTC) will be ${ctcText(f.ctc_annual)}. Your salary will be paid monthly, in arrears, by bank transfer, after deductions required by law, such as income tax (TDS), professional tax and statutory contributions where applicable. Any statutory contributions that apply now or in the future will be accommodated within your CTC. Your compensation will be reviewed annually based on your performance and the Company’s business; a review does not guarantee an increase.`],
    ['Hours of work',
      `Your normal working hours will be ${f.working_hours || 'as per your assigned shift'}, which the Company may change with reasonable notice. Attendance is recorded through the Company’s attendance app. You may occasionally be required to work additional hours to meet business needs.`],
    ['Place of work',
      `You will be based at ${f.work_location}. The Company may ask you to work from another office, at a client’s site or remotely, as business requires, with reasonable notice.`],
    ['Leave and holidays',
      'You will be entitled to leave and public holidays in accordance with the Company’s leave policy, as amended from time to time. The current policy is available to you in the Company’s HR app.'],
    ['Duties',
      'You will carry out the duties of your role and any other reasonable duties the Company may assign to you in line with your skills and experience. You will devote your full working time, attention and abilities to the Company’s business.'],
    ['Other employment',
      'While employed with the Company, you may not take up any other employment, business or paid assignment, whether full-time, part-time or freelance, without the Company’s prior written consent.'],
    ['Confidentiality',
      'You must keep confidential all non-public information about the Company, its clients, employees and business, both during and after your employment, and use it only for your work with the Company. This includes the details of your own compensation.'],
    ['Intellectual property',
      'All work, designs, content, software, ideas and other material that you create in the course of your employment will belong to the Company. You agree to sign any documents reasonably required to confirm this.'],
    ['Company property and information security',
      'You must follow the Company’s IT and information security policies. Company accounts and credentials may only be used on devices approved by the Company. When you leave, or whenever asked, you must return all Company property, documents and data, and must not keep any copies.'],
    ['Documents',
      'On or before your date of joining, please provide copies of your educational certificates; relieving and experience letters from previous employers (if any); proof of identity and address (such as Aadhaar or passport); your PAN card; bank account details for salary payments; and a recent passport-size photograph. You can upload these through the Company’s HR app.'],
    ['Code of conduct',
      'You must follow the Company’s policies, as amended from time to time, including its code of conduct, anti-bribery policy and policy on the prevention of sexual harassment at the workplace (POSH). You must not offer, give or accept any bribe or improper payment, and must report any such request or offer. Any breach may lead to disciplinary action, up to and including termination of employment.'],
    ['Notice and termination',
      `${probation ? 'After confirmation, either' : 'Either'} you or the Company may end your employment by giving ${plural(f.notice_days, 'day')}’ written notice, or salary in lieu of notice. The Company may, at its discretion, accept a shorter notice period or adjust unused leave against it. The Company may end your employment immediately, without notice or salary in lieu, in the event of serious misconduct, including dishonesty, fraud, breach of confidentiality, or providing false information about your qualifications or experience.`],
    ['General',
      `These terms, together with the offer letter, replace all earlier discussions and communications about your employment. Any change to them will be made in writing by the Company. These terms are governed by the laws of India, and the courts at ${f.jurisdiction || 'the Company’s registered office'} will have exclusive jurisdiction.`],
  ]
  if (f.additional_terms.trim()) clauses.push(['Additional terms', f.additional_terms.trim()])

  return [
    { kind: 'meta', left: `Ref: ${refNo}`, right: `Date: ${fmtLetterDate(f.letter_date)}` },
    { kind: 'label', text: 'PRIVATE AND CONFIDENTIAL' },
    { kind: 'lines', lines: [`**${name}**`, ...f.candidate_address.split('\n').map(l => l.trim()).filter(Boolean), f.candidate_email].filter(Boolean) },
    { kind: 'subject', text: `Offer of Employment – ${f.designation}` },
    { kind: 'para', text: `Dear ${firstName(f.candidate_name)},` },
    { kind: 'para', text: `Following our recent discussions, we are pleased to offer you the position of **${f.designation}** at **${company}** (“the Company”). We were impressed by your skills and experience, and we are confident that you will make a valuable contribution to our team.` },
    { kind: 'para', text: 'The key terms of this offer are summarised below:' },
    { kind: 'table', rows: summary },
    { kind: 'para', text: 'Your detailed terms and conditions of employment are set out in the Annexure to this letter, which forms part of this offer. This offer is subject to:' },
    { kind: 'list', items: [
      'satisfactory verification of your educational qualifications, previous employment and identity;',
      'your providing the documents listed in Clause 12 of the Annexure on or before your date of joining; and',
      'the information you have shared with us being true and complete.',
    ] },
    { kind: 'para', text: `Please confirm your acceptance by **${fmtLetterDate(f.accept_by)}**, either online using the link in the email that accompanied this letter, or by signing the acceptance at the end of the Annexure and returning a copy to us. If we do not receive your acceptance by then, this offer will lapse.` },
    { kind: 'para', text: `If you have any questions, please contact us${contact ? ` at ${contact}` : ''}. We look forward to welcoming you to the team.` },
    { kind: 'signature' },
    { kind: 'para', small: true, text: 'Note: Your compensation details are confidential. Please do not share them with anyone, except as required by law.' },
    { kind: 'pagebreak' },
    { kind: 'heading', text: 'Annexure – Terms and Conditions of Employment' },
    { kind: 'para', text: `These terms form part of the offer letter dated ${fmtLetterDate(f.letter_date)} (Ref: ${refNo}) from ${company} to ${f.candidate_name.trim()}.` },
    ...clauses.map(([title, text], i): LetterBlock => ({ kind: 'clause', number: i + 1, title, text })),
    { kind: 'heading', text: 'Acceptance' },
    { kind: 'para', text: `I have read and understood this offer letter and its Annexure, and I accept the offer of employment on these terms. I will join on or before ${joining}.` },
    { kind: 'signlines', labels: ['Name', 'Signature', 'Date'] },
  ]
}

/** Splits "a **b** c" into runs. */
export function boldRuns(text: string): { text: string; bold: boolean }[] {
  return text.split('**').map((t, i) => ({ text: t, bold: i % 2 === 1 })).filter(r => r.text)
}

// ── Form ─────────────────────────────────────────────────────

/** What's missing before the letter can be approved, or null. */
export function offerProblem(f: OfferFields): string | null {
  if (!f.candidate_name.trim()) return 'Enter the candidate’s name.'
  if (!/^\S+@\S+\.\S+$/.test(f.candidate_email.trim())) return 'Enter a valid email address for the candidate.'
  if (!f.designation.trim()) return 'Enter the position.'
  if (!f.work_location.trim()) return 'Enter the place of work.'
  if (!(f.ctc_annual > 0)) return 'Enter the annual CTC.'
  if (!f.joining_date) return 'Choose the date of joining.'
  if (!f.accept_by) return 'Choose the date to accept by.'
  if (f.accept_by < f.letter_date) return 'The accept-by date can’t be before the letter date.'
  if (f.joining_date < f.letter_date) return 'The date of joining can’t be before the letter date.'
  if (f.notice_days < 0 || f.probation_months < 0 || f.probation_notice_days < 0) return 'Periods can’t be negative.'
  return null
}

/** A new letter for a candidate: their details, the latest letter's terms (if any) and the settings. */
export function draftFields(c: Candidate, s: OfferSettings, today: string, last: OfferFields | null, workingHours: string): OfferFields {
  const plusDays = (n: number) => {
    const d = new Date(today + 'T00:00:00'); d.setDate(d.getDate() + n)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }
  return {
    salutation: '', candidate_address: '', department: '', reporting_to: '', additional_terms: '',
    employment_type: 'Full-time', ctc_annual: 0, probation_months: 6, probation_notice_days: 15, notice_days: 30,
    work_location: s.company_address, working_hours: workingHours, joining_date: plusDays(14),
    ...last,
    // Always fresh
    letter_date: today,
    accept_by: plusDays(7),
    candidate_name: last?.candidate_name ?? c.full_name,
    candidate_email: c.email ?? last?.candidate_email ?? '',
    designation: last?.designation ?? c.role ?? '',
    company_legal_name: s.company_legal_name,
    company_address: s.company_address,
    company_phone: s.company_phone,
    company_email: s.company_email,
    company_website: s.company_website,
    jurisdiction: s.jurisdiction,
    signatory_name: s.signatory_name,
    signatory_title: s.signatory_title,
  }
}

// ── Data ─────────────────────────────────────────────────────

export async function loadOfferSettings(): Promise<OfferSettings> {
  const { data, error } = await supabase.from('offer_letter_settings').select('*').single()
  if (error) throw new Error(error.message.includes('offer_letter_settings')
    ? 'Offer letters aren’t set up yet: run migration 044 in Supabase.' : error.message)
  return data as OfferSettings
}

/** The signature image (admins only), or null if none is set. */
export async function loadSignature(path: string | null): Promise<Blob | null> {
  if (!path) return null
  const { data } = await supabase.storage.from(OFFER_BUCKET).download(path)
  return data ?? null
}

export async function uploadSignature(file: File): Promise<string> {
  if (!/^image\/(png|jpeg)$/.test(file.type)) throw new Error('Use a PNG (best, with a transparent background) or JPEG image.')
  if (file.size > 2 * 1024 * 1024) throw new Error('The image is larger than 2 MB.')
  const path = `signature/${crypto.randomUUID()}.${file.type === 'image/png' ? 'png' : 'jpg'}`
  const { error } = await supabase.storage.from(OFFER_BUCKET).upload(path, file, { contentType: file.type })
  if (error) throw new Error(`Couldn’t upload the signature: ${error.message}`)
  return path
}

/** Opens a letter's PDF in a new tab. */
export async function openOfferPdf(o: Pick<Offer, 'pdf_path'>) {
  if (!o.pdf_path) return 'This letter has no PDF.'
  const tab = window.open('', '_blank')   // opened now so pop-up blockers allow it
  const { data, error } = await supabase.storage.from(OFFER_BUCKET).createSignedUrl(o.pdf_path, 60 * 10)
  if (error || !data) { tab?.close(); return error?.message ?? 'PDF not found' }
  if (tab) tab.location.href = data.signedUrl
  else window.location.href = data.signedUrl
  return null
}

/** Emails a letter (first send or again) through the offer-letter Edge Function. Returns an error message or null. */
export async function sendOffer(offerId: string): Promise<string | null> {
  const { data, error } = await supabase.functions.invoke('offer-letter', { body: { action: 'send', offer_id: offerId } })
  if (error) {
    // The function's own message is in the response body
    const ctx = (error as { context?: Response }).context
    try { const body = await ctx?.json(); if (body?.error) return body.error } catch { /* not JSON */ }
    return error.message.includes('Failed to send a request')
      ? 'The email service isn’t set up yet (the offer-letter function isn’t deployed). The letter is saved; send it once that’s done.'
      : error.message
  }
  if (data?.ok === true) return null
  return data?.error
    ?? 'The email function gave an unexpected answer, so the letter may not have been sent. Check that the offer-letter code is deployed in Supabase (docs/OFFER_LETTER_SETUP.md).'
}

/** File name for a letter's PDF. */
export function offerFileName(o: Pick<Offer, 'ref_no'> & { fields: Pick<OfferFields, 'candidate_name'> }) {
  return `Offer Letter - ${o.fields.candidate_name.trim()} - ${o.ref_no.replace(/\//g, '-')}.pdf`
}
