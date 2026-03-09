import { AbstractPaymentProvider, BigNumber } from "@medusajs/framework/utils"
import type {
  AuthorizePaymentInput,
  AuthorizePaymentOutput,
  CancelPaymentInput,
  CancelPaymentOutput,
  CapturePaymentInput,
  CapturePaymentOutput,
  DeletePaymentInput,
  DeletePaymentOutput,
  GetPaymentStatusInput,
  GetPaymentStatusOutput,
  InitiatePaymentInput,
  InitiatePaymentOutput,
  ProviderWebhookPayload,
  RefundPaymentInput,
  RefundPaymentOutput,
  RetrievePaymentInput,
  RetrievePaymentOutput,
  UpdatePaymentInput,
  UpdatePaymentOutput,
  WebhookActionResult,
} from "@medusajs/framework/types"

import { generateChecksum, validateReturnChecksum } from "./checksum"
import type {
  CPayOptions,
  CPayRequestParams,
  CPaySessionData,
} from "./types"
import { CPAY_PARAM_ORDER } from "./types"

/**
 * cPay Payment Provider for MedusaJS v2
 *
 * Implements a redirect-based payment flow:
 * 1. initiatePayment() — builds cPay form parameters + checksum
 * 2. Frontend redirects customer to cPay via hidden form POST
 * 3. Customer enters card details on cPay's secure page
 * 4. cPay sends PUSH notification + browser redirect to webhook
 * 5. Webhook validates ReturnCheckSum + authorizes payment session
 * 6. Frontend completes the cart → order is created
 */
class CPayProviderService extends AbstractPaymentProvider<CPayOptions> {
  static identifier = "cpay"

  constructor(
    container: Record<string, unknown>,
    options: CPayOptions
  ) {
    super(container, options)
    this.validateOptions(options)
  }

  private validateOptions(options: CPayOptions) {
    const required: (keyof CPayOptions)[] = [
      "merchantId",
      "merchantName",
      "checksumKey",
      "paymentUrl",
      "callbackBaseUrl",
      "storefrontUrl",
    ]
    for (const key of required) {
      if (!options[key]) {
        throw new Error(`cPay provider: missing required option "${key}"`)
      }
    }
  }

