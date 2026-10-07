import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import type { PDFFont, PDFImage, PDFPage, RGB } from 'pdf-lib'
import { boldRuns, letterBlocks } from './offerLetter'
import type { LetterBlock, OfferFields } from './offerLetter'

// Draws an offer letter (letterBlocks) as an A4 PDF. Loaded only when a letter
// is approved (dynamic import), so pdf-lib stays out of the main bundle.

const W = 595.28, H = 841.89          // A4 in points
const ML = 62, MR = 62                // side margins
const CONTENT_W = W - ML - MR
const BOTTOM = 64                     // keep text above the footer
const SIZE = 10.5, LEAD = 15.5

const INK = rgb(0.12, 0.16, 0.22)
const MUTED = rgb(0.4, 0.45, 0.52)
const RULE = rgb(0.85, 0.87, 0.9)
const ZEBRA = rgb(0.965, 0.972, 0.98)

type Fonts = { regular: PDFFont; bold: PDFFont; italic: PDFFont }
type Word = { text: string; font: PDFFont; space: boolean }   // space: a space comes before it

function hexColor(hex: string): RGB {
  const n = parseInt(hex.replace('#', ''), 16)
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255)
}

/**
 * Width as drawn. pdf-lib's own measure applies kerning pairs (e.g. "Yo"), but
 * drawText doesn't kern, so laying out with it lets the next word overlap.
 */
const widthCache = new Map<PDFFont, Map<string, number>>()
function textWidth(font: PDFFont, text: string, size: number) {
  let m = widthCache.get(font)
  if (!m) widthCache.set(font, m = new Map())
  let w = 0
  for (const ch of text) {
    let cw = m.get(ch)
    if (cw === undefined) m.set(ch, cw = font.widthOfTextAtSize(ch, 1000))
    w += cw
  }
  return (w * size) / 1000
}

/** Standard PDF fonts only cover Western characters; anything else becomes "?". */
function safe(font: PDFFont, text: string) {
  let out = ''
  for (const ch of text.replace(/ /g, ' ')) {
    try { textWidth(font, ch, 10); out += ch } catch { out += '?' }
  }
  return out
}

async function embedImage(doc: PDFDocument, bytes: ArrayBuffer | null): Promise<PDFImage | null> {
  if (!bytes || bytes.byteLength < 4) return null
  const b = new Uint8Array(bytes)
  try {
    if (b[0] === 0x89 && b[1] === 0x50) return await doc.embedPng(bytes)
    if (b[0] === 0xff && b[1] === 0xd8) return await doc.embedJpg(bytes)
  } catch { /* unreadable image: leave it out */ }
  return null   // SVG / WebP logos can't go in a PDF
}

