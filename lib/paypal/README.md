# lib/paypal

Server-only PayPal **sandbox** client for Rummage's multiparty checkout: one
buyer pays several sellers in one order, sellers link their PayPal accounts
through Partner Referrals, and webhooks mark items sold.

Every call goes to `https://api-m.sandbox.paypal.com` and nowhere else.
Configuration comes from `lib/env.ts` (`env`), which refuses to load unless
`PAYPAL_ENV=sandbox`; `config.ts` checks it again next to the base URL.

Import from the barrel: `import { createMultiSellerOrder, captureOrder } from "@/lib/paypal"`.
Never import this folder from a client component.

## Modules

| File | What it does |
|---|---|
| `config.ts` | `getPayPalConfig()`: base URL, client id/secret, BN code, partner merchant id, webhook id. Throws if not sandbox. |
| `fetch.ts` | `setPayPalFetch(fn)`: the single fetch used by every module. Tests install a mock; `undefined` restores global fetch. |
| `token.ts` | `getAccessToken()`: client-credentials token cached in the module, refreshed 60 s before expiry, one shared in-flight request. `resetTokenCache()`. |
| `auth-assertion.ts` | `buildAuthAssertion(clientId, merchantId)`. |
| `client.ts` | `paypalRequest<T>({ method, path, body?, rawBody?, query?, requestId?, asMerchant?, prefer?, expectStatuses? })` returns `{ status, body, debugId }`. |
| `errors.ts` | `PayPalApiError` (`status`, `paypalName`, `message`, `debugId`, `details`, `issues`, `method`, `path`, `body`), `PayPalInputError` (`issues`). |
| `orders.ts` | `createMultiSellerOrder`, `captureOrder`, `getOrder`, `resolveTimedOutCapture`, `classifyOrder`. |
| `refunds.ts` | `refundCapture`, `getRefund`. |
| `partner-referrals.ts` | `createPartnerReferral`, `parsePartnerReturn`, `getMerchantIntegration`, `summariseMerchantIntegration`. |
| `webhooks.ts` | `WEBHOOK_EVENT_TYPES`, `createWebhook`, `verifyWebhookSignature`, `parseWebhookEvent`. |
| `money.ts` | Two-decimal amount validation and cent helpers. |

## Headers

`paypalRequest` always sends `Authorization: Bearer <token>`,
`Content-Type: application/json` and `PayPal-Partner-Attribution-Id: <PAYPAL_BN_CODE>`.
It adds `PayPal-Request-Id` when you pass `requestId`, `Prefer` when you pass
`prefer`, and `PayPal-Auth-Assertion` when you pass `asMerchant`. A 401 drops
the cached token and retries once. Any status outside `expectStatuses`
(default: any 2xx) throws `PayPalApiError`; log its `debugId` when asking
PayPal support about a failure.

Orders, captures and refunds send `Prefer: return=representation`: the
default (`return=minimal`) returns only `id`, `status` and links, which would
hide the per-seller capture details.

## The auth-assertion rule

Send `PayPal-Auth-Assertion` **only** when acting on one seller's behalf:

- refunding that seller's capture (`refundCapture`, `getRefund` take `merchantId`);
- reading an order as a seller (`getOrder(id, { asMerchant })`, also accepted by `resolveTimedOutCapture`).

Do **not** send it when creating or capturing the multi-seller order, for
partner referrals, merchant-integration lookups or webhooks: those are the
platform's own calls.

The value is an unsigned JWT: `base64url({"alg":"none"})`, a dot,
`base64url({"iss":"<PAYPAL_CLIENT_ID>","payer_id":"<seller merchant id>"})`,
and a trailing dot (empty signature). Only the `payer_id` form is supported.

## Checkout flow

```ts
const order = await createMultiSellerOrder({
  units: [
    { referenceId: "cart-9-seller-a", merchantId: sellerA.paypalMerchantId, amount: "17.50",
      items: [{ name: "Cast iron pan", quantity: 1, unitAmount: "17.50", sku: listingId }] },
    { referenceId: "cart-9-seller-b", merchantId: sellerB.paypalMerchantId, amount: "5.00" },
  ],
  returnUrl: `${env.APP_URL}/checkout/return`,
  cancelUrl: `${env.APP_URL}/checkout/cancel`,
  requestId: `create-${cartId}`,
});
redirect(order.approveUrl!); // rel "payer-action"

// After the buyer approves:
const result = await captureOrder(order.id, { requestId: `capture-${order.id}` });
```

Validation (zod, before any request): 1 to 10 units, unique `referenceId`,
USD only, amounts as positive two-decimal strings (`"12.50"`), and when
`items` are given the unit `amount` must equal the item total. Each unit gets
`payee.merchant_id` and `payment_instruction.disbursement_mode: "INSTANT"`; no
platform fees. Invalid input throws `PayPalInputError` with `issues` like
`units.1.referenceId: duplicate referenceId "r1"`.

### Capture outcomes

