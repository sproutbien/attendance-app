import type { CSSProperties } from 'react'

// Shared inline styles for the admin Employees pages (same look as the rest of the admin area)

export const card: CSSProperties = { background: '#fff', borderRadius: 16, padding: '1.5rem', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }
export const tableStyle: CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }
export const sectionHeading: CSSProperties = { margin: '0 0 1.25rem', fontSize: '1rem', fontWeight: 600, color: '#1e293b' }
export const thStyle: CSSProperties = { textAlign: 'left', padding: '0.5rem 0.75rem', fontWeight: 600, color: '#64748b', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }
export const tdStyle: CSSProperties = { padding: '0.875rem 0.75rem', verticalAlign: 'middle' }
export const primaryBtn: CSSProperties = { padding: '0.5rem 1.125rem', background: 'var(--brand-600)', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: '0.875rem', cursor: 'pointer' }
export const ghostBtn: CSSProperties = { padding: '0.375rem 0.75rem', background: '#fff', color: '#374151', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: '0.8125rem', cursor: 'pointer', fontWeight: 500 }
export const dangerBtn: CSSProperties = { ...ghostBtn, color: '#dc2626', borderColor: '#fecaca' }
export const inputStyle: CSSProperties = { width: '100%', padding: '0.625rem 0.75rem', border: '1px solid #d1d5db', borderRadius: 8, fontSize: '0.9375rem', outline: 'none', boxSizing: 'border-box', color: '#1e293b', fontFamily: 'inherit', background: '#fff' }
export const overlayStyle: CSSProperties = { position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(15,23,42,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }
export const modalStyle: CSSProperties = { background: '#fff', borderRadius: 16, padding: '1.75rem', width: '100%', maxWidth: 480, maxHeight: 'calc(100vh - 2rem)', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.15)', boxSizing: 'border-box' }
export const hintStyle: CSSProperties = { margin: '0.25rem 0 0', fontSize: '0.75rem', color: '#94a3b8' }
export const errorBox: CSSProperties = { marginBottom: '1rem', padding: '0.75rem', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, color: '#dc2626', fontSize: '0.875rem' }
export const successBox: CSSProperties = { marginBottom: '1rem', padding: '0.75rem 1rem', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, color: '#166534', fontSize: '0.875rem' }
