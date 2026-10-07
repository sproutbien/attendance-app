import type { CSSProperties } from 'react'
import { boldRuns, letterBlocks } from '../../lib/offerLetter'
import type { LetterBlock, OfferFields } from '../../lib/offerLetter'

/**
 * The letter as it will look, from the same blocks the PDF is drawn from.
 * Page breaks aren't shown; the PDF adds the letterhead to every page.
 */
export default function LetterPreview({ fields, refNo, logo, signature, brandColor }: {
  fields: OfferFields
  refNo: string
  logo: string
  signature: string | null   // object URL, or null when none is set
  brandColor: string
}) {
  const f = fields
  return (
    <div style={paper} aria-label="Letter preview">
      <header style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start', paddingBottom: 12, borderBottom: `2px solid ${brandColor}`, marginBottom: 22 }}>
        <img src={logo} alt="" style={{ height: 44, maxWidth: 170, objectFit: 'contain' }} />
        <div style={{ textAlign: 'right', fontSize: 11, color: '#64748b', lineHeight: 1.45 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#1e293b' }}>{f.company_legal_name}</div>
          <div style={{ maxWidth: 300, marginLeft: 'auto' }}>{f.company_address}</div>
          {f.company_phone && <div>{f.company_phone}</div>}
          <div>{[f.company_email, f.company_website].filter(Boolean).join('  ·  ')}</div>
        </div>
      </header>
      {letterBlocks(f, refNo).map((b, i) => <Block key={i} block={b} f={f} signature={signature} brandColor={brandColor} />)}
    </div>
  )
}

function Rich({ text }: { text: string }) {
  return <>{boldRuns(text).map((r, i) => r.bold ? <b key={i}>{r.text}</b> : <span key={i}>{r.text}</span>)}</>
}

function Block({ block, f, signature, brandColor }: { block: LetterBlock; f: OfferFields; signature: string | null; brandColor: string }) {
  switch (block.kind) {
    case 'meta':
      return <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}><span>{block.left}</span><span>{block.right}</span></div>
    case 'label':
      return <p style={{ margin: '0 0 12px', fontSize: 11, fontWeight: 700, color: '#64748b', letterSpacing: '0.04em' }}>{block.text}</p>
    case 'lines':
      return <div style={{ marginBottom: 16, lineHeight: 1.45 }}>{block.lines.map((l, i) => <div key={i}><Rich text={l} /></div>)}</div>
    case 'subject':
      return <p style={{ margin: '0 0 14px', fontWeight: 700 }}>Subject: {block.text}</p>
    case 'para':
      return block.small
        ? <p style={{ margin: '0 0 8px', fontSize: 11, fontStyle: 'italic', color: '#64748b' }}><Rich text={block.text} /></p>
        : <p style={{ margin: '0 0 10px' }}><Rich text={block.text} /></p>
    case 'table':
      return (
        <table style={{ width: '100%', borderCollapse: 'collapse', margin: '4px 0 16px', borderBottom: '1px solid #e2e8f0' }}>
          <tbody>
            {block.rows.map(([k, v], i) => (
              <tr key={k} style={{ background: i % 2 === 0 ? '#f6f8fa' : undefined }}>
                <th scope="row" style={{ textAlign: 'left', fontWeight: 700, fontSize: 12, color: '#64748b', padding: '6px 8px', width: '30%', verticalAlign: 'top' }}>{k}</th>
                <td style={{ padding: '6px 8px' }}>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )
    case 'list':
      return (
        <ol type="a" style={{ margin: '0 0 12px', paddingLeft: 30 }}>
          {block.items.map((t, i) => <li key={i} style={{ marginBottom: 3 }}><Rich text={t} /></li>)}
        </ol>
      )
    case 'signature':
      return (
        <div style={{ margin: '4px 0 20px' }}>
          <div>Yours sincerely,</div>
          <div style={{ fontWeight: 700, marginTop: 4 }}>For {f.company_legal_name}</div>
          <div style={{ height: 60, display: 'flex', alignItems: 'center' }}>
            {signature
              ? <img src={signature} alt="Signature" style={{ maxHeight: 56, maxWidth: 190 }} />
              : <span style={{ fontSize: 12, color: '#b45309', fontStyle: 'italic' }}>No signature added yet (Letter settings)</span>}
          </div>
          <div style={{ fontWeight: 700 }}>{f.signatory_name}</div>
          {f.signatory_title && <div style={{ color: '#64748b' }}>{f.signatory_title}</div>}
        </div>
      )
    case 'pagebreak':
      return <hr style={{ border: 'none', borderTop: '1px dashed #cbd5e1', margin: '24px 0' }} />
    case 'heading':
      return <h3 style={{ margin: '18px 0 10px', fontSize: 16, color: brandColor }}>{block.text}</h3>
    case 'clause':
      return (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontWeight: 700 }}>{block.number}. {block.title}</div>
          <div style={{ paddingLeft: 18, whiteSpace: 'pre-line' }}><Rich text={block.text} /></div>
        </div>
      )
    case 'signlines':
      return (
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${block.labels.length}, 1fr)`, gap: 18, marginTop: 36 }}>
          {block.labels.map(l => <div key={l} style={{ borderTop: '1px solid #64748b', paddingTop: 4, fontSize: 12, color: '#64748b' }}>{l}</div>)}
        </div>
      )
  }
}

const paper: CSSProperties = {
  background: '#fff', color: '#1f2937', fontFamily: 'Helvetica, Arial, sans-serif', fontSize: 13.5, lineHeight: 1.55,
  padding: 'clamp(16px, 5vw, 44px)', border: '1px solid #e2e8f0', borderRadius: 8, boxShadow: '0 4px 18px rgba(15,23,42,0.08)',
  maxWidth: 760, margin: '0 auto', boxSizing: 'border-box', overflowWrap: 'anywhere',
}
