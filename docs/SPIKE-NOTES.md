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

## Agent Toolkit adapter (lane D)

Spike result for `@paypal/agent-toolkit@1.11.0` inside AI SDK 7, from the installed bundle (`node_modules/@paypal/agent-toolkit/ai-sdk/index.js` and `index.d.ts`). Code: `lib/ai/paypal-toolkit-adapter.ts`, tests: `lib/ai/paypal-toolkit-adapter.test.ts`.

### Does it work with ai@7?

Not directly; it does through a small adapter. Each toolkit tool is an ai@4 `tool({ description, parameters, execute })` whose `parameters` is a zod 3 schema from the toolkit's nested `zod@3.25.76`. AI SDK 7 tools take `inputSchema`, so `wrapToolkitTools()` re-wraps each one in an ai@7 `tool()`:

- `parameters` goes through ai@7's `zodSchema()`. `@ai-sdk/provider-utils` 5.0.70 detects zod 3 at runtime (no `_zod` key) and converts it, so the model receives a proper JSON schema and inputs are validated before `execute`.
- `execute` is forwarded with ai@4 options `{ toolCallId, messages: [], abortSignal }`. The toolkit ignores `messages`.
- Two casts at the boundary, both documented in the file: the zod 3 schema is passed to `zodSchema()` as `unknown as` the root zod's `zod/v3` type (same runtime shape, different type declarations), and the legacy `execute` takes its argument as `never`.
- The declared type of `PayPalAgentToolkit.getTools()` (`{ [key: string]: Tool }` from the nested ai@4) is accepted by `wrapToolkitTools` with no cast. A test assigns it to the adapter's input type, so `tsc` breaks if a toolkit upgrade changes the shape.
- Tool results are `JSON.stringify(result)`. A failed PayPal call does not throw: `run()` returns `{"error":{"message":…,"type":"paypal_error"}}` as the tool result, which the model then reads.

### Configuration keys

`new PayPalAgentToolkit({ clientId, clientSecret, configuration })` where `configuration` is:

- `actions: { [product]: { [action]: boolean } }`. A tool is included when any of its action flags is `true`. Products and actions in 1.11.0:
  - `invoices`: `create`, `createRecurringSeries`, `activateRecurringSeries`, `getRecurringSeries`, `cancelRecurringSeries`, `deleteRecurringSeries`, `list`, `get`, `send`, `sendReminder`, `cancel`, `delete`, `setupReminders`, `updateReminder`, `search`, `update`, `cancelReminders`, `generateQRC`, `generateInvoiceNumber`, `recordPayment`, `recordRefund`, `createConditionalRules`
  - `products`: `create`, `list`, `update`, `show`
  - `subscriptionPlans`: `create`, `list`, `show`
  - `subscriptions`: `create`, `show`, `cancel`, `update`
  - `shipment`: `create`, `get`, `update`
  - `orders`: `create`, `get`, `capture`
  - `disputes`: `list`, `get`, `create`
  - `transactions`: `list`
  - `plan`: `update`
  - `payments`: `createRefund`, `getRefunds`
  - `insights`: `get`
- `context` (all optional): `sandbox`, `merchant_id`, `access_token`, `request_id`, `tenant_context`, `debug`, plus arbitrary extra keys. `debug: true` logs request and response bodies; never set it.

Tools are keyed by method name, not action name. Some names do not read like their action key: `orders.capture` is `pay_order`, `disputes.create` is `accept_dispute_claim`, `payments.getRefunds` is `get_refund`.

### Sandbox switch vs live

- The switch is `configuration.context.sandbox`. **The default is live**: the bundle reads `sandbox ?? false`.
- With `sandbox: true`, the token and SDK client use `https://api.sandbox.paypal.com` and the tool runner uses `https://api-m.sandbox.paypal.com`. Otherwise `https://api.paypal.com` and `https://api-m.paypal.com`.
- `makePayPalOrganizerTools` always passes `context: { sandbox: true }` and takes no context from the caller. A test checks the client's base URL is the sandbox one.
- Constructing the toolkit makes no network call. The client-credentials token is fetched on the first tool execution.

### Read-only tools

The organizer set is three actions, all reads: `transactions.list` (`list_transactions`), `orders.get` (`get_order`) and `payments.getRefunds` (`get_refund`). `makePayPalOrganizerTools` throws if the toolkit ever returns anything else, and `runOrganizerAssistant` refuses any PayPal tool outside that list.

Other reads exist but are not enabled: `invoices.list/get/search`, `products.list/show`, `subscriptionPlans.list/show`, `subscriptions.show`, `shipment.get`, `disputes.list/get`, `insights.get`. Everything else creates, sends, cancels, captures, refunds or accepts. In particular `orders.capture` (`pay_order`), `payments.createRefund` and `disputes.create` move money or concede a dispute.

### Auth-assertion and BN-code headers

No, neither can be passed. The client sends only `Content-Type`, `Authorization: Bearer …`, `User-Agent`, `PayPal-Request-Id` (only when `context.request_id` is set) and `PayPal-Tenant-Context` (only when `context.tenant_context` is set). The bundle contains no `PayPal-Auth-Assertion` or `PayPal-Partner-Attribution-Id` string, and extra `context` keys are not copied into headers. So calls made through the toolkit carry no partner (BN) attribution and cannot act on behalf of a connected seller via auth assertion. They run as the app's own REST credentials.

### Verdict on organizer Q&A

Usable for read-only organizer Q&A in the sandbox, with conditions:

- Only through `makePayPalOrganizerTools`: sandbox forced, three read actions, wrapped for ai@7.
- The data is the app account's own transactions, not per-household seller accounts. Without auth assertion it cannot read a connected seller's activity, so per-household PayPal figures must come from our own records (`household_statuses`), not the toolkit.
- No BN attribution on these calls. Anything that needs attribution, and every money-moving call, stays in `lib/paypal/`.
- The supply-chain caveats above still apply (nested `ai@4` and `zod@3`, 12 `npm audit` findings). If those are not acceptable for production, the fallback is a direct `GET /v1/reporting/transactions` wrapper in `lib/paypal/` exposed as an ai@7 tool; the organizer assistant takes any tools named in `ORGANIZER_PAYPAL_TOOL_NAMES`, so swapping is a one-line change at the call site.
