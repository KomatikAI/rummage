/**
 * Hand-written Supabase types for the Rummage schema.
 *
 * Source of truth: supabase/migrations/20261027120000_init.sql. Keep the two in sync:
 * `schema-sync.test.ts` checks that TABLE_COLUMNS below matches every `create table`
 * column list in the migration, and TABLE_COLUMNS is checked at compile time against
 * the Row types, so a column added in one place and not the other fails the tests.
 *
 * Postgres -> TypeScript: uuid/text/date/time/timestamptz -> string,
 * numeric/integer/double precision -> number, jsonb -> Json.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

// ---------------------------------------------------------------------------
// Enumerations (text + check constraints in SQL)
// ---------------------------------------------------------------------------

export const SALE_STATUSES = ["draft", "open", "closed"] as const;
export type SaleStatus = (typeof SALE_STATUSES)[number];

export const PAYPAL_STATUSES = ["unlinked", "pending", "ready", "revoked"] as const;
export type PayPalLinkStatus = (typeof PAYPAL_STATUSES)[number];

export const ITEM_CATEGORIES = [
  "kids",
  "furniture",
  "kitchen",
  "garden",
  "books",
  "sports",
  "clothing",
  "electronics",
  "tools",
  "decor",
  "other",
] as const;
export type ItemCategory = (typeof ITEM_CATEGORIES)[number];

export const ITEM_CONDITIONS = ["new", "like_new", "good", "fair", "poor"] as const;
export type ItemCondition = (typeof ITEM_CONDITIONS)[number];

export const ITEM_STATUSES = [
  "draft",
  "listed",
  "held",
  "sold",
  "collected",
  "cash_sold",
  "hidden",
] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

/** Item states a seller may set directly; the rest belong to the buyer flow. */
export const SELLER_SETTABLE_ITEM_STATUSES = ["draft", "listed", "hidden", "cash_sold"] as const;

export const CART_STATUSES = ["open", "checkout", "paid", "partial", "failed", "abandoned"] as const;
export type CartStatus = (typeof CART_STATUSES)[number];

/** PayPal Orders v2 allows at most this many purchase units per order. */
export const PAYPAL_MAX_PURCHASE_UNITS = 10;

/**
 * Household cap per cart, mirroring hold_item(): one unit is reserved for the donation
 * when the sale has a fundraiser.
 */
export function maxHouseholdsPerCart(fundraiserName: string | null): number {
  return fundraiserName === null ? PAYPAL_MAX_PURCHASE_UNITS : PAYPAL_MAX_PURCHASE_UNITS - 1;
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

export type SaleRow = {
  id: string;
  organizer_user_id: string | null;
  name: string;
  slug: string;
  description: string | null;
  sale_date: string | null;
  starts_at: string | null;
  ends_at: string | null;
  area_lng: number | null;
  area_lat: number | null;
  area_radius_m: number | null;
  fundraiser_name: string | null;
  organizer_merchant_id: string | null;
  invite_token: string;
  status: SaleStatus;
  created_at: string;
};

export type HouseholdRow = {
  id: string;
  sale_id: string;
  owner_user_id: string | null;
  label: string;
  exact_lng: number | null;
  exact_lat: number | null;
  public_lng: number | null;
  public_lat: number | null;
  merchant_id_in_paypal: string | null;
  tracking_id: string;
  paypal_status: PayPalLinkStatus;
  paypal_checked_at: string | null;
  paused: boolean;
  created_at: string;
};

export type ItemRow = {
  id: string;
  household_id: string;
  title: string;
  description: string | null;
  category: ItemCategory;
  condition: ItemCondition;
  price: number | null;
  price_low: number | null;
  price_high: number | null;
  price_reason: string | null;
  photo_path: string | null;
  status: ItemStatus;
  prohibited_flag: boolean;
  prohibited_reason: string | null;
  created_at: string;
  updated_at: string;
};

export type CartRow = {
  id: string;
  buyer_user_id: string;
  sale_id: string;
  status: CartStatus;
  paypal_order_id: string | null;
  created_at: string;
  updated_at: string;
};

export type CartLineRow = {
  cart_id: string;
  item_id: string;
  household_id: string;
  price: number;
  hold_expires_at: string;
  /** true while the cart is open or in checkout (drives the one-live-hold-per-item index). */
  active: boolean;
  created_at: string;
};

export type PurchaseUnitRow = {
  id: string;
  cart_id: string;
  /** null = the donation unit to the organizer. */
  household_id: string | null;
  reference_id: string;
  amount: number;
  merchant_id: string;
  capture_id: string | null;
  capture_status: string | null;
  seller_receivable: number | null;
  refund_id: string | null;
  refund_status: string | null;
  /** Service role only. Clients get it through get_my_pickups(). */
  pickup_code: string | null;
  created_at: string;
  updated_at: string;
};

export type PayPalEventRow = {
  event_id: string;
  event_type: string;
  resource_type: string | null;
  resource_id: string | null;
  received_at: string;
  processed_at: string | null;
  payload: Json;
};

/** purchase_units columns a client (authenticated) may select: no pickup_code, no merchant_id. */
export const PURCHASE_UNIT_CLIENT_COLUMNS = [
  "id",
  "cart_id",
  "household_id",
  "reference_id",
  "amount",
  "capture_id",
  "capture_status",
  "seller_receivable",
  "refund_id",
  "refund_status",
  "created_at",
  "updated_at",
] as const satisfies readonly (keyof PurchaseUnitRow)[];

export type PurchaseUnitClientRow = Pick<
  PurchaseUnitRow,
  (typeof PURCHASE_UNIT_CLIENT_COLUMNS)[number]
>;

// ---------------------------------------------------------------------------
// Views and function results
// ---------------------------------------------------------------------------

export type PublicSaleRow = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  sale_date: string | null;
  starts_at: string | null;
  ends_at: string | null;
  area_lng: number | null;
  area_lat: number | null;
  area_radius_m: number | null;
  fundraiser_name: string | null;
  accepts_donations: boolean;
  status: SaleStatus;
};

