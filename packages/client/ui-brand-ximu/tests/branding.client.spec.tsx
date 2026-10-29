// @vitest-environment jsdom
/** Native identity registration leaves browser profiles and model data untouched. */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { apply, inject } from '../src/client/index.ts'
import { BrandMark, BrandName } from '../src/client/Brand.tsx'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })
const identity = { name: '西牧code', logoUrl: 'dsh-app://app/desktop-logo.png' }
const names = ['sidebar.brand.mark', 'sidebar.brand.name', 'conversation.hero.brand.mark'] as const

async function fixture() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const slots = ctx.get('slots') as SlotRegistry
  return { ctx, slots, declare: () => slots.register({ name: 'root',
    children: Object.fromEntries(names.map(name => [name, { kind: 'single', scope: 'root' }])),
  } as never, () => null) }
}

it('leaves every brand slot empty without native identity', async () => {
  const f = await fixture()
  try {
    f.declare()
    await f.ctx.plugin({ inject: [...inject], apply }).await()
    for (const name of names) expect(f.slots.entries(name)).toHaveLength(0)
  } finally { await f.ctx.fiber.dispose() }
})

it('waits for declarations and removes native occupants during teardown', async () => {
  vi.stubGlobal('dshDesktop', { brand: identity })
  const f = await fixture()
  try {
    const plugin = f.ctx.plugin({ inject: [...inject], apply })
    await plugin.await()
    for (const name of names) expect(f.slots.entries(name)).toHaveLength(0)
    f.declare()
    await Promise.resolve()
    for (const name of names) expect(f.slots.entries(name)).toHaveLength(1)
    await plugin.dispose()
    for (const name of names) expect(f.slots.entries(name)).toHaveLength(0)
  } finally { await f.ctx.fiber.dispose() }
})

it('uses the supplied logo and product name at each surface size', () => {
  const mark = render(<BrandMark {...identity} size={34} className="hero" />)
  const image = mark.getByRole('img')
  expect(image.getAttribute('src')).toBe(identity.logoUrl)
  expect(image.getAttribute('width')).toBe('34')
  expect(image.getAttribute('alt')).toBe(identity.name)
  mark.rerender(<BrandMark {...identity} size={24} />)
  expect(image.getAttribute('width')).toBe('24')
  render(<BrandName {...identity} />)
  expect(document.body.textContent).toBe(identity.name)
})
