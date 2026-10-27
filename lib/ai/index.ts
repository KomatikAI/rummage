/**
 * Lane D (AI) public surface. See ./README.md.
 *
 * The PayPal Agent Toolkit adapter is NOT re-exported here, so importing this
 * barrel never loads the toolkit (and its nested ai@4 / zod@3). Import it
 * directly: `import { makePayPalOrganizerTools } from "@/lib/ai/paypal-toolkit-adapter"`.
 */

export {
  hasAtMostTwoDecimals,
  ListingCategory,
  ListingCondition,
  ListingDraft,
  ListingDraftObject,
  listingDraftJsonSchema,
  listingDraftOutputFormat,
  LISTING_CATEGORIES,
  LISTING_CONDITIONS,
} from "./schemas";

export {
  buildPricingRequest,
  priceFromPhoto,
  PricingError,
  PRICING_MODEL,
  PRICING_SYSTEM_PROMPT,
  type PriceFromPhotoInput,
  type PricingClient,
  type PricingDeps,
  type PricingErrorCode,
  type PricingMediaType,
} from "./pricing";

export {
  buildScreenRequest,
  detectImageMediaType,
  ListingScreen,
  listingScreenJsonSchema,
  listingScreenOutputFormat,
  screenListing,
  SCREEN_DEFAULT_REASON,
  SCREEN_MAX_IMAGE_BYTES,
  SCREEN_MODEL,
  SCREEN_SYSTEM_PROMPT,
  SCREEN_UNCHECKED_REASON,
  type ScreenListingDeps,
  type ScreenListingInput,
  type ScreenListingResult,
} from "./screen-listing";

export {
  HOLD_MINUTES,
  makeShoppingTools,
  SHOPPING_TOOL_NAMES,
  type Cart,
  type CartLine,
  type HoldResult,
  type ItemsRepo,
  type ItemStatus,
  type ReleaseResult,
  type SearchItemsArgs,
  type ShopItem,
  type ShoppingTools,
} from "./shopping-tools";

export {
  ASSISTANT_MODEL,
  CART_PATH,
  generateShoppingReply,
  runShoppingAssistant,
  shoppingSystemPrompt,
  SHOPPING_MAX_STEPS,
  summarizeToolCalls,
  type AssistantDeps,
  type ShoppingAssistantInput,
  type ToolCallSummary,
} from "./shopping-assistant";

export {
  makeOrganizerTools,
  organizerSystemPrompt,
  ORGANIZER_MAX_STEPS,
  ORGANIZER_TOOL_NAMES,
  runOrganizerAssistant,
  type FundraiserTotal,
  type HouseholdStatus,
  type OrganizerAssistantInput,
  type SaleReadRepo,
  type SaleSummary,
} from "./organizer-tools";

export { ORGANIZER_PAYPAL_ACTIONS, ORGANIZER_PAYPAL_TOOL_NAMES } from "./paypal-readonly";
