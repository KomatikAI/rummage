# scripts/seed

Scripts that build the demo sale: households, listings and their photos.

- `photos-raw/` holds original photos and is gitignored. Only resized, committed demo images belong in the repo.
- Seed scripts read configuration from `.env.local` through `lib/env.ts` and only ever talk to the PayPal sandbox.
