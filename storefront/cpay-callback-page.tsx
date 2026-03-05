"use client"

/**
 * Reference implementation: cPay Callback Page for MedusaJS v2 storefront.
 *
 * Place this at a route like: /payment/cpay/callback
 *
 * The Medusa backend webhook redirects the browser here after
 * processing the cPay payment response.
 *
 * Query params received:
 *   cpay_status: "success" | "fail"
 *   ref: Details2 reference
 *   error: optional error message
 *
 * On success: calls your cart completion function, then redirects
 * to the order confirmation page.
 * On failure: shows error with retry option.
 */

import { useEffect, useRef, useState } from "react"

type CPayCallbackProps = {
  status: string
  reference?: string
  errorMessage?: string
  /** Your cart completion function (e.g., placeOrder from Medusa SDK) */
  onCompleteCart: () => Promise<void>
  /** Called when customer wants to retry payment */
  onRetry: () => void
  /** Called when customer wants to go back to cart */
  onBackToCart: () => void
}

export const CPayCallback: React.FC<CPayCallbackProps> = ({
  status,
  reference,
  errorMessage,
  onCompleteCart,
  onRetry,
  onBackToCart,
}) => {
  const [state, setState] = useState<"processing" | "error">(
    status === "success" ? "processing" : "error"
  )
  const [error, setError] = useState(errorMessage || "")
  const attempted = useRef(false)

  useEffect(() => {
    if (status !== "success" || attempted.current) return
    attempted.current = true

    onCompleteCart().catch((err) => {
      setState("error")
      setError(err?.message || "Failed to complete order. Please try again.")
    })
  }, [status, onCompleteCart])

  if (state === "processing") {
    return (
      <div>
        <p>Processing your payment...</p>
        <p>Please wait while we complete your order.</p>
      </div>
    )
  }

  return (
    <div>
      <h2>Payment failed</h2>
      <p>{error || "Your payment could not be processed. Please try again."}</p>
      {reference && <p>Reference: {reference}</p>}
      <button onClick={onBackToCart}>Back to cart</button>
      <button onClick={onRetry}>Try again</button>
    </div>
  )
}
