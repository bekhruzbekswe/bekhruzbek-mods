import { test, expect } from 'claude-code/testing'

import { add, agentShares, costOf, empty, fresh, iterations, rateColor, segments, stepsOf, cardSvg, normalize, bar, bridgeWords, clip, calibrate, isEditCode, parseScreens, screenLookupCode, seeScreens, mega, money, trim } from './lib'

const u = { model: 'claude-opus-5-5', input_tokens: 1e6, output_tokens: 1e6, cache_read_input_tokens: 1e6, cache_creation_input_tokens: 0 }

test('cost uses per-million prices', () => {
  expect(costOf(u)).toBe(30.5)
  expect(add(empty(), u).steps).toBe(1)
})

test('screens are Figma frames by name; a rebuild is another round of the same screen', () => {
  let s = fresh()
  s = seeScreens(s, [{ id: '1:1', name: 'Card A' }, { id: '1:2', name: 'Card B' }])   // first build: one round each
  s = seeScreens(s, [{ id: '1:1', name: 'Card A' }])                                  // looked again, nothing edited: no new round
  expect(iterations(s)).toEqual({ screens: 2, looks: 3, cycles: 2, perScreen: 1 })
  s = { ...s, editSeq: s.editSeq + 1 }                                                // an edit, then a rebuild with a new id
  s = seeScreens(s, [{ id: '9:9', name: 'Card A' }])
  expect(iterations(s).perScreen).toBe(1.5)
  expect(s.screens['Card A']?.ids).toEqual(['1:1', '9:9'])
})

test('a screen that left the section is dropped when the section is looked at again', () => {
  let s = fresh()
  s = seeScreens(s, [{ id: '1', name: 'Old name', parent: 'S1' }, { id: '2', name: 'Keeps', parent: 'S1' }], 'S1')
  s = { ...s, editSeq: 1 }
  s = seeScreens(s, [{ id: '2', name: 'Keeps', parent: 'S1' }, { id: '3', name: 'New name', parent: 'S1' }], 'S1')
  expect(Object.keys(s.screens).sort()).toEqual(['Keeps', 'New name'])
  expect(s.screens['Keeps']?.cycles).toBe(2)
})

test('rounding drift goes on the biggest row, older Opus is priced higher', () => {
  const s = { ...fresh(), byAgent: { a: { ...empty(), input: 1 }, b: { ...empty(), input: 1 }, c: { ...empty(), input: 1 } } }
  const sh = agentShares(s)
  expect(sh.reduce((a, r) => a + r.share, 0)).toBe(100)
  expect(costOf({ ...u, model: 'claude-opus-4-1' })).toBeGreaterThan(costOf(u))
})

test('edit detection reads the script, not the tool name', () => {
  expect(isEditCode('const n = await figma.getNodeByIdAsync("1:2"); return n.name')).toBe(false)
  expect(isEditCode('figma.currentPage.findAll(n => n.type === "TEXT").map(t => t.characters)')).toBe(false)
  expect(isEditCode('const f = figma.createFrame(); f.name = "x"')).toBe(true)
  expect(isEditCode('node.remove()')).toBe(true)
  expect(isEditCode('t.characters = "hi"')).toBe(true)
})

test('lookup script is safe to build and its answer parses', () => {
  expect(screenLookupCode('12:34')).toContain('"12:34"')
  const good = { content: [{ type: 'text', text: JSON.stringify({ success: true, result: [{ id: '1:2', name: 'Home' }, { nope: 1 }] }) }] }
  expect(parseScreens(good)).toEqual([{ id: '1:2', name: 'Home', parent: '' }])
  expect(parseScreens({ content: [{ type: 'text', text: 'not json' }] })).toBeNull()
  expect(parseScreens(undefined)).toBeNull()
})

test('a status reply that says unable to retrieve means the bridge is down', () => {
  expect(bridgeWords.test('currentFileName":"(unable to retrieve - Desktop Bridge may need to be opened)"')).toBe(true)
  expect(bridgeWords.test('Connected via WebSocket Bridge to "My File"')).toBe(false)
})

test('iteration colour thresholds', () => {
  expect(rateColor(1.0)).toBe('success')
  expect(rateColor(1.5)).toBe('success')
  expect(rateColor(1.6)).toBe('warning')
  expect(rateColor(2.5)).toBe('warning')
  expect(rateColor(2.6)).toBe('error')
})

test('agent shares add to 100 and fold the tail', () => {
  const s = { ...fresh(), byAgent: {
    main: { ...empty(), input: 620 }, a: { ...empty(), input: 240 }, b: { ...empty(), input: 70 },
    c: { ...empty(), input: 40 }, d: { ...empty(), input: 20 }, e: { ...empty(), input: 10 } } }
  const r = agentShares(s)
  expect(r.length).toBe(5)
  expect(r[4]?.name).toBe('others')
  expect(r.reduce((a, x) => a + x.share, 0)).toBe(100)
})

