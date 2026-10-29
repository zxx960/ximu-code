/** Desktop-only occupants for the sidebar and blank-conversation brand slots. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { BrandMark, BrandName, type BrandIdentity } from './Brand.tsx'

/** The slot registry owns every contribution and its teardown. */
export const inject = ['slots']

/**
 * Present native-owned branding only in a primary Desktop document.
 * @param ctx - client plugin context.
 */
export function apply(ctx: Context): void {
  const carrier = globalThis as typeof globalThis & { dshDesktop?: { brand?: BrandIdentity } }
  const brand = carrier.dshDesktop?.brand
  if (brand === undefined) return
  ctx.slots.inject('sidebar.brand.mark', () => ctx.slots.inject('sidebar.brand.name', function* () {
    yield ctx.slots.register({ name: 'sidebar.brand.mark', inject: () => brand }, BrandMark)
    yield ctx.slots.register({ name: 'sidebar.brand.name', inject: () => brand }, BrandName)
  }))
  ctx.slots.inject('conversation.hero.brand.mark', () =>
    ctx.slots.register({ name: 'conversation.hero.brand.mark', inject: () => brand }, BrandMark))
}
