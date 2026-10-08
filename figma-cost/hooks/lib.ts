import type { Bucket, Screen, Stats } from '../types'

// USD per million tokens: input, output, cache read, cache write. Only used to split the real session cost between
// Figma work and the rest (see `calibrate`); the session total itself comes from the session's own ledger.
const PRICES: Array<[RegExp, [number, number, number, number]]> = [
  [/opus-4(-1)?(-\d{8})?$/i, [15, 75, 1.5, 18.75]],
  [/opus/i, [5, 25, 0.5, 6.25]],
  [/sonnet/i, [3, 15, 0.3, 3.75]],
  [/haiku/i, [1, 5, 0.1, 1.25]],
]
const FALLBACK: [number, number, number, number] = [5, 25, 0.5, 6.25]

export type Usage = {
  model: string
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
}

/** A usable number: finite and not negative, else 0. */
export const num = (x: unknown): number => (typeof x === 'number' && Number.isFinite(x) && x > 0 ? x : 0)

export const empty = (): Bucket => ({ steps: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 })

export const fresh = (): Stats => ({
  startedAt: Date.now(),
  all: empty(),
  figma: empty(),
  byAgent: {},
  names: {},
  figmaTools: {},
  figmaErrors: 0,
  screens: {},
  editSeq: 0,
  writesSinceShot: 0,
  bridgeDown: false,
  costBase: null,
  estAtBase: 0,
})

export const costOf = (u: Usage): number => {
  const p = PRICES.find(([re]) => re.test(String(u.model ?? '')))?.[1] ?? FALLBACK
  return (num(u.input_tokens) * p[0] + num(u.output_tokens) * p[1] + num(u.cache_read_input_tokens) * p[2] + num(u.cache_creation_input_tokens) * p[3]) / 1e6
}

export const add = (b: Bucket, u: Usage): Bucket => ({
  steps: num(b.steps) + 1,
  input: num(b.input) + num(u.input_tokens),
  output: num(b.output) + num(u.output_tokens),
  cacheRead: num(b.cacheRead) + num(u.cache_read_input_tokens),
  cacheWrite: num(b.cacheWrite) + num(u.cache_creation_input_tokens),
  cost: num(b.cost) + costOf(u),
})

export const isFigma = (tool: string): boolean => /figma/i.test(tool)
export const isShot = (tool: string): boolean => /screenshot/i.test(tool)
export const isRead = (tool: string): boolean => /(_get_|_list_|_search_|_lint_|_audit_|status|diagnose|_ds_|_navigate|_reconnect|_reload|_focus|_capture|_clear_console|_watch_)/i.test(tool)
export const isBridgeError = (text: string): boolean => /not connected|no active file|no files connected|desktop bridge|no plugin|unable to retrieve|no figma file open/i.test(text)

export const tokens = (b: Bucket): number => num(b.input) + num(b.output) + num(b.cacheRead) + num(b.cacheWrite)

export const money = (n: number): string => `$${num(n).toFixed(2)}`
export const mega = (x: number): string => {
  const n = num(x)
  return n >= 999_500 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : `${Math.round(n)}`
}

/**
 * Screens are the frames Figma says exist (looked up by name when a screenshot is taken). Iterations per screen is
 * build-and-check rounds over screens: 1.0 means every screen was right after its first check.
 */
export const iterations = (s: Stats): { screens: number; looks: number; cycles: number; perScreen: number } => {
  const rows = Object.values(s.screens ?? {})
  const cycles = rows.reduce((a, r) => a + Math.max(1, num(r.cycles)), 0)
  const looks = rows.reduce((a, r) => a + num(r.looks), 0)
  return { screens: rows.length, looks, cycles, perScreen: rows.length ? cycles / rows.length : 0 }
}

/**
 * Record that a screenshot showed these screens. When the shot was of a whole section (`section` given), screens that
 * used to live in it and are no longer there (renamed, deleted, rebuilt under another name) are dropped, so the count
 * follows Figma and not the history.
 */