test('segments fill the bar exactly', () => {
  const w = segments([{ tokens: 62 }, { tokens: 24 }, { tokens: 14 }], 28)
  expect(w.reduce((a, b) => a + b, 0)).toBe(28)
  expect(Math.min(...w)).toBeGreaterThan(0)
})

test('story steps: empty and disconnected show only Spent, a full run shows five', () => {
  expect(stepsOf(fresh())).toEqual(['Spent'])
  const run = { ...fresh(), figma: { ...empty(), steps: 2, cost: 4 }, figmaTools: { figma_execute: 3 }, screens: { A: { cycles: 2, looks: 2, ids: ['1'], checkedAt: 0 } }, figmaErrors: 1, byAgent: { main: { ...empty(), input: 5 } } }
  expect(stepsOf(run)).toEqual(['Spent', 'Bought', 'Took', 'Held back by', 'Spent by'])
  expect(stepsOf({ ...run, bridgeDown: true })).toEqual(['Spent'])
  expect(stepsOf({ ...run, figmaErrors: 0, writesSinceShot: 0 })).toEqual(['Spent', 'Bought', 'Took', 'Spent by'])
})

test('card svg draws every step of a full run and stays well-formed', () => {
  const run = { ...fresh(), all: { ...empty(), cost: 20.8, input: 1000 }, figma: { ...empty(), steps: 2, cost: 4.21 }, figmaTools: { figma_execute: 3 }, screens: { A: { cycles: 2, looks: 2, ids: ['1'], checkedAt: 0 }, B: { cycles: 1, looks: 1, ids: ['2'], checkedAt: 0 } }, figmaErrors: 3, writesSinceShot: 5, byAgent: { main: { ...empty(), input: 620 }, a3f9c1d2e: { ...empty(), input: 380 } } }
  const { source, alt } = cardSvg(run)
  expect(source.startsWith('<svg')).toBe(true)
  expect(source.endsWith('</svg>')).toBe(true)
  for (const w of ['Spent', 'Bought', 'Took', 'Held back by', 'Spent by', '1.5', 'iterations per screen']) expect(source.includes(w)).toBe(true)
  expect(alt.includes('2 screens')).toBe(true)
  expect(cardSvg(fresh()).source.includes('Bought')).toBe(false)
  expect(cardSvg({ ...run, bridgeDown: true }).source.includes('Not connected')).toBe(true)
})

test('agents are named by their task, long ones are cut', () => {
  const s = { ...fresh(), names: { a1: 'Check Figma connection', a2: 'A very long task description that goes on and on' },
    byAgent: { main: { ...empty(), input: 10 }, a1: { ...empty(), input: 5 }, a2: { ...empty(), input: 4 }, zz9999999: { ...empty(), input: 3 } } }
  const names = agentShares(s).map(r => r.name)
  expect(names).toContain('check figma connection')
  expect(names.find(n => n.endsWith('…'))).toBe('a very long task…')
  expect(names).toContain('subagent zz9999')
})

test('numbers saved by an older version still draw', () => {
  const { names: _gone, bridgeDown: _also, ...old } = fresh()
  const s = normalize(old as never)
  expect(s.names).toEqual({})
  expect(cardSvg(s).source.startsWith('<svg')).toBe(true)
  expect(agentShares({ ...old, byAgent: { x1234567890: { ...empty(), input: 3 } } } as never)[0]?.name).toBe('subagent x12345')
})

const bad = (svg: string) => /NaN|Infinity|undefined|\$-/.test(svg)

test('hostile numbers never reach the drawing', () => {
  const s = { ...fresh(), all: { ...empty(), cost: NaN }, figma: { ...empty(), steps: 1, cost: Infinity }, figmaTools: { x: 1 }, screens: { a: { cycles: NaN, looks: -3, ids: [], checkedAt: 0 }, b: { cycles: 2, looks: 2, ids: [], checkedAt: 0 } },
    byAgent: { a: { ...empty(), input: NaN }, b: { ...empty(), input: -5 }, c: { ...empty(), input: 7 } } }
  expect(bad(cardSvg(s).source)).toBe(false)
  expect(money(-0.001)).toBe('$0.00')
  expect(costOf({ model: 'opus', input_tokens: 1 } as never)).toBeGreaterThan(0)
})

test('share bar never leaves the card', () => {
  const s = { ...fresh(), all: { ...empty(), cost: 10 }, figma: { ...empty(), steps: 1, cost: 20 }, figmaTools: { x: 1 } }
  const widths = [...cardSvg(s).source.matchAll(/<rect x="26" y="\d+" width="(\d+)" height="6"/g)].map(m => Number(m[1]))
  expect(Math.max(...widths)).toBeLessThanOrEqual(294)
})