/** One row of public_listings. Only jittered public_* coordinates, never exact_*. */
export type PublicListingRow = {
  item_id: string;
  sale_id: string;
  sale_slug: string;
  household_id: string;
  household_label: string;
  public_lng: number | null;
  public_lat: number | null;
  accepts_paypal: boolean;
  title: string;
  description: string | null;
  category: ItemCategory;
  condition: ItemCondition;
  price: number | null;
  price_low: number | null;
  price_high: number | null;
  price_reason: string | null;
  photo_path: string | null;
  status: Extract<ItemStatus, "listed" | "held" | "sold">;
  created_at: string;
};

/** One row of get_my_pickups(). */
export type PickupRow = {
  purchase_unit_id: string;
  cart_id: string;
  sale_id: string;
  sale_name: string;
  household_id: string;
  household_label: string;
  item_id: string;
  item_title: string;
  item_status: ItemStatus;
  exact_lng: number | null;
  exact_lat: number | null;
  pickup_code: string | null;
  capture_status: string;
};

export type OrganizerHouseholdSummary = {
  household_id: string;
  label: string;
  paypal_status: PayPalLinkStatus;
  paused: boolean;
  items_listed: number;
  items_held: number;
  items_sold: number;
  items_collected: number;
  items_cash_sold: number;
  cash_total: number;
  gross: number;
};

/** Result of organizer_sale_summary(p_sale). Amounts are in the order currency. */
export type OrganizerSaleSummary = {
  sale_id: string;
  households: number;
  households_linked: number;
  items_listed: number;
  items_held: number;
  /** sold + collected */
  items_sold: number;
  items_collected: number;
  items_cash_sold: number;
  /** Completed, unrefunded captures for seller units. */
  gross_total: number;
  /** Sum of cash_sold item prices (recorded by sellers, not paid through PayPal). */
  cash_total: number;
  /** Completed, unrefunded donation units. */
  fundraiser_total: number;
  per_household: OrganizerHouseholdSummary[];
};

/** One element of mark_units_captured's p_units argument. */
export type CapturedUnitInput = {
  reference_id: string;
  capture_id: string | null;
  capture_status: string;
  seller_receivable: number | null;
};

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

/** Required keys stay required; everything else (defaults, nullables) becomes optional. */
type InsertOf<Row, RequiredKey extends keyof Row> = Pick<Row, RequiredKey> &
  Partial<Omit<Row, RequiredKey>>;

type Fk<Name extends string, Column extends string, Ref extends string> = {
  foreignKeyName: Name;
  columns: [Column];
  isOneToOne: false;
  referencedRelation: Ref;
  referencedColumns: ["id"];
};