export async function buildOfferPdf(f: OfferFields, refNo: string, opts: {
  logo: ArrayBuffer | null
  signature: ArrayBuffer | null
  brandColor: string
}): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.setTitle(`Offer of Employment – ${f.candidate_name}`)
  doc.setAuthor(f.company_legal_name)
  doc.setSubject(refNo)
  doc.setCreator(f.company_legal_name)
  const fonts: Fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    italic: await doc.embedFont(StandardFonts.HelveticaOblique),
  }
  const brand = hexColor(opts.brandColor)
  const logo = await embedImage(doc, opts.logo)
  const signature = await embedImage(doc, opts.signature)

  let page!: PDFPage
  let y = 0

  function letterhead() {
    page = doc.addPage([W, H])
    let top = H - 46
    if (logo) {
      const h = 40, w = Math.min(160, (logo.width / logo.height) * h)
      page.drawImage(logo, { x: ML, y: top - h, width: w, height: w / (logo.width / logo.height) })
    }
    // Company details, right-aligned
    const right = (text: string, font: PDFFont, size: number, color: RGB) => {
      const t = safe(font, text)
      page.drawText(t, { x: W - MR - textWidth(font, t, size), y: top - size, size, font, color })
      top -= size + 3.5
    }
    right(f.company_legal_name, fonts.bold, 12, INK)
    for (const line of wrapPlain(f.company_address, fonts.regular, 8.5, 250)) right(line, fonts.regular, 8.5, MUTED)
    for (const contact of [f.company_phone, [f.company_email, f.company_website].filter(Boolean).join('  ·  ')]) {
      for (const line of wrapPlain(contact, fonts.regular, 8.5, 300)) right(line, fonts.regular, 8.5, MUTED)
    }
    const ruleY = Math.min(top, H - 46 - 40) - 10
    page.drawRectangle({ x: ML, y: ruleY, width: CONTENT_W, height: 1.5, color: brand })
    y = ruleY - 26
  }

  function ensure(height: number) {
    if (y - height < BOTTOM) letterhead()
  }

  /** One wrapped line: neighbouring words in the same font are drawn as one string. */
  function drawLine(line: Word[], x: number, baseline: number, size: number, color: RGB) {
    let cx = x
    for (let i = 0; i < line.length;) {
      const font = line[i].font
      let t = ''
      for (; i < line.length && line[i].font === font; i++) {
        t += (t || cx > x) && line[i].space ? ' ' + line[i].text : line[i].text
      }
      page.drawText(t, { x: cx, y: baseline, size, font, color })
      cx += textWidth(font, t, size)
    }
  }

  /** Text with **bold** runs, wrapped to the width; moves y down. */
  function paragraph(text: string, o: { x?: number; width?: number; size?: number; lead?: number; color?: RGB; font?: PDFFont; after?: number } = {}) {
    const x = o.x ?? ML, width = o.width ?? CONTENT_W, size = o.size ?? SIZE, lead = o.lead ?? LEAD
    for (const line of wrapRuns(text, fonts, o.font, size, width)) {
      ensure(lead)
      drawLine(line, x, y - size, size, o.color ?? INK)
      y -= lead
    }
    y -= o.after ?? 8
  }

  function draw(block: LetterBlock) {
    switch (block.kind) {
      case 'meta': {
        ensure(LEAD)
        page.drawText(safe(fonts.regular, block.left), { x: ML, y: y - SIZE, size: SIZE, font: fonts.regular, color: INK })
        const r = safe(fonts.regular, block.right)
        page.drawText(r, { x: W - MR - textWidth(fonts.regular, r, SIZE), y: y - SIZE, size: SIZE, font: fonts.regular, color: INK })
        y -= LEAD + 12
        return
      }
      case 'label':
        paragraph(block.text, { font: fonts.bold, size: 8.5, color: MUTED, after: 10 })
        return
      case 'lines':
        for (const l of block.lines) paragraph(l, { lead: 14, after: 0 })
        y -= 14
        return
      case 'subject':
        ensure(LEAD * 2)
        paragraph(`**Subject: ${block.text}**`, { size: 11, after: 12 })
        return
      case 'para':
        if (block.small) paragraph(block.text, { font: fonts.italic, size: 8.5, lead: 12, color: MUTED, after: 6 })
        else paragraph(block.text)
        return
      case 'table': {
        const labelW = 128, pad = 6
        y -= 2
        for (const [i, [label, value]] of block.rows.entries()) {
          const lines = wrapRuns(value, fonts, undefined, SIZE, CONTENT_W - labelW - pad * 2)
          const h = lines.length * 14 + pad * 2 - 3
          ensure(h)
          if (i % 2 === 0) page.drawRectangle({ x: ML, y: y - h, width: CONTENT_W, height: h, color: ZEBRA })
          page.drawText(safe(fonts.bold, label), { x: ML + pad, y: y - pad - SIZE + 1, size: 9.5, font: fonts.bold, color: MUTED })
          let ly = y - pad
          for (const line of lines) {
            drawLine(line, ML + labelW, ly - SIZE + 1, SIZE, INK)
            ly -= 14
          }
          y -= h
        }
        page.drawLine({ start: { x: ML, y }, end: { x: ML + CONTENT_W, y }, thickness: 0.6, color: RULE })
        y -= 14
        return
      }
      case 'list':
        for (const [i, item] of block.items.entries()) {
          ensure(LEAD)
          page.drawText(`(${String.fromCharCode(97 + i)})`, { x: ML + 8, y: y - SIZE, size: SIZE, font: fonts.regular, color: INK })
          paragraph(item, { x: ML + 30, width: CONTENT_W - 30, after: 3 })
        }
        y -= 6
        return
      case 'signature': {
        ensure(130)
        paragraph('Yours sincerely,', { after: 4 })
        paragraph(`**For ${f.company_legal_name}**`, { after: 2 })
        const sigH = 52
        if (signature) {
          const w = Math.min(170, (signature.width / signature.height) * sigH)
          page.drawImage(signature, { x: ML - 4, y: y - sigH, width: w, height: w / (signature.width / signature.height) })
        }
        y -= sigH + 6
        paragraph(`**${f.signatory_name}**`, { after: 0 })
        if (f.signatory_title) paragraph(f.signatory_title, { color: MUTED, after: 0 })
        y -= 18
        return
      }
      case 'pagebreak':
        // The Annexure starts on a new page unless more than half of this one is still free
        if (y < H * 0.5) letterhead()
        else {
          y -= 14
          page.drawLine({ start: { x: ML, y }, end: { x: ML + CONTENT_W, y }, thickness: 0.6, color: RULE })
          y -= 26
        }
        return
      case 'heading':
        ensure(LEAD * 4)
        y -= 4
        paragraph(block.text, { font: fonts.bold, size: 12.5, color: brand, after: 10 })
        return
      case 'clause':
        ensure(LEAD * 3)   // keep the title with its first lines
        paragraph(`**${block.number}. ${block.title}**`, { after: 2 })
        paragraph(block.text, { x: ML + 16, width: CONTENT_W - 16, after: 10 })
        return
      case 'signlines': {
        ensure(60)
        y -= 30
        const gap = 18, colW = (CONTENT_W - gap * (block.labels.length - 1)) / block.labels.length
        block.labels.forEach((label, i) => {
          const x = ML + i * (colW + gap)
          page.drawLine({ start: { x, y }, end: { x: x + colW, y }, thickness: 0.8, color: MUTED })
          page.drawText(label, { x, y: y - 13, size: 9, font: fonts.regular, color: MUTED })
        })
        y -= 24
        return
      }
    }
  }

  letterhead()
  for (const b of letterBlocks(f, refNo)) draw(b)

  // Footer on every page
  const pages = doc.getPages()
  pages.forEach((p, i) => {
    const left = safe(fonts.regular, `${f.company_legal_name}  ·  Ref: ${refNo}  ·  Private and confidential`)
    const right = `Page ${i + 1} of ${pages.length}`
    p.drawLine({ start: { x: ML, y: 44 }, end: { x: W - MR, y: 44 }, thickness: 0.5, color: RULE })
    p.drawText(left, { x: ML, y: 30, size: 7.5, font: fonts.regular, color: MUTED })
    p.drawText(right, { x: W - MR - textWidth(fonts.regular, right, 7.5), y: 30, size: 7.5, font: fonts.regular, color: MUTED })
  })

  return doc.save()
}

