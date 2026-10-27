# Spike notes

## Installed versions

Recorded at scaffold time (2026-10-27) with `npm ls`.

| Package | Version |
|---|---|
| next | 16.4.3 |
| react | 19.3.0 |
| react-dom | 19.3.0 |
| ai | 7.0.155 |
| @ai-sdk/anthropic | 4.0.90 |
| @anthropic-ai/sdk | 1.3.0 |
| @paypal/agent-toolkit | 1.11.0 (kept) |
| zod | 4.6.7 |
| @supabase/supabase-js | 2.118.0 |
| @supabase/ssr | 0.12.7 |
| maplibre-gl | 6.16.0 |
| vitest | 5.0.5 |

## Agent Toolkit vs AI SDK

`npm install @paypal/agent-toolkit` installed without a peer-dependency conflict, so the package is kept.

`npm view @paypal/agent-toolkit peerDependencies version` reports version `1.11.0` and **no** `peerDependencies`. The toolkit declares `ai` (`^4.0.23`) and `zod` (`^3.24.2`) as regular dependencies instead, so npm installs private copies under `node_modules/@paypal/agent-toolkit/node_modules/` beside the app's own versions:

- `ai@4.3.19` (the app uses `ai@7.0.155`)
- `zod@3.25.76` (the app uses `zod@4.6.7`)
- also `openai@4.86.1` and `@langchain/core@0.3.6`

What this means for the build:

- The toolkit's `@paypal/agent-toolkit/ai-sdk` entry builds tools with its own AI SDK v4 copy. Passing those tool objects to `ai@7`'s `generateText` / `streamText` is not guaranteed to work: the tool shape and the zod major version both differ. This needs a spike before the shopping assistant relies on it. The fallback is to call the toolkit's PayPal functions directly and wrap them in `ai@7` `tool()` definitions with zod 4 schemas.
- `npm audit` after the install reports 12 vulnerabilities (1 moderate, 11 high), all in the toolkit's dependency tree (its nested `ai@4` / `@ai-sdk/*` packages, `@langchain/core`, `langsmith`, `jsondiffpatch`, `mathjs`, `uuid`). npm's only offered fix is `npm audit fix --force`, which downgrades the toolkit to 1.3.5. Not applied.
- The toolkit's own license field is ISC.

Install output (trimmed):

```
npm warn deprecated node-domexception@1.0.0: Use your platform's native DOMException instead
npm warn deprecated uuid@10.0.0: uuid@10 and below is no longer supported.

added 212 packages, and audited 764 packages in 8s

12 vulnerabilities (1 moderate, 11 high)
```

## Scaffold notes

- `create-next-app` 16.4.3 initialised its own git repository on `master` with an "Initial commit from Create Next App". That repository was removed and re-initialised on `main` so the project starts with a single scaffold commit.
- `vitest@5` declares an optional peer of `@types/node@^22 || >=24`, which conflicted with the `@types/node@^20` that create-next-app pins. `@types/node` was raised to `^22` (the project runs on Node 22).
- The vitest config is `vitest.config.mts` rather than `.ts`: the package is CommonJS (no `"type": "module"`), and Vite warns when a `.ts` config with ESM syntax is loaded as CommonJS.
