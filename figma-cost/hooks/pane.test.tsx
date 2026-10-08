import { test, expect } from 'claude-code/testing'

const MOUNT = {
  plugin: 'figma-cost',
  surface: 'terminal',
  component: 'Pane',
  requestId: 'figma-cost',
  props: { title: 'Figma cost', isFocused: false, bodyColumns: 50, placement: 'dock', scroll: { bodyRows: 40 }, view: {} } as never,
} as const

test('empty session shows only the Spent step', async $ => {
  const ui = await $.ui.mount(MOUNT)
  expect(await ui.find({ type: 'Text', text: /Figma cost/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /This session/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /Spent/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Bought/ })).toBeUndefined()
  await ui.unmount()
})