export type Database = {
  public: {
    Tables: {
      sales: {
        Row: SaleRow;
        Insert: InsertOf<SaleRow, "name" | "slug">;
        Update: Partial<SaleRow>;
        Relationships: [];
      };
      households: {
        Row: HouseholdRow;
        Insert: InsertOf<HouseholdRow, "sale_id" | "label">;
        Update: Partial<HouseholdRow>;
        Relationships: [Fk<"households_sale_id_fkey", "sale_id", "sales">];
      };
      items: {
        Row: ItemRow;
        Insert: InsertOf<ItemRow, "household_id" | "title">;
        Update: Partial<ItemRow>;
        Relationships: [Fk<"items_household_id_fkey", "household_id", "households">];
      };
      carts: {
        Row: CartRow;
        Insert: InsertOf<CartRow, "sale_id">;
        Update: Partial<CartRow>;
        Relationships: [Fk<"carts_sale_id_fkey", "sale_id", "sales">];
      };
      cart_lines: {
        Row: CartLineRow;
        Insert: InsertOf<CartLineRow, "cart_id" | "item_id" | "household_id" | "price" | "hold_expires_at">;
        Update: Partial<CartLineRow>;
        Relationships: [
          Fk<"cart_lines_cart_id_fkey", "cart_id", "carts">,
          Fk<"cart_lines_item_id_fkey", "item_id", "items">,
          Fk<"cart_lines_household_id_fkey", "household_id", "households">,
        ];
      };
      purchase_units: {
        Row: PurchaseUnitRow;
        Insert: InsertOf<PurchaseUnitRow, "cart_id" | "reference_id" | "amount" | "merchant_id">;
        Update: Partial<PurchaseUnitRow>;
        Relationships: [
          Fk<"purchase_units_cart_id_fkey", "cart_id", "carts">,
          Fk<"purchase_units_household_id_fkey", "household_id", "households">,
        ];
      };
      paypal_events: {
        Row: PayPalEventRow;
        Insert: InsertOf<PayPalEventRow, "event_id" | "event_type" | "payload">;
        Update: Partial<PayPalEventRow>;
        Relationships: [];
      };
    };
    Views: {
      public_sales: {
        Row: PublicSaleRow;
        Relationships: [];
      };
      public_listings: {
        Row: PublicListingRow;
        Relationships: [];
      };
    };
    Functions: {
      join_sale: {
        Args: { p_invite_token: string; p_label: string };
        Returns: string;
      };
      hold_item: {
        Args: { p_item: string; p_cart: string };
        Returns: boolean;
      };
      release_hold: {
        Args: { p_item: string; p_cart: string };
        Returns: boolean;
      };
      release_expired_holds: {
        Args: never;
        Returns: number;
      };
      mark_units_captured: {
        Args: { p_cart: string; p_units: CapturedUnitInput[] };
        Returns: undefined;
      };
      mark_item_collected: {
        Args: { p_item: string; p_code: string };
        Returns: boolean;
      };
      get_my_pickups: {
        Args: never;
        Returns: PickupRow[];
      };
      organizer_sale_summary: {
        Args: { p_sale: string };
        Returns: OrganizerSaleSummary;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

export type PublicSchema = Database["public"];
export type TableName = keyof PublicSchema["Tables"];
export type Tables<T extends TableName> = PublicSchema["Tables"][T]["Row"];
export type TablesInsert<T extends TableName> = PublicSchema["Tables"][T]["Insert"];
export type TablesUpdate<T extends TableName> = PublicSchema["Tables"][T]["Update"];

// ---------------------------------------------------------------------------
// Column lists, checked at compile time against the Row types (both directions)
// ---------------------------------------------------------------------------

type MissingColumns<Row, List extends readonly (keyof Row)[]> =
  Exclude<keyof Row, List[number]> extends never
    ? unknown
    : { missingColumns: Exclude<keyof Row, List[number]> };

/** Accepts a column list only when it names every key of Row (and nothing else). */
function columns<Row>() {
  return <const List extends readonly (keyof Row)[]>(
    list: List & MissingColumns<Row, List>,
  ): List => list;
}

/** Every column of every table, in migration order. Used by schema-sync.test.ts. */
export const TABLE_COLUMNS = {
  sales: columns<SaleRow>()([
    "id",
    "organizer_user_id",
    "name",
    "slug",
    "description",
    "sale_date",
    "starts_at",
    "ends_at",
    "area_lng",
    "area_lat",
    "area_radius_m",
    "fundraiser_name",
    "organizer_merchant_id",
    "invite_token",
    "status",
    "created_at",
  ]),
  households: columns<HouseholdRow>()([
    "id",
    "sale_id",
    "owner_user_id",
    "label",
    "exact_lng",
    "exact_lat",
    "public_lng",
    "public_lat",
    "merchant_id_in_paypal",
    "tracking_id",
    "paypal_status",
    "paypal_checked_at",
    "paused",
    "created_at",
  ]),
  items: columns<ItemRow>()([
    "id",
    "household_id",
    "title",
    "description",
    "category",
    "condition",
    "price",
    "price_low",
    "price_high",
    "price_reason",
    "photo_path",
    "status",
    "prohibited_flag",
    "prohibited_reason",
    "created_at",
    "updated_at",
  ]),
  carts: columns<CartRow>()([
    "id",
    "buyer_user_id",
    "sale_id",
    "status",
    "paypal_order_id",
    "created_at",
    "updated_at",
  ]),
  cart_lines: columns<CartLineRow>()([
    "cart_id",
    "item_id",
    "household_id",
    "price",
    "hold_expires_at",
    "active",
    "created_at",
  ]),
  purchase_units: columns<PurchaseUnitRow>()([
    "id",
    "cart_id",
    "household_id",
    "reference_id",
    "amount",
    "merchant_id",
    "capture_id",
    "capture_status",
    "seller_receivable",
    "refund_id",
    "refund_status",
    "pickup_code",
    "created_at",
    "updated_at",
  ]),
  paypal_events: columns<PayPalEventRow>()([
    "event_id",
    "event_type",
    "resource_type",
    "resource_id",
    "received_at",
    "processed_at",
    "payload",
  ]),
} satisfies { [T in TableName]: readonly (keyof Tables<T>)[] };
