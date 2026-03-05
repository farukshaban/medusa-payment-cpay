/**
 * cPay Payment Provider for MedusaJS v2
 * Configuration and type definitions
 */

export interface CPayOptions {
  /** Merchant ID assigned by cPay (PayToMerchant value) */
  merchantId: string
  /** Merchant name registered with cPay */
  merchantName: string
  /** MD5 checksum authentication key (TEST_PASS for testing) */
  checksumKey: string
  /** cPay payment page URL */
  paymentUrl: string
  /** Base URL of the Medusa backend (for webhook callbacks) */
  callbackBaseUrl: string
  /** Base URL of the storefront (for browser redirect after payment) */
  storefrontUrl: string
}

/**
 * The canonical order of parameters for checksum calculation.
 * Only non-empty parameters are included.
 * cPay spec: "Parameters with empty values should not be added in the checksum header"
 */
export const CPAY_PARAM_ORDER = [
  "PaymentOKURL",
  "PaymentFailURL",
  "AmountToPay",
  "AmountCurrency",
  "PayToMerchant",
  "Details1",
  "Details2",
  "MerchantName",
  "Fee",
  "CRef",
  "TransactionType",
  "Installment",
  "RPRef",
  "OriginalAmount",
  "OriginalCurrency",
  "FirstName",
  "LastName",
  "Address",
  "City",
  "Zip",
  "Country",
  "Telephone",
  "Email",
] as const

/**
 * Parameters sent TO cPay in the payment request.
 */
export interface CPayRequestParams {
  AmountToPay: string
  AmountCurrency: string
  Details1: string
  Details2: string
  PayToMerchant: string
  MerchantName: string
  PaymentOKURL: string
  PaymentFailURL: string
  CheckSumHeader: string
  CheckSum: string
  OriginalAmount?: string
  OriginalCurrency?: string
  Fee?: string
  CRef?: string
  TransactionType?: string
  Installment?: string
  RPRef?: string
  FirstName?: string
  LastName?: string
  Address?: string
  City?: string
  Zip?: string
  Country?: string
  Telephone?: string
  Email?: string
}

/**
 * Parameters received FROM cPay in the response (echoed request + additional).
 */
export interface CPayResponseParams extends CPayRequestParams {
  cPayPaymentRef?: string
  ReturnCheckSumHeader: string
  ReturnCheckSum: string
}

/**
 * Data stored in the Medusa PaymentSession.data field.
 */
export interface CPaySessionData {
  /** The cPay form parameters for redirect (used by storefront) */
  cpay_form_params: CPayRequestParams
  /** The cPay payment page URL (used by storefront) */
  cpay_payment_url: string
  /** Our unique reference (Details2) */
  details2: string
  /** The expected amount (for validation) */
  expected_amount: string
  /** Payment status */
  status: "pending" | "authorized" | "captured" | "canceled" | "failed"
  /** Set by webhook after successful validation */
  cpay_authorized?: boolean
  /** cPay payment reference (set after cPay processes the payment) */
  cpay_payment_ref?: string
  /** Full cPay response (set by webhook) */
  cpay_response?: Record<string, string>
  /** Authorization timestamp */
  authorized_at?: string
  /** Capture timestamp */
  captured_at?: string
  /** Cancellation timestamp */
  canceled_at?: string
}
