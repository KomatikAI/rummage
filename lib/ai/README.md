# lib/ai

Lane D: Claude-backed features for Rummage. Everything here is server-only and takes its data access and model clients by injection, so tests run with fakes and no network.

## Modules

| File | What it does |
|---|---|
| `schemas.ts` | zod `ListingDraft` (title, description, category, condition, price range, reason, prohibited flag, confidence note) and the JSON schema sent as `output_config.format`. |
| `pricing.ts` | `priceFromPhoto({ imageBase64, mediaType, sellerHint?, saleContext? }, { client? })`: one Anthropic Messages call (`claude-opus-5-5`, adaptive thinking, effort `medium`, structured output, server-side fallbacks on) with one image block and one text block. The reply is parsed and zod-validated. A refusal, `max_tokens`, context-window stop, missing text, bad JSON or schema failure throws `PricingError` with a `code`. |
| `shopping-tools.ts` | `ItemsRepo` interface and `makeShoppingTools(repo, { cartId })`: AI SDK 7 tools `search_items`, `hold_item`, `release_hold`, `get_cart`. |
| `shopping-assistant.ts` | `runShoppingAssistant({ messages, repo, cartId, saleName }, { model? })` (streaming, `streamText`) and `generateShoppingReply` (same call, `generateText`). Stops after at most 8 steps. Returns the result plus a `toolCalls` summary. |
| `organizer-tools.ts` | `SaleReadRepo` interface, read-only tools `sale_summary`, `household_statuses`, `fundraiser_total`, and `runOrganizerAssistant({ question, repo, saleId, paypalTools? }, { model? })`. |
| `paypal-readonly.ts` | The PayPal toolkit actions and tool names the organizer may use (`list_transactions`, `get_order`, `get_refund`). |
| `paypal-toolkit-adapter.ts` | Spike: `wrapToolkitTools()` re-wraps PayPal Agent Toolkit (ai@4) tools as AI SDK 7 tools; `makePayPalOrganizerTools({ clientId, clientSecret })` returns the read-only set, sandbox forced. Not re-exported from `index.ts`, so the barrel never loads the toolkit. Findings: `docs/SPIKE-NOTES.md`, "Agent Toolkit adapter (lane D)". |
| `test-utils.ts` | Test fixtures and mock-model results. Test-only. |

## The assistant never pays

- The shopping assistant has no payment, checkout, order, capture or refund tool. It can search, hold (15 minutes), release and read the cart. Tests assert the registered tool names.
- Its prompt forbids saying or implying that it has paid or that an item is bought, and it ends by sending the buyer to `/buyer/cart`, where the buyer confirms payment with PayPal themselves.
- The cart id is bound when the tools are built. The model never supplies it, so it cannot hold items in another buyer's cart.
- The organizer assistant only reads. `runOrganizerAssistant` throws if `paypalTools` holds any tool outside `ORGANIZER_PAYPAL_TOOL_NAMES`.

## How tools and clients are injected

- Data: pass an `ItemsRepo` or `SaleReadRepo` implementation (the Supabase lane owns the real ones). The tools only call the repo.
- Models: `priceFromPhoto` takes `{ client }` (anything with `beta.messages.create`); the assistants take `{ model }` (any AI SDK `LanguageModel`, e.g. `MockLanguageModelV4` from `ai/test`). Without one, they build a default from `env.ANTHROPIC_API_KEY`, read when the call is made, not at import.
- PayPal: build the tools with `makePayPalOrganizerTools` and pass them as `paypalTools`. Leave it out and the organizer answers from sale records only.

## Tests

`npx vitest run lib/ai`. Every test uses fakes; none needs an API key or makes a network call.