test('control characters and odd text are cleaned, labels cut by code point', () => {
  const s = { ...fresh(), names: { a: 'bad\u0001name\u0000</text><script>' , b: '😀'.repeat(30), c: '日本語'.repeat(8) },
    byAgent: { a: { ...empty(), input: 3 }, b: { ...empty(), input: 2 }, c: { ...empty(), input: 1 } } }
  const svg = cardSvg(s).source
  expect(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(svg)).toBe(false)
  expect(svg.includes('<script>')).toBe(false)
  expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(svg)).toBe(false)
  expect(clip('日本語'.repeat(8), 24).length).toBeLessThanOrEqual(12)
})

test('saved state with nulls or missing parts is repaired field by field', () => {
  const s = normalize({ screens: null, byAgent: undefined, all: null, names: { a: 5 } } as never)
  expect(s.screens).toEqual({})
  expect(s.all.cost).toBe(0)
  expect(cardSvg({ screens: null, byAgent: null } as never).source.startsWith('<svg')).toBe(true)
})

test('tiny segments still draw a valid shape', () => {
  const s = { ...fresh(), figmaTools: { x: 1 }, byAgent: { a: { ...empty(), input: 1 }, b: { ...empty(), input: 1_000_000 } } }
  expect(cardSvg(s).source.includes('NaN')).toBe(false)
})

test('big amounts shrink to fit, and mega rounds up cleanly', () => {
  const s = { ...fresh(), all: { ...empty(), cost: 56789.9 }, figma: { ...empty(), steps: 1, cost: 12345.67 }, figmaTools: { x: 1 } }
  expect(cardSvg(s).source.includes('font-size="38"')).toBe(false)
  expect(mega(999_500)).toBe('1.0M')
  expect(mega(1e9)).toBe('1000.0M')
})

test('maps that grow with the session are capped', () => {
  const big = Object.fromEntries(Array.from({ length: 700 }, (_, i) => [`k${i}`, i]))
  const t = trim(big, 500)
  expect(Object.keys(t).length).toBe(500)
  expect(t.k699).toBe(699)
})

test('terminal bar copes with bad numbers', () => {
  expect(bar(NaN, 10, 10)).toEqual({ filled: 0, rest: 10 })
  expect(bar(5, NaN, 10)).toEqual({ filled: 0, rest: 10 })
  expect(bar(50, 10, 10)).toEqual({ filled: 10, rest: 0 })
})

test('labels are cut on a word, not in the middle of one', () => {
  expect(clip('review figma-cost mod code now please', 26)).toBe('review figma-cost mod…')
  expect(clip('Build rework screens', 26)).toBe('Build rework screens')
  expect(clip('Supercalifragilisticexpialidocious thing', 20)).toBe('Supercalifragilisti…')
  expect(clip('review figma-cost mod code', 22)).toBe('review figma-cost mod…')
})

test('real session cost replaces the estimate and scales the Figma share', () => {
  // The ledger read $5 when our estimate stood at $1; since then the ledger grew $4 while the estimate grew $5.
  const s = { ...fresh(), costBase: 5, estAtBase: 1, all: { ...empty(), cost: 6 }, figma: { ...empty(), cost: 2 } }
  const c = calibrate(s, 9)
  expect(c.all.cost).toBe(9)
  expect(Math.abs(c.figma.cost - 1.6) < 1e-9).toBe(true)
  expect(calibrate(s, null)).toBe(s)
  expect(calibrate(s, NaN)).toBe(s)
})

test('a baseline taken late does not shrink the Figma cost, little spend since keeps the estimate', () => {
  // A base captured long after counting began (the old bug): the estimate before it is not part of the comparison.
  const late = { ...fresh(), costBase: 9.2, estAtBase: 12, all: { ...empty(), cost: 12.2 }, figma: { ...empty(), cost: 2.8 } }
  expect(calibrate(late, 10.6).figma.cost).toBe(2.8)           // under $1 of estimate since: too little to trust
  // A base saved by the older version has no estimate: it is dropped, not trusted.
  expect(normalize({ costBase: 9.2 } as never).costBase).toBeNull()
  expect(normalize({ costBase: 9.2, estAtBase: 3 } as never).costBase).toBe(9.2)
  // a ledger that went backwards (a cleared session) falls back to the estimate
  expect(calibrate({ ...late, costBase: 20 }, 10).figma.cost).toBe(2.8)
})

test('agent names are shown in lower case', () => {
  const s = { ...fresh(), names: { a: 'Stress-Test Figma-Cost EDGE Cases' }, byAgent: { a: { ...empty(), input: 1 } } }
  expect(agentShares(s)[0]?.name).toBe('stress-test figma-cost…')
})
