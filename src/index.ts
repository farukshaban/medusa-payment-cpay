/**
 * medusa-payment-cpay
 *
 * cPay payment provider for MedusaJS v2.
 *
 * Main entry point — re-exports the module provider (default)
 * and all public utilities for advanced usage.
 */

// Default export: Medusa ModuleProvider (used in medusa-config.ts resolve)
export { default } from "./provider"

// Payment provider service (for extending or testing)
export { default as CPayProviderService } from "./service"

// Checksum utilities (for custom webhook handlers or testing)
export {
  generateChecksum,
  validateReturnChecksum,
  parseChecksumHeader,
  buildChecksumHeader,
  buildInputString,
  md5Hash,
} from "./checksum"
export type { ChecksumParam } from "./checksum"

// Types
export type {
  CPayOptions,
  CPayRequestParams,
  CPayResponseParams,
  CPaySessionData,
} from "./types"
export { CPAY_PARAM_ORDER } from "./types"
