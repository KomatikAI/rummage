# Rummage

Rummage is an open source app for community sales: neighborhood yard sales, swap meets, bazaars and school fundraisers. An organizer creates a sale and invites households. Each household lists its items, and AI proposes a title, description and price from a photo, which the seller can accept or change. Buyers browse every listing on one map, put items from several sellers in one cart, and pay all of them in a single PayPal checkout. Each order gets a pickup code that the seller checks when the buyer collects the item.

## Judge path in 5 minutes

- To be filled: open the hosted demo.
- To be filled: sign in with a sandbox buyer from [docs/TESTING.md](docs/TESTING.md).
- To be filled: add items from two sellers and pay in one PayPal sandbox checkout.
- To be filled: confirm a pickup with the pickup code.
- To be filled: view the sale from the organizer page.

## Setup

1. Clone the repository.
2. Install dependencies: `npm ci`
3. Copy `.env.example` to `.env.local`.
4. Fill in your PayPal sandbox app credentials, your Supabase project values and your Anthropic API key in `.env.local`. Keep `PAYPAL_ENV=sandbox`.
5. Start the dev server: `npm run dev`

Other scripts: `npm test` (vitest), `npm run lint`, `npm run build`, `npm run check-secrets` (the same check the pre-commit hook runs on staged files).

## Test logins

Sandbox buyer and seller logins are listed in [docs/TESTING.md](docs/TESTING.md).

## Architecture

- **Next.js App Router** (TypeScript, Tailwind CSS), deployed on Vercel.
- **Supabase** for data, auth and photo storage.
- **PayPal**: Orders v2 with one purchase unit per seller (multi-seller checkout), Partner Referrals for seller onboarding, Webhooks for payment events, and the PayPal Agent Toolkit for assistant tools. Route handlers live under `app/api/paypal/`, client code under `lib/paypal/`.
- **Claude** (Anthropic) for photo pricing, the shopping assistant and the organizer assistant (`lib/ai/`).
- **MapLibre GL** with **OpenFreeMap** tiles for the sale map.

## Sandbox only

Rummage runs against the PayPal sandbox only. `lib/env.ts` validates the server environment and the app refuses to start unless `PAYPAL_ENV=sandbox`. Never use live PayPal keys with this project. A pre-commit hook (`scripts/check-secrets.mjs`) blocks commits that contain keys, tokens or private keys.

## License

Apache License 2.0. See [LICENSE](LICENSE).