/** Lines of words (each with its font) no wider than `width`. Only breaks where the text has a space. */
function wrapRuns(text: string, fonts: Fonts, base: PDFFont | undefined, size: number, width: number): Word[][] {
  const words: Word[] = []
  let pendingSpace = false
  for (const run of boldRuns(text)) {
    const font = run.bold ? fonts.bold : base ?? fonts.regular
    for (const part of run.text.split(/(\s+)/)) {
      if (!part) continue
      if (/^\s+$/.test(part)) { pendingSpace = true; continue }
      words.push({ text: safe(font, part), font, space: pendingSpace })
      pendingSpace = false
    }
  }
  const lines: Word[][] = []
  let line: Word[] = [], lineW = 0
  for (const w of words) {
    const ww = textWidth(w.font, w.text, size)
    const space = line.length && w.space ? textWidth(w.font, ' ', size) : 0
    if (line.length && w.space && lineW + space + ww > width) {
      lines.push(line); line = []; lineW = 0
    }
    lineW += (line.length ? space : 0) + ww
    line.push(w)
  }
  if (line.length) lines.push(line)
  return lines
}

function wrapPlain(text: string, font: PDFFont, size: number, width: number): string[] {
  const one = { regular: font, bold: font, italic: font }
  return wrapRuns(text.replace(/\*\*/g, ''), one, font, size, width)
    .map(l => l.map((w, i) => (i && w.space ? ' ' : '') + w.text).join(''))
}
