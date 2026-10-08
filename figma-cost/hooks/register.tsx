import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import { bridgeWords, calibrate, isEditCode, normalize, parseScreens, screenLookupCode, seeScreens, trim, add, agentShares, bar, empty, fresh, isBridgeError, isFigma, isRead, isShot, iterations, mega, money, cardSvg, percent, rateColor, segments, stepsOf, tokens } from './lib'

const PANE = 'figma-cost'
const stats = atom({ plugin: 'figma-cost', key: 'stats' } as const, fresh())
const ACCENT = ['#4B55C6', '#8A92E0', '#C9CDF2', '#9CA3AF', '#D1D5DB']

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'figma-cost', description: 'Show what Figma design work costs in this session' })
    try {
      const usd = await $.session.usage().then(u => u.cost?.usd ?? null, () => null)
      await update($, stats, saved => { const s = normalize(saved); return s.costBase === null && usd !== null ? { ...s, costBase: usd, estAtBase: s.all.cost } : s })
    } catch { /* optional */ }
    return next(e)
  })

  on('command.run', { command: 'figma-cost' }, async ($, e) => {
    if (String((e as { args?: string }).args ?? '').trim() === 'json') {
      const raw = normalize(await read($, stats))
      const usd = await $.session.usage().then(u => u.cost?.usd ?? null, () => null)
      return { text: JSON.stringify({ usd, ...raw }, null, 1) }
    }
    if (String((e as { args?: string }).args ?? '').trim() === 'reset') {
      const usd = await $.session.usage().then(u => u.cost?.usd ?? null, () => null)
      await update($, stats, () => ({ ...fresh(), costBase: usd, estAtBase: 0 }))
      return { text: 'Figma cost counters reset.' }
    }
    await $.ui.open({ id: PANE, title: 'Figma cost' })
    return { text: 'Figma cost pane opened.' }
  })

  const triedNames = new Map<string, number>()
  const safeText = (v: unknown): string => {
    try { return typeof v === 'string' ? v : JSON.stringify(v ?? '') } catch { return '' }
  }

  // Every step is filed under its agent; a step that asked for a Figma tool also counts as Figma work.
  // Counting is best effort: nothing here may throw into the model step.
  on('turn.step', async function* ($, e, next) {
    // First sight of the ledger: remember where it stood before this step was paid for.
    try {
      const before = normalize(await read($, stats))
      if (before.costBase === null) {
        const usd = await $.session.usage().then(u => u.cost?.usd ?? null, () => null)
        if (usd !== null) await update($, stats, saved => { const s = normalize(saved); return s.costBase === null ? { ...s, costBase: usd, estAtBase: s.all.cost } : s })
      }
    } catch { /* optional */ }
    const r = yield* next(e)
    try {
      const u = r.usage
      if (!u) return r
      const hasFigma = (r.toolUses ?? []).some(t => isFigma(String(t.name)))
      const who = e.agentId ?? 'main'
      await update($, stats, saved => {
        const s = normalize(saved)
        return {
          ...s,
          all: add(s.all, u),
          figma: hasFigma ? add(s.figma, u) : s.figma,
          byAgent: trim({ ...s.byAgent, [who]: add(s.byAgent[who] ?? empty(), u) }, 100),
        }
      })
      // Name any agent we have not named yet from the task it was given, trying a few times at most.
      const now = normalize(await read($, stats))
      const missing = Object.keys(now.byAgent).filter(id => id !== 'main' && !now.names[id] && (triedNames.get(id) ?? 0) < 3)
      if (missing.length > 0) {
        for (const id of missing) triedNames.set(id, (triedNames.get(id) ?? 0) + 1)
        const known = await $.agent.list()
        const found: Record<string, string> = {}
        for (const a of known) if (missing.includes(a.id) && a.description) found[a.id] = a.description
        if (Object.keys(found).length > 0) await update($, stats, saved => { const s = normalize(saved); return { ...s, names: trim({ ...s.names, ...found }, 100) } })
      }
    } catch { /* a counter is never worth failing a model step */ }
    return r
  })

  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    if (!isFigma(tool)) return next(e)
    const input = e as Record<string, unknown>
    const node = String(input.nodeId ?? input.node_id ?? '')
    const name = tool.replace(/^mcp__.*?__/, '')
    try {
      await update($, stats, saved => {
        const s = normalize(saved)
        return { ...s, figmaTools: { ...s.figmaTools, [name]: (s.figmaTools[name] ?? 0) + 1 } }
      })
    } catch { /* counting must never block a Figma call */ }
    const ran = await next(e)
    try {
      const r = ran as { isError?: boolean; deny?: string; text?: string; result?: unknown }
      if (r.deny) return ran
      const said = `${r.text ?? ''} ${safeText(r.result)}`.slice(0, 4000)
      const down = bridgeWords.test(said)
      if (r.isError || down) {
        await update($, stats, saved => {
          const s = normalize(saved)
          return { ...s, figmaErrors: s.figmaErrors + (r.isError ? 1 : 0), bridgeDown: down ? true : s.bridgeDown }
        })
        return ran
      }
      // A successful call: the bridge is up. An edit moves the edit counter; a screenshot closes a round for the screens it shows.
      if (isShot(tool)) {
        let found: Array<{ id: string; name: string; parent?: string }> | null = null
        if (/^[0-9:;-]+$/.test(node)) {
          try {
            // Read-only question to Figma itself, no model involved: which screens does this node show?
            const lookup = $.mcp.call('figma-console', 'figma_execute', { code: screenLookupCode(node), timeout: 4000 })
            // Never hold up the agent's own call for more than a moment.
            const patience = new Promise<null>(done => { $.clock.after(3000, () => done(null)) })
            found = parseScreens(await Promise.race([lookup, patience]))
          } catch { found = null }
        }
        await update($, stats, saved => {
          const s = { ...normalize(saved), bridgeDown: false }
          // Lookup failed or the node is not a screen: fall back to the node itself so nothing is silently dropped.
          const isSection = !!found && found.length > 0 && found.every(f => f.parent === node)
          return seeScreens(s, found && found.length > 0 ? found : node ? [{ id: node, name: `#${node}` }] : [], isSection ? node : undefined)
        })
      } else {
        const edit = name === 'figma_execute' ? isEditCode(String(input.code ?? '')) : !isRead(tool)
        await update($, stats, saved => {
          const s = normalize(saved)
          return edit ? { ...s, bridgeDown: false, editSeq: s.editSeq + 1, writesSinceShot: s.writesSinceShot + 1 } : s.bridgeDown ? { ...s, bridgeDown: false } : s
        })
      }
    } catch { /* same */ }
    return ran
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const s = calibrate(normalize(await read($, stats)), await $.session.usage().then(u => u.cost?.usd ?? null, () => null))
    if (e.surface !== 'terminal') {
      const { Box, Svg } = $.ui.resolve(e) as unknown as { Box: any; Svg: any }
      const card = cardSvg(s)
      return (
        <Box flexDirection="column" paddingX={1} paddingY={1}>
          <Svg source={card.source} alt={card.alt} />
        </Box>
      )
    }
    const { Box, Text } = $.ui.resolve(e)
    const cols = Math.max(30, Math.min(60, (e.props as { bodyColumns?: number }).bodyColumns ?? 44) - 2)
    const barWidth = Math.max(16, cols - 8)

    const it = iterations(s)
    const dim = s.bridgeDown
    const pct = percent(s.figma.cost, s.all.cost)
    const spent = bar(s.figma.cost, s.all.cost, barWidth)

    // One step of the story: a node, a lead word, then lines hung off the rail.
    const Step = ({ lead, last, children }: { lead: string; last?: boolean; children?: unknown }) => (
      <Box flexDirection="column">
        <Text><Text color="#4B55C6">●</Text><Text dimColor> {lead}</Text></Text>
        {children}
        {!last && <Text dimColor>│</Text>}
      </Box>
    )
    const Line = ({ last, children }: { last?: boolean; children?: unknown }) => (
      <Box flexDirection="row">
        <Text dimColor>{last ? '  ' : '│ '}</Text>
        <Box flexDirection="row">{children}</Box>
      </Box>
    )
    const steps = stepsOf(s)
    const has = (n: string) => (steps as string[]).includes(n)
    const showMore = steps.length > 1
    const agents = agentShares(s)
    const widths = segments(agents, barWidth)

    return (
      <Box flexDirection="column" paddingX={1}>
        {dim && <Text color="error">● Not connected</Text>}
        {dim && <Text> </Text>}

        <Step lead="Spent" last={!showMore}>
          <Line last={!showMore}>
            <Text bold dimColor={dim}>{money(s.figma.cost)}</Text>
            <Text dimColor> / {money(s.all.cost)}</Text>
          </Line>
          <Line last={!showMore}>
            <Text color="#4B55C6" dimColor={dim}>{'█'.repeat(spent.filled)}</Text>
            <Text dimColor>{'░'.repeat(spent.rest)}</Text>
          </Line>
          <Line last={!showMore}>
            <Text dimColor>{pct}% of the session{dim ? ', last known' : ''}</Text>
          </Line>
        </Step>

        {has('Bought') && (
          <Step lead="Bought">
            <Line><Text bold>{it.screens} screens</Text></Line>
            <Line><Text dimColor>{money(s.figma.cost / it.screens)} per screen</Text></Line>
          </Step>
        )}

        {has('Took') && (
          <Step lead="Took">
            <Line>
              <Text bold color={rateColor(it.perScreen)}>{it.perScreen.toFixed(1)}</Text>
              <Text bold> iterations per screen</Text>
            </Line>
          </Step>
        )}

        {has('Held back by') && (
          <Step lead="Held back by">
            {s.figmaErrors > 0 && (
              <Line>
                <Text bold>{s.figmaErrors} failed {s.figmaErrors === 1 ? 'call' : 'calls'}</Text>
              </Line>
            )}
            {s.writesSinceShot > 0 && (
              <Line>
                {s.figmaErrors > 0
                  ? <Text dimColor>{s.writesSinceShot} {s.writesSinceShot === 1 ? 'edit' : 'edits'} never checked</Text>
                  : <Text bold>{s.writesSinceShot} {s.writesSinceShot === 1 ? 'edit' : 'edits'} never checked</Text>}
              </Line>
            )}
          </Step>
        )}

        {has('Spent by') && agents.length > 0 && (
          <Step lead="Spent by" last>
            <Line last><Text bold>{mega(tokens(s.all))} tokens</Text></Line>
            <Line last>
              {agents.map((a, i) => (
                <Text color={ACCENT[i] ?? '#D1D5DB'}>{'█'.repeat(widths[i] ?? 0)}</Text>
              ))}
            </Line>
            {agents.map((a, i) => (
              <Line last>
                <Text color={ACCENT[i] ?? '#D1D5DB'}>■ </Text>
                <Text>{a.name.padEnd(26)}</Text>
                <Text dimColor>{mega(a.tokens).padStart(6)}</Text>
                <Text bold>{`${a.share}%`.padStart(5)}</Text>
              </Line>
            ))}
          </Step>
        )}

      </Box>
    )
  })
}
