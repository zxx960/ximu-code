/** Public page-bootstrap options shared by the Host and Client halves. */

import z from '@deepseek-ai/schemastery'

/** Models-page options after schema defaults are applied. */
export interface Config {
  /** Offer the browser API-key step when no native shell owns credential onboarding. */
  credentialOnboarding: boolean
  /** Provider IDs omitted from Models settings, including the add-provider catalog. */
  hiddenProviders: string[]
  /** Offer the built-in third-party provider catalog when adding a model provider. */
  providerCatalog: boolean
  /** Generate custom-provider IDs without displaying an ID input. */
  automaticProviderIds: boolean
}

/** Validate Host configuration and its public page-bootstrap payload. */
export const Config: z<Partial<Config>, Config> = z.object({
  credentialOnboarding: z.boolean().default(true),
  hiddenProviders: z.array(z.string()).default([]),
  providerCatalog: z.boolean().default(true),
  automaticProviderIds: z.boolean().default(false),
})

/** Page-global key carrying public Models settings and onboarding options. */
export const ONBOARDING_CONFIG_GLOBAL = '__DSH_MODELS_ONBOARDING__'
