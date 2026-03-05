"use client"

/**
 * Reference implementation: cPay Payment Button for MedusaJS v2 storefront.
 *
 * This component reads the cPay form parameters from the payment session
 * and submits a hidden form via POST to redirect the customer to cPay.
 *
 * Usage in your PaymentButton component:
 *
 *   const activeSession = cart.payment_collection?.payment_sessions?.find(
 *     (s) => s.status === "pending"
 *   )
 *
 *   if (activeSession && isCPay(activeSession.provider_id)) {
 *     return <CPayPaymentButton sessionData={activeSession.data} />
 *   }
 */

import React, { useRef, useState } from "react"

type CPayPaymentButtonProps = {
  notReady: boolean
  sessionData: {
    cpay_form_params?: Record<string, string>
    cpay_payment_url?: string
  }
}

export const CPayPaymentButton: React.FC<CPayPaymentButtonProps> = ({
  notReady,
  sessionData,
}) => {
  const [submitting, setSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const formRef = useRef<HTMLFormElement>(null)

  const formParams = sessionData?.cpay_form_params
  const paymentUrl = sessionData?.cpay_payment_url

  const handlePayment = () => {
    if (!formParams || !paymentUrl) {
      setErrorMessage("Payment data not available. Please try again.")
      return
    }
    setSubmitting(true)
    formRef.current?.submit()
  }

  return (
    <>
      <button
        disabled={notReady || !formParams || !paymentUrl || submitting}
        onClick={handlePayment}
      >
        {submitting ? "Redirecting..." : "Pay with card"}
      </button>

      {errorMessage && <p style={{ color: "red" }}>{errorMessage}</p>}

      {/* Hidden form — auto-submitted to redirect browser to cPay */}
      {formParams && paymentUrl && (
        <form
          ref={formRef}
          action={paymentUrl}
          method="POST"
          style={{ display: "none" }}
          acceptCharset="UTF-8"
        >
          {Object.entries(formParams).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}
        </form>
      )}
    </>
  )
}

/**
 * Helper to detect cPay provider.
 */
export const isCPay = (providerId?: string) => {
  return providerId?.startsWith("pp_cpay")
}
