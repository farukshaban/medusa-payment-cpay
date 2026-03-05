# medusa-payment-cpay

cPay payment provider for [MedusaJS v2](https://medusajs.com). Integrates the [cPay](https://www.cpay.com.mk) card payment gateway used in North Macedonia.

Built according to **cPay Merchant Integration Specification v2.6.8**.

Supported cards: MasterCard, Maestro, Visa, Diners Club, Domestic cards.

## How It Works

cPay is a **redirect-based** payment gateway. Card details are never entered on your site:

```
  Customer         Storefront         Medusa Backend           cPay
     |                 |                    |                     |
     |-- select cPay ->|                    |                     |
     |                 |-- initiatePayment->|                     |
     |                 |<-- form params ----|                     |
     |<-- redirect ----|----------- POST hidden form ----------->|
     |                 |                    |                     |
     |                 |          (customer enters card on cPay)  |
     |                 |                    |                     |
     |                 |                    |<--- PUSH (T1) ------|
     |                 |                    |---- 200 OK -------->|
     |<--------------------------- browser redirect --------------|
     |                 |                    |                     |
     |--- callback --->|--- placeOrder ---->|                     |
     |                 |<-- order created --|                     |
     |<-- confirmation-|                    |                     |
```

## Installation

### Option A: Install via npm / yarn

```bash
# npm
npm install medusa-payment-cpay

# yarn
yarn add medusa-payment-cpay
```

Then register the provider in `medusa-config.ts`:

```ts
module.exports = defineConfig({
  // ...
  modules: [
    {
      resolve: "@medusajs/medusa/payment",
      options: {
        providers: [
          {
            resolve: "medusa-payment-cpay",
            id: "cpay",
            options: {
              merchantId: process.env.CPAY_MERCHANT_ID,
              merchantName: process.env.CPAY_MERCHANT_NAME,
              checksumKey: process.env.CPAY_CHECKSUM_KEY,
              paymentUrl: process.env.CPAY_PAYMENT_URL,
              callbackBaseUrl: process.env.CPAY_CALLBACK_BASE_URL,
              storefrontUrl: process.env.CPAY_STOREFRONT_URL,
            },
          },
        ],
      },
    },
  ],
})
```

You still need to add the **webhook route** manually (Medusa API routes must live in your project). Copy the webhook file into your project:

```bash
mkdir -p src/api/webhooks/cpay
cp node_modules/medusa-payment-cpay/dist/webhook.js src/api/webhooks/cpay/route.ts
```

Or create `src/api/webhooks/cpay/route.ts` yourself using the reference in this package (see `src/webhook.ts`).

### Option B: Copy files directly (no npm)

Copy the `src/` files into your Medusa project:

```
your-medusa-project/src/
  modules/cpay/
    index.ts      <- src/provider.ts (rename to index.ts)
    service.ts    <- src/service.ts
    checksum.ts   <- src/checksum.ts
    types.ts      <- src/types.ts
  api/webhooks/cpay/
    route.ts      <- src/webhook.ts (rename to route.ts)
```

Then register with a local path:

```ts
{
  resolve: "./src/modules/cpay",
  id: "cpay",
  options: { ... }
}
```

### Add body parser middleware

cPay sends POST data as `application/x-www-form-urlencoded`. Add to your `src/api/middlewares.ts`:

```ts
import { defineMiddlewares } from "@medusajs/framework/http"
import { urlencoded } from "express"

export default defineMiddlewares({
  routes: [
    // ... your existing routes
    {
      matcher: "/webhooks/cpay",
      method: ["POST"],
      middlewares: [urlencoded({ extended: true })],
    },
  ],
})
```

### Environment variables

```env
# Required
CPAY_MERCHANT_ID=123456                    # PayToMerchant value (from bank)
CPAY_MERCHANT_NAME=YourStoreName           # MerchantName (from bank)
CPAY_CHECKSUM_KEY=TEST_PASS                # TEST_PASS for testing, production key from bank
CPAY_CALLBACK_BASE_URL=https://api.example.com  # Your Medusa backend URL
CPAY_STOREFRONT_URL=https://example.com          # Your storefront URL

# Optional (defaults shown)
CPAY_PAYMENT_URL=https://www.cpay.com.mk/client/Page/default.aspx?xml_id=/mk-MK/.loginToPay/.simple/
```

### Enable in Medusa Admin

Go to **Settings > Regions > [Your Region] > Payment Providers** and enable **cpay**.

## Storefront Integration

See the `storefront/` directory for reference implementations:

- **`cpay-payment-button.tsx`** -- Hidden form + redirect button
- **`cpay-callback-page.tsx`** -- Callback handler after cPay redirect

### Payment Button

When cPay is selected, the payment button must create a hidden HTML form and submit it via POST. The form parameters come from `session.data.cpay_form_params`:

```tsx
const activeSession = cart.payment_collection?.payment_sessions?.find(
  (s) => s.status === "pending"
)

if (isCPay(activeSession?.provider_id)) {
  const { cpay_form_params, cpay_payment_url } = activeSession.data

  return (
    <form ref={formRef} action={cpay_payment_url} method="POST">
      {Object.entries(cpay_form_params).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <button type="submit">Pay with card</button>
    </form>
  )
}
```

### Callback Page

Create a route at `/payment/cpay/callback`. The webhook redirects the browser here with query params:

| Param | Value |
|-------|-------|
| `cpay_status` | `"success"` or `"fail"` |
| `ref` | Details2 reference |
| `error` | Error message (on failure) |

On success, call your cart completion function (e.g., `placeOrder()`). On failure, show error with retry option.

### Payment Info Map

```tsx
export const paymentInfoMap = {
  pp_cpay_cpay: {
    title: "Pay with card",
    icon: <CreditCard />,
    description: "Pay online with debit or credit card via cPay.",
  },
}

export const isCPay = (providerId?: string) => providerId?.startsWith("pp_cpay")
```

## Advanced: Using exports

The package exports utilities for custom integrations:

```ts
// Default: ModuleProvider (for medusa-config.ts)
import cpayProvider from "medusa-payment-cpay"

// Checksum utilities (for custom webhook handlers)
import { generateChecksum, validateReturnChecksum } from "medusa-payment-cpay/checksum"

// Types
import type { CPayOptions, CPaySessionData } from "medusa-payment-cpay"
```

## Checksum Algorithm

Implements the MD5 checksum from cPay spec Appendix A:

```
Header      = NN + ParamName1,ParamName2,..., + LLL1LLL2...LLLN
InputString = Header + Value1 + Value2 + ... + ValueN + ChecksumAuthKey
CheckSum    = MD5(UTF-8(InputString))   // 32-char uppercase hex
```

- **Request checksum**: merchant sends with payment request
- **Return checksum**: cPay sends back (first two params swapped + cPayPaymentRef added)
- **Validation is mandatory** -- without it, attackers could fake payments

Unit tests verify against both official examples from the specification.

## Testing

```bash
# Run checksum tests
npm test
```

1. Set `CPAY_CHECKSUM_KEY=TEST_PASS` for the testing period
2. cPay provides a 1-month testing window from merchant definition
3. Test transactions can be submitted from any domain during this period
4. After going live, switch to the production key from the bank
5. After going live, payments only work from your registered domain

## Important Notes (from cPay spec)

| Rule | Detail |
|------|--------|
| No iframes/popups | cPay form must open as full page redirect |
| Currency | Only MKD (Macedonian Denar) |
| Amount format | Multiplied by 100, last two digits always `00` |
| Details2 | Unique per payment, max 10 chars alphanumeric |
| PUSH notifications | Only on ports 80/443, valid SSL, static IP |
| Domain restriction | After test period, only registered domain works |
| HTTP Referer | Must be present (form POST handles this) |
| Forbidden chars | `'` and `@@` trigger IP block by cPay |
| ReturnCheckSum | **Must validate** -- prevents fake success callbacks |

## File Structure

```
medusa-payment-cpay/
  package.json
  tsconfig.json
  jest.config.js
  src/
    index.ts              # Main entry point + re-exports
    provider.ts           # ModuleProvider registration
    service.ts            # AbstractPaymentProvider implementation
    checksum.ts           # MD5 checksum generation & validation
    types.ts              # TypeScript types
    webhook.ts            # Webhook route (copy to src/api/webhooks/cpay/route.ts)
    __tests__/
      checksum.test.ts    # 13 tests against spec examples
  storefront/
    cpay-payment-button.tsx  # Reference: redirect button
    cpay-callback-page.tsx   # Reference: callback page
```

## License

MIT
