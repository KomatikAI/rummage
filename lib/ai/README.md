# lib/ai

Lane D: Claude-backed features for Rummage. Everything here is server-only and takes its data access and model clients by injection, so tests run with fakes and no network.

## Modules

| File | What it does |
|---|---|
| `schemas.ts` | zod `ListingDraft` (title, description, category, condition, price range, reason, prohibited flag, confidence note) and the JSON schema sent as `output_config.format`. |
| `pricing.ts` | `priceFromPhoto({ imageBase64, mediaType, sellerHint?, saleContext? }, { client? })`: one Anthropic Messages call (`claude-opus-5-5`, adaptive thinking, effort `medium`, structured output, server-side fallbacks on) with one image block and one text block. The reply is parsed and zod-validated. A refusal, `max_tokens`, context-window stop, missing text, bad JSON or schema failure throws `PricingError` with a `code`. |
| `screen-listing.ts` | `screenListing({ title, description, category, imageBase64?, mediaType? }, { client? })` -> `{ prohibited, reason, checked }`: the server-side prohibited-item screen. Same client pattern and model as pricing (adaptive thinking, effort `low`, structured output from `z.toJSONSchema`). The prompt lists what a community yard sale refuses (weapons and ammunition, prescription drugs, alcohol, tobacco and vapes, recalled child items such as drop-side cribs and car seats of unknown history, live animals, counterfeits, adult content, stolen or unowned property). Never throws: an API error or unusable reply fails closed as `{ prohibited: true, reason: SCREEN_UNCHECKED_REASON, checked: false }`. `detectImageMediaType(bytes)` sniffs JPEG, PNG, GIF and WebP. |
| `shopping-tools.ts` | `ItemsRepo` interface and `makeShoppingTools(repo, { cartId })`: AI SDK 7 tools `search_items`, `hold_item`, `release_hold`, `get_cart`. |
| `shopping-assistant.ts` | `runShoppingAssistant({ messages, repo, cartId, saleName }, { model? })` (streaming, `streamText`) and `generateShoppingReply` (same call, `generateText`). Stops after at most 8 steps. Returns the result plus a `toolCalls` summary. |
| `organizer-tools.ts` | `SaleReadRepo` interface, read-only tools `sale_summary`, `household_statuses`, `fundraiser_total`, and `runOrganizerAssistant({ question, repo, saleId, paypalTools? }, { model? })`. |
| `scan-schema.ts` | zod `ScanReply` (strict: `matchId`, `confidence`, `box`, `alternatives`, `notListed`) and the JSON schema sent as `output_config.format`. |
| `scan-match.ts` | `matchFrameToListings({ frameBase64, mediaType, candidates }, { client? })` -> `ScanMatchResult`: matches one camera frame against at most 24 listed items. See "Scan matching" below. |
| `paypal-readonly.ts` | The PayPal toolkit actions and tool names the organizer may use (`list_transactions`, `get_order`, `get_refund`). |
| `paypal-toolkit-adapter.ts` | Spike: `wrapToolkitTools()` re-wraps PayPal Agent Toolkit (ai@4) tools as AI SDK 7 tools; `makePayPalOrganizerTools({ clientId, clientSecret })` returns the read-only set, sandbox forced. Not re-exported from `index.ts`, so the barrel never loads the toolkit. Findings: `docs/SPIKE-NOTES.md`, "Agent Toolkit adapter (lane D)". |
| `test-utils.ts` | Test fixtures and mock-model results. Test-only. |

## The assistant never pays

- The shopping assistant has no payment, checkout, order, capture or refund tool. It can search, hold (15 minutes), release and read the cart. Tests assert the registered tool names.
- Its prompt forbids saying or implying that it has paid or that an item is bought, and it ends by sending the buyer to `/buyer/cart`, where the buyer confirms payment with PayPal themselves.
- The cart id is bound when the tools are built. The model never supplies it, so it cannot hold items in another buyer's cart.
- The organizer assistant only reads. `runOrganizerAssistant` throws if `paypalTools` holds any tool outside `ORGANIZER_PAYPAL_TOOL_NAMES`.

## Scan matching

"Scan a table" (`/sale/[slug]/scan`) sends one camera frame to `POST /api/scan`, which calls `matchFrameToListings`.

