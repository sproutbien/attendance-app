// ── Tables that become cards on phones ──
// Give a <table> the class "rt" and, at phone width, each row turns into a card
// with the column name next to every value (CSS in index.css). This copies each
// column's heading onto its cells as data-label, following colSpan, and keeps
// doing so as React re-renders rows.

function labelTable(table: HTMLTableElement) {
  const head = table.tHead?.rows[0]
  if (!head) return
  const labels: string[] = []
  for (const th of Array.from(head.cells)) {
    const text = (th.textContent ?? '').trim()
    for (let i = 0; i < th.colSpan; i++) labels.push(text)
  }
  for (const body of [...Array.from(table.tBodies), table.tFoot].filter(Boolean) as HTMLTableSectionElement[]) {
    for (const row of Array.from(body.rows)) {
      let col = 0
      for (const cell of Array.from(row.cells)) {
        const label = labels[col] ?? ''
        if (cell.getAttribute('data-label') !== label) cell.setAttribute('data-label', label)
        col += cell.colSpan
      }
    }
  }
}

export function installResponsiveTables() {
  let queued = false
  const run = () => {
    queued = false
    document.querySelectorAll<HTMLTableElement>('table.rt').forEach(labelTable)
  }
  const schedule = () => {
    if (queued) return
    queued = true
    requestAnimationFrame(run)
  }
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true, characterData: true })
  schedule()
}
