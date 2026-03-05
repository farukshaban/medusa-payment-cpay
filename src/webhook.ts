import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { validateReturnChecksum } from "./checksum"

/**
 * cPay Webhook / Callback Route
 *
 * This endpoint receives both:
 * 1. PUSH notifications (server-to-server POST from cPay)
 * 2. Browser redirects (POST from customer's browser after payment)
 *
 * cPay sends to the same PaymentOKURL/PaymentFailURL for both channels.
 *
 * Flow:
 * - Validate ReturnCheckSum to prove response authenticity
 * - Find and authorize the payment session
 * - Return 200 with HTML redirect (200 satisfies cPay PUSH, HTML redirects browser)
 *
 * PUSH notification retry schedule (if non-200 response):
 * T1: first push → T2: browser redirect → T3: T1+15s → T4: T3+5min → T5: T4+1h
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    // Parse cPay parameters from POST body
    // Body may be application/x-www-form-urlencoded or JSON
    const params = parseParams(req)

    const returnChecksumHeader = params.ReturnCheckSumHeader
    const returnChecksum = params.ReturnCheckSum
    const status = (req.query?.status as string) ?? "ok"
    const ref = (req.query?.ref as string) ?? params.Details2
    const resourceId = req.query?.resource_id as string

    // If no checksum data, this isn't a valid cPay callback
    if (!returnChecksumHeader || !returnChecksum) {
      console.error("[cPay webhook] Missing ReturnCheckSum headers")
      return respondWithRedirect(res, getStorefrontUrl(req), "fail", ref, "Missing checksum data")
    }

    // Get the checksum key from environment
    const checksumKey = process.env.CPAY_CHECKSUM_KEY
    if (!checksumKey) {
      console.error("[cPay webhook] CPAY_CHECKSUM_KEY not configured")
      return respondWithRedirect(res, getStorefrontUrl(req), "fail", ref, "Server configuration error")
    }

    // Validate the ReturnCheckSum
    const validation = validateReturnChecksum(
      params,
      returnChecksumHeader,
      returnChecksum,
      checksumKey
    )

    if (!validation.valid) {
      console.error("[cPay webhook] CheckSum validation failed:", validation.error)
      return respondWithRedirect(res, getStorefrontUrl(req), "fail", ref, "Invalid checksum")
    }

    // Validate amount matches (prevent amount tampering)
    const amountToPay = params.AmountToPay
    const details2 = params.Details2
    const cPayPaymentRef = params.cPayPaymentRef

    console.log(`[cPay webhook] Valid payment callback: Details2=${details2}, Amount=${amountToPay}, cPayRef=${cPayPaymentRef}, Status=${status}`)

    // Find and update the payment session
    if (status === "ok" && resourceId) {
      try {
        const paymentModule = req.scope.resolve(Modules.PAYMENT) as any

        // Find payment sessions for this payment collection
        const sessions = await paymentModule.listPaymentSessions(
          {
            payment_collection_id: resourceId,
            provider_id: "pp_cpay_cpay",
          },
          { select: ["id", "data"] }
        )

        // Find session matching our Details2 reference
        const session = sessions.find(
          (s: any) => s.data?.details2 === details2
        )

        if (session) {
          // Verify amount matches what we expected
          if (session.data?.expected_amount && session.data.expected_amount !== amountToPay) {
            console.error(
              `[cPay webhook] Amount mismatch: expected ${session.data.expected_amount}, got ${amountToPay}`
            )
            return respondWithRedirect(res, getStorefrontUrl(req), "fail", ref, "Amount mismatch")
          }

          // Update session data to mark as authorized
          await paymentModule.updatePaymentSession({
            id: session.id,
            data: {
              ...session.data,
              cpay_authorized: true,
              cpay_payment_ref: cPayPaymentRef || undefined,
              cpay_response: params,
              authorized_at: new Date().toISOString(),
              status: "authorized",
            },
          })

          console.log(`[cPay webhook] Session ${session.id} authorized successfully`)
        } else {
          console.warn(`[cPay webhook] No session found for Details2=${details2} in collection ${resourceId}`)
        }
      } catch (err) {
        console.error("[cPay webhook] Error updating payment session:", err)
        // Still return 200 to cPay to prevent retries
        // The session can be reconciled manually
      }
    }

    // Respond: 200 satisfies PUSH, HTML body redirects browser
    const redirectStatus = status === "ok" ? "success" : "fail"
    return respondWithRedirect(res, getStorefrontUrl(req), redirectStatus, ref)
  } catch (err) {
    console.error("[cPay webhook] Unhandled error:", err)
    // Always return 200 to cPay to prevent infinite retries
    return res.status(200).send("OK")
  }
}

/**
 * Also handle GET requests (some browser redirects may use GET).
 * cPay spec: "Read the GET/POST parameters via browser redirect"
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  // For GET, parameters are in query string — merge them
  const params = { ...req.query } as Record<string, string>
  // Delegate to POST handler logic
  ;(req as any).body = params
  return POST(req, res)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseParams(req: MedusaRequest): Record<string, string> {
  const body = req.body as Record<string, unknown> | undefined
  if (!body || typeof body !== "object") return {}

  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(body)) {
    if (value != null) {
      result[key] = String(value)
    }
  }
  return result
}

function getStorefrontUrl(req: MedusaRequest): string {
  return process.env.CPAY_STOREFRONT_URL || process.env.STORE_CORS?.split(",")[0] || "http://localhost:8000"
}

/**
 * Return HTTP 200 with an HTML page that redirects the browser.
 *
 * Why 200 + HTML instead of 302:
 * - cPay PUSH notifications require HTTP 200 (otherwise retries)
 * - Browser will follow the meta-refresh/JS redirect
 * - This single response satisfies both channels
 */
function respondWithRedirect(
  res: MedusaResponse,
  storefrontUrl: string,
  status: "success" | "fail",
  ref?: string,
  error?: string
) {
  const params = new URLSearchParams()
  params.set("cpay_status", status)
  if (ref) params.set("ref", ref)
  if (error) params.set("error", error)

  const redirectUrl = `${storefrontUrl}/payment/cpay/callback?${params}`

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta http-equiv="refresh" content="0;url=${escapeHtml(redirectUrl)}">
  <title>Redirecting...</title>
</head>
<body>
  <p>Redirecting to your order...</p>
  <script>window.location.href=${JSON.stringify(redirectUrl)};</script>
</body>
</html>`

  res.status(200).setHeader("Content-Type", "text/html; charset=utf-8").send(html)
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}
