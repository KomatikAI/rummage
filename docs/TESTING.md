# Testing Rummage

## Hosted demo

To be filled: the hosted URL.

## Judge path in 5 minutes

To be filled.

## Sandbox buyer logins (to be filled)

To be filled with PayPal sandbox buyer accounts created for judging. These are sandbox-only test accounts.

## Seller walkthrough

To be filled.

## Pickup code demo

To be filled.

## Scan a table on a phone

The camera only starts over HTTPS (or `localhost`), so use a phone with the hosted deployment, for
example the Vercel preview. Listing photos must come from the hosted Supabase project; local photos
cannot be fetched by the model (see `docs/KNOWN-GAPS.md`, "Scan").

1. As a seller, open `/seller`, choose "Print your table sign" and print it (or leave it on a laptop
   screen). Check that only the sign is on the printed page.
2. On the phone, sign in as a buyer, then scan the QR code with the phone camera. It opens
   `/sale/<slug>/scan?household=<id>` with that table chosen. The sale page's "Scan a table" button
   opens the same screen.
3. Allow the camera. Point it at a listed item and tap "Scan". A price sticker appears with the title,
   price, condition and a "Hold for 15 minutes" button. Tap it, then "Go to your cart".
4. Point it at something that is not listed. The sticker says "Not listed here", with an estimated
   price range marked as an estimate.
5. Turn on "Auto". It scans every 3 seconds and stops on its own after 20 scans, 2 minutes without a
   tap, or when the tab is hidden.
6. Deny the camera (or use a browser without one) and choose "Use a photo instead". Take or pick a
   photo and tap "Scan this photo".
7. Tap "Scan" several times quickly. The screen asks you to slow down instead of failing.

## All payments are PayPal sandbox

Rummage refuses to start unless `PAYPAL_ENV=sandbox`. No real money moves and no live PayPal credentials are used.

## PayPal API routes in sandbox

These calls hit the local dev server and run against PayPal sandbox only. Every
id below is a placeholder. The signed-in routes read the Supabase session
cookie, so first copy the `sb-<project-ref>-auth-token` cookie from a signed-in
browser tab. Never paste real credentials into a shared terminal.

```bash
BASE=http://localhost:3000
COOKIE='sb-<project-ref>-auth-token=<session-cookie-value>'

# Buyer: create one PayPal order for a cart (one purchase unit per household,
# plus an optional donation when the sale is a fundraiser).
curl -s -X POST "$BASE/api/paypal/create-order" -b "$COOKIE" \
  -H 'content-type: application/json' \
  -d '{"cartId":"<cart-uuid>","donationCents":200}'
# -> {"orderId":"<ORDER-ID>","approveUrl":"https://www.sandbox.paypal.com/checkoutnow?token=<ORDER-ID>"}
# Open approveUrl, log in as a sandbox buyer and approve.

# Buyer: closed the checkout without paying? Put the cart back to open so its
# items can be changed again (holds stay). Safe to repeat on an open cart.
curl -s -X POST "$BASE/api/paypal/cancel" -b "$COOKIE" \
  -H 'content-type: application/json' \
  -d '{"cartId":"<cart-uuid>"}'
# -> {"status":"open"}
# 409 {"error":"capture_started","orderId":"<ORDER-ID>"} means a payment already
# began: call capture below instead.

# Buyer: capture the approved order. Each household gets its own status.
curl -s -X POST "$BASE/api/paypal/capture" -b "$COOKIE" \
  -H 'content-type: application/json' \
  -d '{"orderId":"<ORDER-ID>"}'
# -> {"outcome":"completed","units":[{"householdId":"...","referenceId":"...","status":"COMPLETED","captureId":"<CAPTURE-ID>"}]}

# Seller (or organizer): refund one household's capture in full.
curl -s -X POST "$BASE/api/paypal/refund" -b "$COOKIE" \
  -H 'content-type: application/json' \
  -d '{"captureId":"<CAPTURE-ID>","reason":"Item no longer available"}'
# -> {"refundId":"<REFUND-ID>","refundStatus":"COMPLETED","captureStatus":"REFUNDED"}

# Seller: start PayPal onboarding for a household.
curl -s -X POST "$BASE/api/paypal/partner-referral" -b "$COOKIE" \
  -H 'content-type: application/json' \
  -d '{"householdId":"<household-uuid>"}'
# -> {"actionUrl":"https://www.sandbox.paypal.com/bizsignup/..."}
# Complete sign-up with a sandbox business account. PayPal then redirects the
# browser to /api/paypal/partner-return, which confirms readiness with PayPal
# and redirects to /seller?household=<id>&onboarding=ready|pending.
```

Webhooks: register `<public-url>/api/paypal/webhook` in the sandbox app and
point `PAYPAL_WEBHOOK_ID` at it. Use a tunnel when developing locally. A
delivery that fails PayPal's signature check returns 400. Each verified event
is stored once in `paypal_events`, and a redelivery of an event that has
already been processed returns `{"received":true,"duplicate":true}`. The
sandbox Webhooks simulator sends sample events that will not match any local
cart. They are recorded and then ignored.

```bash
# An unsigned delivery is rejected (expect 400 invalid_signature).
curl -s -X POST "$BASE/api/paypal/webhook" \
  -H 'content-type: application/json' \
  -d '{"id":"WH-PLACEHOLDER","event_type":"PAYMENT.CAPTURE.COMPLETED","resource":{"id":"<CAPTURE-ID>"}}'
```

Error bodies always have the form `{"error":"<snake_case_code>","message":"..."}`.
A PayPal failure returns 502 and includes PayPal's `debugId`, which you can
quote to PayPal support.