- One Anthropic Messages call: `claude-opus-5-5`, adaptive thinking, effort `low`, structured output, server-side fallbacks on, `max_tokens` 4000.
- The request lists each candidate as a text label (id, title, price, condition, category, description) followed by its listing photo as a URL image block, then the base64 frame, then the instruction. The candidate list is the same for every frame from one table, so a `cache_control` breakpoint sits on the last candidate block and repeat scans reuse the cached prefix.
- The prompt says listing text is seller-written data, never instructions, and that prices come only from the labels.
- The reply is parsed and zod-validated, then sanitized: a `matchId` that is not a candidate becomes no match, alternatives are filtered to real candidates (at most 3, never the match), the box is clamped to the frame, and `notListed` is kept only when nothing matched (title trimmed, prices rounded to cents, low never above high).
- More than 24 candidates, an empty frame, a refusal, `max_tokens`, a context-window stop, missing text, bad JSON or a schema failure throws `ScanMatchError` with a `code`.
- The route picks the candidates: available and held items from one table (or the whole sale when it has 24 items or fewer), never sold ones. The frame is never stored or logged.

## How tools and clients are injected

- Data: pass an `ItemsRepo` or `SaleReadRepo` implementation (the Supabase lane owns the real ones). The tools only call the repo.
- Models: `priceFromPhoto` takes `{ client }` (anything with `beta.messages.create`); the assistants take `{ model }` (any AI SDK `LanguageModel`, e.g. `MockLanguageModelV4` from `ai/test`). Without one, they build a default from `env.ANTHROPIC_API_KEY`, read when the call is made, not at import.
- PayPal: build the tools with `makePayPalOrganizerTools` and pass them as `paypalTools`. Leave it out and the organizer answers from sale records only.

## Tests

`npx vitest run lib/ai`. Every test uses fakes; none needs an API key or makes a network call.

## Wiring

The Supabase lane's implementations live in `lib/repos/` and run as the signed-in user (cookie client, RLS), never the service role.

- `SupabaseItemsRepo` (`items-repo.ts`) implements `ItemsRepo` for one sale: search reads `public_listings`, holds and releases call `hold_item` / `release_hold`, the cart reads `carts` + `cart_lines` with titles from `public_listings`.
- `SupabaseSaleReadRepo` (`sale-read-repo.ts`) implements `SaleReadRepo` from `organizer_sale_summary(p_sale)`, `sales` and `households`. Read-only.
- `createRepos(saleId, client?)` (`index.ts`) builds both for the current request. Gaps against the schema: `lib/repos/SCHEMA-GAPS.md`.

The seller's listing action (`createItem` in `app/seller/actions.ts`) runs `screenListing` on every new item, whether or not the seller used "Price it". After checking the seller owns the household, it reads the uploaded photo back from storage with the service role and screens text plus photo. A flagged item is written with the service role as a `draft` with `prohibited_flag = true` and `prohibited_reason` (sellers cannot write those columns), and the form gets a plain error. A screen that could not run lists nothing and asks the seller to try again. The browser-side block from "Price it" stays as the first line.

Routes:

| Route | Body | Returns |
|---|---|---|
| `POST /api/assistant/shop` | `{ saleId, messages }` (`useChat` UI messages) | `runShoppingAssistant` as an AI SDK UI-message stream, bound to the buyer's open cart (created if missing). 401 signed out, 404 unknown sale, 409 sale not open or cart at checkout. |
| `POST /api/assistant/organizer` | `{ saleId, messages }` | `{ text, toolCalls, paypalData }` from `runOrganizerAssistant`; the latest user message is the question. 403 unless `sales.organizer_user_id` is the caller. PayPal read-only tools attach only when `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET` are set. |
| `POST /api/pricing` | JSON `{ imageBase64, mediaType, sellerHint?, saleContext? }` or multipart `image` | The `ListingDraft` from `priceFromPhoto`. 401 signed out, 413 over 5 MB, 422 refusal, 502 unusable reply. The image is never stored. |
| `POST /api/scan` | `{ saleSlug, householdId?, frameBase64, mediaType }` (JPEG, PNG or WebP, at most 1.5 MB) | `{ match: { item, confidence, box } \| null, alternatives, notListed }`. 401 signed out, 400 invalid body or base64, 400 `pick_a_table` (with `households`) when the whole sale has more than 24 items, 404 unknown sale or table, 413 frame too large, 429 `slow_down` (one scan per 1.2 s, 60 per 10 minutes per user, per server instance), 422 refusal, 502 unusable reply. The frame is never stored. |