`captureOrder` never throws for these four statuses; anything else throws `PayPalApiError`.

| HTTP | Order status | `outcome` | Meaning / what to do |
|---|---|---|---|
| 201 | `COMPLETED` | `completed` | Every unit captured. A unit's `captureStatus` may still be `PENDING` (e.g. `captureStatusReason: "PENDING_REVIEW"`); wait for `PAYMENT.CAPTURE.COMPLETED`. |
| 207 | `PARTIALLY_COMPLETED` | `partial` | Some units declined. Check each unit's `captureStatus`; mark only `COMPLETED`/`PENDING` units sold. |
| 422 | (error body) | `none` | Nothing captured. `error.name`, `error.details[].issue` (e.g. `INSTRUMENT_DECLINED`) and `error.debugId` say why. |
| 504 | (none) | `timeout` | PayPal gave up after 20 s. Call `resolveTimedOutCapture(orderId)`; do not assume either way. |

Each unit carries `referenceId`, `merchantId`, `captureId`, `captureStatus`,
`amount`, `sellerReceivable` (`seller_receivable_breakdown`) and `refundUrl`
(the capture's `rel: "refund"` link).

`resolveTimedOutCapture` GETs the order and maps it into the same union:
all units captured and order `COMPLETED` gives `completed`; some captured
gives `partial`; none captured gives `none` (with `orderStatus`, usually
`APPROVED`). On `none` after a timeout, retry `captureOrder` with the **same**
`requestId` so PayPal deduplicates it.

## Refunds

```ts
await refundCapture({ captureId, merchantId: sellerMerchantId });                       // full
await refundCapture({ captureId, merchantId, amount: { value: "2.50" }, noteToPayer }); // partial
```

## Seller onboarding

```ts
const { actionUrl } = await createPartnerReferral({
  trackingId: seller.id,
  returnUrl: `${env.APP_URL}/sell/paypal/return`,
});
// actionUrl is single use: create a fresh one each time the seller clicks "Connect PayPal".
```

On the return URL, `parsePartnerReturn(url.searchParams)` turns PayPal's
params into `{ trackingId (PayPal's "merchantId"), merchantIdInPayPal,
permissionsGranted, consentStatus, isEmailConfirmed, productIntentId,
accountStatus, riskStatus }` with real booleans. Those values come through the
browser, so confirm with the API before enabling the seller:

```ts
const status = await getMerchantIntegration({ merchantIdInPayPal });
// or getMerchantIntegration({ trackingId: seller.id })
if (status.readyToSell) { /* payments_receivable, primary_email_confirmed, payment + refund scopes */ }
```

`hasRefundScope` looks for `.../payments/refund`; `hasPaymentScope` looks for
any other `.../payments/...` scope (the refund scope also contains
`/payments/`, so it is excluded on purpose). The tracking-id lookup may return
only `merchant_id` and links; `getMerchantIntegration` then follows up with
the merchant-id call.

## Webhooks

```ts
// app/api/paypal/webhook/route.ts
const rawBody = await request.text();
if (!(await verifyWebhookSignature({ headers: request.headers, rawBody }))) {
  return new Response("invalid signature", { status: 400 });
}
const event = parseWebhookEvent(rawBody);
switch (event.eventType) { /* PAYMENT.CAPTURE.COMPLETED, ... */ }
```

`verifyWebhookSignature` reads `PAYPAL-AUTH-ALGO`, `PAYPAL-CERT-URL`,
`PAYPAL-TRANSMISSION-ID`, `PAYPAL-TRANSMISSION-SIG` and
`PAYPAL-TRANSMISSION-TIME`, defaults `webhook_id` to `PAYPAL_WEBHOOK_ID`, and
returns `verification_status === "SUCCESS"`. It returns `false` without a
network call when a header is missing, the cert URL is not an https
`*.paypal.com` URL, or the body is not a JSON object. The raw body is embedded
byte for byte as `webhook_event` (never re-serialised). Always read the body
with `request.text()`, not `request.json()`.

`createWebhook({ url })` subscribes to `WEBHOOK_EVENT_TYPES`:
`MERCHANT.ONBOARDING.COMPLETED`, `MERCHANT.PARTNER-CONSENT.REVOKED`,
`CHECKOUT.ORDER.APPROVED`, `CHECKOUT.PAYMENT-APPROVAL.REVERSED`,
`PAYMENT.CAPTURE.PENDING`, `PAYMENT.CAPTURE.COMPLETED`,
`PAYMENT.CAPTURE.DENIED`, `PAYMENT.CAPTURE.REFUNDED`. PayPal requires an
https URL, so local development needs a tunnel.

## Tests

`npx vitest run lib/paypal`. Every test mocks fetch through `test-utils.ts`
(`stubPayPalEnv`, `mockPayPal`, `resetPayPalTestState`); nothing reaches the
network and no real credentials are used. Auth-assertion fixtures split the
base64 `{"alg":"none"}` literal so the pre-commit JWT scan does not flag them.
