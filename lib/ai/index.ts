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
  LISTING_CATEGORIES,
  LISTING_CONDITIONS,
} from "./schemas";

export {
  ASSISTANT_MODEL,
  openRouterModel,
  PRICING_MODEL,
  SCAN_MODEL,
  SCREEN_MODEL,
  type ReasoningEffort,
  type StructuredCall,
  type StructuredFailureCode,
} from "./openrouter";

export {
  buildPricingRequest,
  priceFromPhoto,
  PricingError,
  PRICING_EFFORT,
  PRICING_SYSTEM_PROMPT,
  type PriceFromPhotoInput,
  type PricingDeps,
  type PricingErrorCode,
  type PricingMediaType,
} from "./pricing";

export {
  buildScreenRequest,
  detectImageMediaType,
  ListingScreen,
  listingScreenJsonSchema,
  screenListing,
  SCREEN_DEFAULT_REASON,
  SCREEN_EFFORT,
  SCREEN_MAX_IMAGE_BYTES,
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
  assistantCallOptions,
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