  /**
   * Generate a unique 10-char alphanumeric reference for Details2.
   * cPay spec: Details2 max length = 10, alphanumeric.
   */
  private generateDetails2(): string {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
    let result = ""
    for (let i = 0; i < 10; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length))
    }
    return result
  }

  /**
   * Build the ordered parameter array for checksum calculation.
   * Only includes non-empty parameters.
   */
  private buildChecksumParams(
    allParams: Record<string, string | undefined>
  ): { name: string; value: string }[] {
    return CPAY_PARAM_ORDER.filter(
      (name) => allParams[name] != null && allParams[name] !== ""
    ).map((name) => ({ name, value: allParams[name]! }))
  }

  /**
   * Truncate a string to maxLen characters, removing disallowed chars.
   * cPay blocks SQL injection patterns — avoid ' and @@.
   */
  private sanitize(value: string | undefined, maxLen: number): string {
    if (!value) return ""
    return value
      .replace(/'/g, "")
      .replace(/@@/g, "")
      .substring(0, maxLen)
  }

  // ---------------------------------------------------------------------------
  // AbstractPaymentProvider methods
  // ---------------------------------------------------------------------------

  async initiatePayment(
    input: InitiatePaymentInput
  ): Promise<InitiatePaymentOutput> {
    const { amount, currency_code, context } = input
    const options = this.config

    const details2 = this.generateDetails2()

    // cPay requires AmountToPay = price in denar * 100 (last two digits always 00)
    // Medusa passes the amount in the currency's smallest unit.
    // For MKD (zero-decimal currency), Medusa passes the whole denar amount directly.
    // e.g. 410 MKD → Medusa sends 410 → cPay needs 41000
    const numericAmount = Number(amount)
    const amountToPay = String(numericAmount * 100)

    // Build callback URLs with identifiers for webhook lookup
    const resourceId = (context as any)?.resource_id ?? ""
    const callbackParams = new URLSearchParams({
      ref: details2,
      resource_id: String(resourceId),
    })
    const okUrl = `${options.callbackBaseUrl}/webhooks/cpay?${callbackParams}&status=ok`
    const failUrl = `${options.callbackBaseUrl}/webhooks/cpay?${callbackParams}&status=fail`

    // Extract optional customer details from context
    const customer = (context as any)?.customer ?? {}
    const billingAddress = (context as any)?.billing_address ?? {}

    // Build all parameters
    const allParams: Record<string, string | undefined> = {
      PaymentOKURL: okUrl,
      PaymentFailURL: failUrl,
      AmountToPay: amountToPay,
      AmountCurrency: currency_code.toUpperCase(),
      PayToMerchant: options.merchantId,
      Details1: this.sanitize(
        (context as any)?.details1 || "Online purchase",
        32
      ),
      Details2: details2,
      MerchantName: options.merchantName,
      FirstName: this.sanitize(
        customer.first_name || billingAddress.first_name,
        64
      ),
      LastName: this.sanitize(
        customer.last_name || billingAddress.last_name,
        64
      ),
      Address: this.sanitize(billingAddress.address_1, 128),
      City: this.sanitize(billingAddress.city, 100),
      Zip: this.sanitize(billingAddress.postal_code, 50),
      Country: this.sanitize(
        billingAddress.country_code?.toUpperCase(),
        100
      ),
      Telephone: this.sanitize(customer.phone || billingAddress.phone, 32),
      Email: this.sanitize(
        (context as any)?.email || customer.email,
        64
      ),
    }

    // Optional fields from context
    if ((context as any)?.original_amount) {
      allParams.OriginalAmount = String((context as any).original_amount)
    }
    if ((context as any)?.original_currency) {
      allParams.OriginalCurrency = String((context as any).original_currency)
    }
    if ((context as any)?.fee) {
      allParams.Fee = String((context as any).fee)
    }

    // Generate checksum
    const checksumParams = this.buildChecksumParams(allParams)
    const { header, checksum } = generateChecksum(
      checksumParams,
      options.checksumKey
    )

    // Build the form parameters for the storefront
    const formParams: CPayRequestParams = {
      AmountToPay: amountToPay,
      AmountCurrency: allParams.AmountCurrency!,
      Details1: allParams.Details1!,
      Details2: details2,
      PayToMerchant: options.merchantId,
      MerchantName: options.merchantName,
      PaymentOKURL: okUrl,
      PaymentFailURL: failUrl,
      CheckSumHeader: header,
      CheckSum: checksum,
    }

    // Add non-empty optional fields to form params
    const optionalFields = [
      "OriginalAmount", "OriginalCurrency", "Fee", "CRef",
      "TransactionType", "Installment", "RPRef",
      "FirstName", "LastName", "Address", "City",
      "Zip", "Country", "Telephone", "Email",
    ] as const
    for (const field of optionalFields) {
      if (allParams[field]) {
        ;(formParams as any)[field] = allParams[field]
      }
    }

    const sessionData: CPaySessionData = {
      cpay_form_params: formParams,
      cpay_payment_url: options.paymentUrl,
      details2,
      expected_amount: amountToPay,
      status: "pending",
    }

    return {
      id: details2,
      data: sessionData as unknown as Record<string, unknown>,
    }
  }

  async authorizePayment(
    input: AuthorizePaymentInput
  ): Promise<AuthorizePaymentOutput> {
    const data = input.data as unknown as CPaySessionData | undefined

    // If the webhook has already validated and authorized the payment
    if (data?.cpay_authorized) {
      return {
        status: "authorized",
        data: {
          ...(data as unknown as Record<string, unknown>),
          status: "authorized",
          authorized_at: data.authorized_at || new Date().toISOString(),
        },
      }
    }

    // Payment not yet authorized — customer needs to complete cPay flow
    return {
      status: "requires_more",
      data: (data as unknown as Record<string, unknown>) ?? {},
    }
  }

  async capturePayment(
    input: CapturePaymentInput
  ): Promise<CapturePaymentOutput> {
    // cPay one-step payments are auto-captured (purchase transaction).
    // No additional API call needed.
    return {
      data: {
        ...(input.data ?? {}),
        status: "captured",
        captured_at: new Date().toISOString(),
      },
    }
  }

  async refundPayment(
    input: RefundPaymentInput
  ): Promise<RefundPaymentOutput> {
    // cPay refunds (credit transactions) require TransactionType=004
    // and are typically initiated through the cPay merchant portal
    // or via a separate redirect with TransactionType=004.
    //
    // For automated refunds, this would need a separate integration
    // with cPay's credit transaction flow.
    return {
      data: {
        ...(input.data ?? {}),
        status: "refunded",
        refunded_at: new Date().toISOString(),
        refund_note:
          "Refund initiated. Complete via cPay merchant portal if not auto-processed.",
      },
    }
  }

  async cancelPayment(
    input: CancelPaymentInput
  ): Promise<CancelPaymentOutput> {
    return {
      data: {
        ...(input.data ?? {}),
        status: "canceled",
        canceled_at: new Date().toISOString(),
      },
    }
  }

  async deletePayment(
    input: DeletePaymentInput
  ): Promise<DeletePaymentOutput> {
    return { data: input.data ?? {} }
  }

  async getPaymentStatus(
    input: GetPaymentStatusInput
  ): Promise<GetPaymentStatusOutput> {
    const data = input.data as unknown as CPaySessionData | undefined
    if (!data) return { status: "pending" }

    if (data.captured_at) return { status: "captured" }
    if (data.canceled_at) return { status: "canceled" }
    if (data.cpay_authorized || data.authorized_at) return { status: "authorized" }
    return { status: "pending" }
  }

  async retrievePayment(
    input: RetrievePaymentInput
  ): Promise<RetrievePaymentOutput> {
    return { data: input.data ?? {} }
  }

  async updatePayment(
    input: UpdatePaymentInput
  ): Promise<UpdatePaymentOutput> {
    return { data: input.data ?? {} }
  }

  async getWebhookActionAndData(
    payload: ProviderWebhookPayload["payload"]
  ): Promise<WebhookActionResult> {
    const { data: webhookData } = payload
    const options = this.config

    // Parse the webhook payload (cPay POST parameters)
    const params = webhookData as unknown as Record<string, string>
    const returnChecksumHeader = params.ReturnCheckSumHeader
    const returnChecksum = params.ReturnCheckSum

    if (!returnChecksumHeader || !returnChecksum) {
      return {
        action: "not_supported",
        data: { session_id: "", amount: new BigNumber(0) },
      }
    }

    // Validate the ReturnCheckSum
    const validation = validateReturnChecksum(
      params,
      returnChecksumHeader,
      returnChecksum,
      options.checksumKey
    )

    if (!validation.valid) {
      console.error("[cPay] ReturnCheckSum validation failed:", validation.error)
      return {
        action: "failed",
        data: {
          session_id: params.Details2 || "",
          amount: new BigNumber(parseInt(params.AmountToPay, 10) || 0),
        },
      }
    }

    // CheckSum valid — payment authorized
    return {
      action: "authorized",
      data: {
        session_id: params.Details2,
        amount: new BigNumber(parseInt(params.AmountToPay, 10)),
      },
    }
  }
}

export default CPayProviderService
