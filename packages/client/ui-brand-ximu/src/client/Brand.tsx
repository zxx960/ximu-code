/** Present the native shell's public artwork without sharing application services with components. */
import type { HeroBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'

/** Public identity captured from the primary native renderer. */
export interface BrandIdentity { readonly name: string; readonly logoUrl: string }

/**
 * Render the supplied mark at the size requested by a sidebar or conversation surface.
 * @param props - native artwork and the declaring surface's geometry.
 * @returns the unchanged square logo.
 */
export function BrandMark({ size, className, name, logoUrl }: BrandIdentity & HeroBrandMarkOwnerProps) {
  return <img src={logoUrl} alt={name} width={size} height={size} className={className}
    style={{ display: 'block', objectFit: 'contain', borderRadius: 'var(--dsw-radius-md)' }} />
}

/**
 * Render the product name independently of its mark.
 * @param props - identity supplied by the native shell.
 * @returns the localized native product name.
 */
export function BrandName({ name }: BrandIdentity) {
  return <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--dsw-alias-label-primary)', whiteSpace: 'nowrap' }}>{name}</span>
}