export const seeScreens = (s: Stats, found: Array<{ id: string; name: string; parent?: string }>, section?: string): Stats => {
  let screens = { ...s.screens }
  if (section) {
    const names = new Set(found.map(f => f.name))
    screens = Object.fromEntries(Object.entries(screens).filter(([name, r]) => r.parent !== section || names.has(name)))
  }
  for (const f of found) {
    const prev = screens[f.name]
    const edited = !prev || s.editSeq > prev.checkedAt
    screens[f.name] = {
      cycles: (prev?.cycles ?? 0) + (edited ? 1 : 0),
      looks: (prev?.looks ?? 0) + 1,
      ids: prev && prev.ids.includes(f.id) ? prev.ids : [...(prev?.ids ?? []), f.id].slice(-10),
      checkedAt: s.editSeq,
      parent: f.parent ?? prev?.parent ?? '',
    }
  }
  return { ...s, screens: trim(screens, 200), writesSinceShot: 0 }
}

/** Does this Figma script change the file? Reads (get, find, list) do not count as edits. */
export const isEditCode = (code: string): boolean =>
  /(figma\.create|\.remove\(|\.appendChild\(|\.insertChild\(|\.clone\(|\.resize(WithoutConstraints)?\(|\.(characters|fills|strokes|effects|name|x|y|opacity|cornerRadius|layoutMode|itemSpacing|visible|layoutGrow|layoutSizingHorizontal|layoutSizingVertical|primaryAxisAlignItems|counterAxisAlignItems|paddingLeft|paddingRight|paddingTop|paddingBottom|fontName|fontSize|letterSpacing|arcData)\s*=[^=]|\.set[A-Z]\w*\(|\.combineAsVariants)/.test(code)

/** Words Figma tools use when the bridge is not there, in either an error or a "successful" status reply. */
export const bridgeWords = /unable to retrieve|no plugin connected|plugin is not connected|no active file|no files connected|desktop bridge may need|no figma file open|not connected/i

/** The read-only script the mod sends to learn which screens a screenshotted node shows. */
export const screenLookupCode = (id: string): string =>
  `const n = await figma.getNodeByIdAsync(${JSON.stringify(id)}); if (!n) return []; const info = t => ({ id: t.id, name: t.name, parent: t.parent ? t.parent.id : '' }); ` +
  `if (n.type === 'SECTION') return n.children.filter(c => c.type === 'FRAME').map(info); ` +
  `if (n.type === 'FRAME' && n.parent && (n.parent.type === 'SECTION' || n.parent.type === 'PAGE')) return [info(n)]; return [];`

/** Pull the list of screens out of an MCP result. */
export const parseScreens = (res: unknown): Array<{ id: string; name: string; parent?: string }> | null => {
  try {
    const blocks = ((res as { content?: Array<{ type?: string; text?: string }> })?.content ?? []).filter(b => b.type === 'text')
    for (const b of blocks) {
      const j = JSON.parse(b.text ?? '')
      const list = j?.result
      if (Array.isArray(list)) return list.filter((x: any) => x && typeof x.name === 'string' && typeof x.id === 'string').slice(0, 100).map((x: any) => ({ id: x.id, name: x.name, parent: typeof x.parent === 'string' ? x.parent : '' }))
    }
  } catch { /* fall through */ }
  return null
}

/** Colour of the iterations number: green up to 1.5, amber up to 2.5, red above. */
export const rateColor = (perScreen: number): 'success' | 'warning' | 'error' =>
  perScreen <= 1.5 ? 'success' : perScreen <= 2.5 ? 'warning' : 'error'

export const percent = (part: number, whole: number): number => (num(whole) > 0 ? Math.min(100, Math.round((num(part) / num(whole)) * 100)) : 0)

export const bar = (v: number, m: number, width: number): { filled: number; rest: number } => {
  const value = num(v)
  const max = num(m)
  const filled = max > 0 ? Math.min(width, Math.max(value > 0 ? 1 : 0, Math.round((value / max) * width))) : 0
  return { filled, rest: width - filled }
}

/** What an agent is doing in a few words: its task description, else its id. */
export const agentLabel = (s: Stats, id: string): string => {
  if (id === 'main') return 'main'
  const said = clean(((s.names ?? {})[id] ?? '')).trim().toLowerCase()
  if (!said) return `subagent ${[...id].slice(0, 6).join('')}`
  return clip(said, 26)
}

/** Strip characters XML cannot carry. */
export const clean = (t: string): string => String(t ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, ' ').replace(/[\r\n\t]+/g, ' ')

/**
 * Cut text to a width budget (ASCII counts 1, anything else 2), on a whole code point, and on a word boundary when
 * there is one: "review figma-cost mod…", never "review figma-cost mod c…".
 */
export const clip = (text: string, budget: number): string => {
  const chars = [...text]
  const out: string[] = []
  let used = 0
  for (const ch of chars) {
    const w = ch.charCodeAt(0) < 0x250 ? 1 : 2
    if (used + w > budget) break
    out.push(ch)
    used += w
  }
  if (out.length === chars.length) return text
  // room for the ellipsis
  while (out.length > 0 && used + 1 > budget) { const last = out.pop() as string; used -= last.charCodeAt(0) < 0x250 ? 1 : 2 }
  const next = chars[out.length]
  const atBoundary = next === undefined || /\s/.test(next)
  let cut = out
  if (!atBoundary) {
    const at = out.map(c => /\s/.test(c)).lastIndexOf(true)
    if (at > 0) cut = out.slice(0, at)
  }
  return `${cut.join('').replace(/[\s,;:.\-–—]+$/, '')}…`
}

/** Agents ranked by tokens, the tail folded into "others", with whole-number shares that add to 100. */
export const agentShares = (s: Stats, keep = 4): Array<{ name: string; tokens: number; share: number }> => {
  const rows = Object.entries(s.byAgent ?? {})
    .map(([id, b]) => ({ name: agentLabel(s, id), tokens: tokens(b ?? empty()) }))
    .sort((a, b) => b.tokens - a.tokens)
  const head = rows.slice(0, keep)
  const tail = rows.slice(keep).reduce((a, r) => a + r.tokens, 0)
  if (tail > 0) head.push({ name: 'others', tokens: tail })
  const total = head.reduce((a, r) => a + r.tokens, 0)
  const shares = head.map(r => ({ ...r, share: percent(r.tokens, total) }))
  const drift = 100 - shares.reduce((a, r) => a + r.share, 0)
  if (total > 0 && drift !== 0) {
    const biggest = shares.reduce((m, r, i) => (r.share > (shares[m]?.share ?? -1) ? i : m), 0)
    if (shares[biggest]) shares[biggest].share += drift
  }
  return shares
}

/** Widths for a segmented bar: every agent with tokens gets at least one cell, the total is exactly `width`. */
export const segments = (shares: Array<{ tokens: number }>, width: number): number[] => {
  const total = shares.reduce((a, r) => a + r.tokens, 0)
  if (total <= 0) return shares.map(() => 0)
  const raw = shares.map(r => Math.max(r.tokens > 0 ? 1 : 0, Math.round((r.tokens / total) * width)))
  let diff = width - raw.reduce((a, b) => a + b, 0)
  let i = 0
  while (diff !== 0 && i < 1000) {
    const k = i++ % raw.length
    if (diff > 0) { raw[k] += 1; diff -= 1 } else if (raw[k] > 1) { raw[k] -= 1; diff += 1 }
  }
  return raw
}

export type StepName = 'Spent' | 'Bought' | 'Took' | 'Held back by' | 'Spent by'

/** Which steps of the story the pane tells, in order. */
export const stepsOf = (s: Stats): StepName[] => {
  const calls = Object.values(s.figmaTools ?? {}).reduce((a, b) => a + num(b), 0)
  const hasFigma = calls > 0 || num(s.figma?.steps) > 0
  const out: StepName[] = ['Spent']
  if (!hasFigma || s.bridgeDown) return out
  const { screens } = iterations(s)
  if (screens > 0) out.push('Bought', 'Took')
  if (num(s.figmaErrors) > 0 || num(s.writesSinceShot) > 0) out.push('Held back by')
  if (Object.keys(s.byAgent ?? {}).length > 0) out.push('Spent by')
  return out
}

// ---------------------------------------------------------------- desktop card (SVG)

const esc = (t: string): string => clean(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const f1 = (n: number): string => n.toFixed(1)

const CSS = `
:root{--t:#14171F;--s:#6B7280;--a:#4B55C6;--trk:#E9EBF0;--rail:#D9DCE3;--g:#1F7A4D;--w:#A8590B;--r:#B3261E;--c0:#4B55C6;--c1:#8A92E0;--c2:#C9CDF2;--c3:#9CA3AF;--c4:#D1D5DB}
@media (prefers-color-scheme: dark){:root{--t:#ECEEF3;--s:#9AA1AE;--a:#8A92E0;--trk:#2A2E38;--rail:#3A3F4B;--g:#4ADE80;--w:#F5B045;--r:#F87171;--c0:#8A92E0;--c1:#6B74D6;--c2:#444B99;--c3:#6B7280;--c4:#4B5563}}
text{font-family:Geist,Inter,-apple-system,system-ui,sans-serif}
.t{fill:var(--t)}.s{fill:var(--s)}.a{fill:var(--a)}.trk{fill:var(--trk)}.rail{stroke:var(--rail)}
.g{fill:var(--g)}.w{fill:var(--w)}.r{fill:var(--r)}
.b{font-weight:600}.m{font-weight:500}
`

/** The whole card as one SVG, drawn like the Figma design. Returns the markup and a plain-words summary. */
export const cardSvg = (saved: Stats): { source: string; alt: string; height: number } => {
  const s = normalize(saved)
  const W = 320
  const X = 26
  const steps = stepsOf(s)
  const it = iterations(s)
  const dim = s.bridgeDown
  const pct = percent(s.figma.cost, s.all.cost)
  const parts: string[] = []
  const dots: number[] = []
  const alt: string[] = [`Figma cost this session: ${money(s.figma.cost)} of ${money(s.all.cost)}`]

  // The pane already carries the title; only a problem earns a line of its own.
  if (dim) parts.push(`<circle cx="3" cy="9" r="3" style="fill:var(--r)"/><text x="12" y="13" class="r m" font-size="12">Not connected</text>`)

  let y = dim ? 46 : 6
  let bottom = y
  const lead = (name: string) => {
    dots.push(y + 6)
    parts.push(`<text x="${X}" y="${y + 10}" class="s m" font-size="12">${esc(name)}</text>`)
  }

  // Spent
  const body: string[] = []
  lead('Spent')
  const barW = W - X
  const fill = Math.min(barW, Math.max(s.figma.cost > 0 ? 4 : 0, Math.round((pct / 100) * barW)))
  const costText = `${money(s.figma.cost)} / ${money(s.all.cost)}`
  const [big, small] = costText.length > 17 ? [26, 13] : costText.length > 14 ? [32, 16] : [38, 19]
  body.push(
    `<text x="${X}" y="${y + 48}" class="t b" font-size="${big}" letter-spacing="-1.5">${esc(money(s.figma.cost))}<tspan class="s" font-weight="400" font-size="${small}" letter-spacing="-0.5" dx="8">/ ${esc(money(s.all.cost))}</tspan></text>`,
    `<rect x="${X}" y="${y + 62}" width="${barW}" height="6" rx="3" class="trk"/>`,
    fill > 0 ? `<rect x="${X}" y="${y + 62}" width="${fill}" height="6" rx="3" class="a"/>` : '',
    `<text x="${X}" y="${y + 90}" class="s" font-size="12">${pct}% of the session${dim ? ', last known' : ''}</text>`,
  )
  bottom = y + 94
  y += 92 + 28

  if (steps.includes('Bought')) {
    lead('Bought')
    body.push(
      `<text x="${X}" y="${y + 38}" class="t b" font-size="20" letter-spacing="-0.4">${it.screens} ${it.screens === 1 ? 'screen' : 'screens'}</text>`,
      `<text x="${X}" y="${y + 58}" class="s" font-size="13">${esc(money(s.figma.cost / it.screens))} per screen</text>`,
    )
    alt.push(`${it.screens} screens`)
    bottom = y + 62
    y += 60 + 28
  }

  if (steps.includes('Took')) {
    lead('Took')
    const cls = { success: 'g', warning: 'w', error: 'r' }[rateColor(it.perScreen)]
    body.push(`<text x="${X}" y="${y + 38}" class="t b" font-size="20" letter-spacing="-0.4"><tspan class="${cls}">${f1(it.perScreen)}</tspan> iterations per screen</text>`)
    alt.push(`${f1(it.perScreen)} iterations per screen`)
    bottom = y + 46
    y += 42 + 28
  }

  if (steps.includes('Held back by')) {
    lead('Held back by')
    const failed = `${s.figmaErrors} failed ${s.figmaErrors === 1 ? 'call' : 'calls'}`
    const unchecked = `${s.writesSinceShot} ${s.writesSinceShot === 1 ? 'edit' : 'edits'} never checked`
    if (s.figmaErrors > 0) {
      body.push(`<text x="${X}" y="${y + 38}" class="t b" font-size="20" letter-spacing="-0.4">${failed}</text>`)
      if (s.writesSinceShot > 0) body.push(`<text x="${X}" y="${y + 58}" class="s" font-size="13">${unchecked}</text>`)
      bottom = y + (s.writesSinceShot > 0 ? 62 : 46)
      y += (s.writesSinceShot > 0 ? 60 : 42) + 28
    } else {
      body.push(`<text x="${X}" y="${y + 38}" class="t b" font-size="20" letter-spacing="-0.4">${unchecked}</text>`)
      bottom = y + 46
      y += 42 + 28
    }
    alt.push(s.figmaErrors > 0 ? failed : unchecked)
  }

  if (steps.includes('Spent by')) {
    lead('Spent by')
    const agents = agentShares(s)
    const widths = segments(agents, Math.max(agents.length, barW - 3 * (agents.length - 1)))
    body.push(`<text x="${X}" y="${y + 38}" class="t b" font-size="20" letter-spacing="-0.4">${esc(mega(tokens(s.all)))} tokens</text>`)
    let x = X
    agents.forEach((a, i) => {
      const w = widths[i] ?? 0
      const r = Math.min(6, w / 2)
      const left = Math.min(i === 0 ? r : 2, w / 2)
      const right = Math.min(i === agents.length - 1 ? r : 2, w / 2)
      const top = y + 54
      const h = 12
      // rounded-rect with independent left/right radii
      body.push(
        `<path d="M${x + left},${top} H${x + w - right} Q${x + w},${top} ${x + w},${top + right} V${top + h - right} Q${x + w},${top + h} ${x + w - right},${top + h} H${x + left} Q${x},${top + h} ${x},${top + h - left} V${top + left} Q${x},${top} ${x + left},${top} Z" style="fill:var(--c${Math.min(i, 4)})"/>`,
      )
      x += w + 3
    })
    agents.forEach((a, i) => {
      const ry = y + 92 + i * 22
      body.push(
        `<rect x="${X}" y="${ry - 8}" width="8" height="8" rx="2" style="fill:var(--c${Math.min(i, 4)})"/>`,
        `<text x="${X + 18}" y="${ry}" class="t" font-size="13">${esc(a.name)}</text>`,
        `<text x="${W - 46}" y="${ry}" text-anchor="end" class="s" font-size="13">${esc(mega(a.tokens))}</text>`,
        `<text x="${W}" y="${ry}" text-anchor="end" class="t m" font-size="13">${a.share}%</text>`,
      )
    })
    bottom = y + 92 + (agents.length - 1) * 22 + 6
    y += 92 + agents.length * 22
  }

  const height = Math.ceil(bottom + 4)
  const railLine =
    dots.length > 1 ? `<line x1="6" y1="${dots[0]}" x2="6" y2="${dots[dots.length - 1]}" class="rail" stroke-width="2" stroke-linecap="round"/>` : ''
  const dotMarks = dots.map(cy => `<circle cx="6" cy="${cy}" r="5" class="a"/>`).join('')
  const source =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${height}" width="${W}" height="${height}"><style>${CSS}</style>` +
    `<g${dim ? ' opacity="0.45"' : ''}>${railLine}${dotMarks}${body.join('')}</g>${parts.join('')}</svg>`
  return { source, alt: alt.join(', '), height }
}

/** Numbers saved by an older version of this mod lack newer fields: fill them in. */
export const normalize = (saved: Partial<Stats> | null | undefined): Stats => {
  const base = fresh()
  const o = (saved ?? {}) as Partial<Stats>
  const bucket = (b: unknown): Bucket => ({ ...empty(), ...((b && typeof b === 'object' ? b : {}) as Partial<Bucket>) })
  const dict = <T,>(d: unknown, each: (v: unknown) => T): Record<string, T> =>
    Object.fromEntries(Object.entries(d && typeof d === 'object' ? (d as object) : {}).map(([k, v]) => [k, each(v)]))
  return {
    startedAt: num(o.startedAt) || base.startedAt,
    all: bucket(o.all),
    figma: bucket(o.figma),
    byAgent: dict(o.byAgent, bucket),
    names: dict(o.names, v => String(v ?? '')),
    figmaTools: dict(o.figmaTools, num),
    figmaErrors: num(o.figmaErrors),
    screens: dict(o.screens, (v): Screen => {
      const r = (v && typeof v === 'object' ? v : {}) as Partial<Screen>
      return { cycles: num(r.cycles), looks: num(r.looks), ids: Array.isArray(r.ids) ? r.ids.map(String).slice(-10) : [], checkedAt: typeof r.checkedAt === 'number' ? r.checkedAt : -1, parent: typeof r.parent === 'string' ? r.parent : '' }
    }),
    editSeq: num(o.editSeq),
    writesSinceShot: num(o.writesSinceShot),
    bridgeDown: o.bridgeDown === true,
    // A base without the estimate it was taken against cannot be used: drop it, a new one is taken at the next step.
    costBase: typeof o.costBase === 'number' && Number.isFinite(o.costBase) && typeof o.estAtBase === 'number' ? o.costBase : null,
    estAtBase: typeof o.estAtBase === 'number' && Number.isFinite(o.estAtBase) ? o.estAtBase : 0,
  }
}

/** Keep the maps that grow with the session within a fixed size: oldest entries go first. */
export const trim = <T,>(d: Record<string, T>, max: number): Record<string, T> => {
  const keys = Object.keys(d)
  if (keys.length <= max) return d
  return Object.fromEntries(keys.slice(keys.length - max).map(k => [k, d[k] as T]))
}

/**
 * Put real dollars on the numbers. The session's own ledger (`usd`) is exact; our token-based estimate is only used to
 * say what share of it was Figma work. Without a ledger reading the estimates stand as they are.
 */
export const calibrate = (s: Stats, usd: number | null | undefined): Stats => {
  if (typeof usd !== 'number' || !Number.isFinite(usd) || usd <= 0) return s
  // Our estimate and the ledger are compared over the same stretch: from the moment the ledger was first read.
  const sinceEst = s.all.cost - s.estAtBase
  const sinceUsd = s.costBase === null ? 0 : usd - s.costBase
  // Short stretches are noisy (the ledger and our counters move at slightly different moments), so wait for $1 of estimate.
  const k = sinceEst >= 1 && sinceUsd > 0 ? Math.min(2, Math.max(0.4, sinceUsd / sinceEst)) : 1
  return { ...s, all: { ...s.all, cost: usd }, figma: { ...s.figma, cost: s.figma.cost * k } }
}
