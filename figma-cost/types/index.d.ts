export type Bucket = { steps: number; input: number; output: number; cacheRead: number; cacheWrite: number; cost: number }
export type Screen = {
  /** build-and-check rounds: a screenshot taken after edits since its last one */
  cycles: number
  /** every screenshot that showed it */
  looks: number
  /** ids the screen has had; more than one means it was rebuilt */
  ids: string[]
  /** value of editSeq when it was last looked at */
  checkedAt: number
  /** id of the section it lives in, so a screen that left the section can be dropped */
  parent: string
}
export type Stats = {
  startedAt: number
  all: Bucket
  figma: Bucket
  /** every model step, filed under the agent that made it */
  byAgent: Record<string, Bucket>
  /** agent id to the short task description it was spawned with */
  names: Record<string, string>
  figmaTools: Record<string, number>
  figmaErrors: number
  /** screens as Figma names them: a frame inside a section. Keyed by name so a rebuilt screen is still the same screen. */
  screens: Record<string, Screen>
  /** counts every successful edit; a screen is "checked" when a screenshot follows edits it has not seen */
  editSeq: number
  /** Figma writes since the last screenshot */
  writesSinceShot: number
  /** the last Figma call failed because the bridge plugin is not connected */
  bridgeDown: boolean
  /** the session's real cost (USD, as /cost totals it) when counting began; null until first seen */
  costBase: number | null
  /** our own estimate (all.cost) at the moment costBase was read, so both are measured over the same stretch */
  estAtBase: number
}

declare module 'claude-code' {
  interface PluginState {
    'figma-cost': { stats: Stats }
  }
}
