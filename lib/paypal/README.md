# lib/paypal

Server-only PayPal sandbox code: OAuth token cache, a REST client that sends the BN (partner attribution) header, PayPal-Auth-Assertion for acting on behalf of sellers, and webhook signature verification.
Orders v2 (one order with a purchase unit per seller, capture, refund) and Partner Referrals (seller onboarding and the return handler) will live here too.
Everything reads its configuration through `lib/env.ts`, which refuses to load unless `PAYPAL_ENV` is `sandbox`.
