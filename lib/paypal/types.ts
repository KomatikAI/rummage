/** Request and response shapes for the PayPal REST calls Rummage makes. */

export type HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

export interface Money {
  currency_code: string;
  value: string;
}

export interface PayPalLink {
  href: string;
  rel: string;
  method?: string;
}

export interface PayPalErrorDetail {
  issue: string;
  description?: string;
  field?: string;
  value?: string;
  location?: string;
}

/** Non-2xx body: `{ name, message, debug_id, details? }`. */
export interface PayPalErrorBody {
  name: string;
  message: string;
  debug_id?: string;
  details?: PayPalErrorDetail[];
  links?: PayPalLink[];
}

// ---------------------------------------------------------------- OAuth

export interface TokenResponse {
  access_token: string;
  token_type?: string;
  app_id?: string;
  expires_in: number;
  nonce?: string;
  scope?: string;
}

// ---------------------------------------------------------------- Orders v2

export type OrderStatus =
  | "CREATED"
  | "SAVED"
  | "APPROVED"
  | "VOIDED"
  | "COMPLETED"
  | "PAYER_ACTION_REQUIRED"
  | "PARTIALLY_COMPLETED";

export type CaptureStatus =
  | "COMPLETED"
  | "DECLINED"
  | "PARTIALLY_REFUNDED"
  | "PENDING"
  | "REFUNDED"
  | "FAILED";

export interface OrderItemRequest {
  name: string;
  quantity: string;
  unit_amount: Money;
  sku?: string;
}

export interface PurchaseUnitRequest {
  reference_id: string;
  description?: string;
  custom_id?: string;
  payee: { merchant_id: string };
  amount: Money & { breakdown?: { item_total: Money } };
  items?: OrderItemRequest[];
  payment_instruction: { disbursement_mode: "INSTANT" };
}

export interface CreateOrderRequest {
  intent: "CAPTURE";
  purchase_units: PurchaseUnitRequest[];
  payment_source: {
    paypal: {
      experience_context: {
        shipping_preference: "NO_SHIPPING";
        user_action: "PAY_NOW";
        return_url: string;
        cancel_url: string;
        brand_name?: string;
      };
    };
  };
}

export interface SellerReceivableBreakdown {
  gross_amount: Money;
  paypal_fee?: Money;
  net_amount?: Money;
  platform_fees?: Array<{ amount: Money; payee?: { merchant_id?: string } }>;
  receivable_amount?: Money;
}

export interface Capture {
  id: string;
  status: CaptureStatus | (string & {});
  status_details?: { reason?: string };
  amount?: Money;
  final_capture?: boolean;
  disbursement_mode?: string;
  seller_receivable_breakdown?: SellerReceivableBreakdown;
  custom_id?: string;
  invoice_id?: string;
  links?: PayPalLink[];
  create_time?: string;
  update_time?: string;
}

export interface PurchaseUnitResponse {
  reference_id?: string;
  description?: string;
  custom_id?: string;
  payee?: { merchant_id?: string; email_address?: string };
  amount?: Money;
  items?: Array<{ name: string; quantity: string; unit_amount?: Money; sku?: string }>;
  payments?: {
    captures?: Capture[];
    refunds?: Refund[];
  };
}

export interface OrderResponse {
  id: string;
  status: OrderStatus | (string & {});
  intent?: string;
  purchase_units?: PurchaseUnitResponse[];
  payer?: {
    payer_id?: string;
    email_address?: string;
    name?: { given_name?: string; surname?: string };
  };
  payment_source?: Record<string, unknown>;
  links?: PayPalLink[];
  create_time?: string;
  update_time?: string;
}

// ---------------------------------------------------------------- Payments v2 (refunds)

export interface RefundRequest {
  amount?: Money;
  note_to_payer?: string;
}

export type RefundStatus = "CANCELLED" | "FAILED" | "PENDING" | "COMPLETED";

export interface Refund {
  id: string;
  status: RefundStatus | (string & {});
  status_details?: { reason?: string };
  amount?: Money;
  note_to_payer?: string;
  seller_payable_breakdown?: {
    gross_amount?: Money;
    paypal_fee?: Money;
    net_amount?: Money;
    total_refunded_amount?: Money;
  };
  links?: PayPalLink[];
  create_time?: string;
  update_time?: string;
}

// ---------------------------------------------------------------- Partner Referrals v2

export interface PartnerReferralRequest {
  tracking_id: string;
  operations: Array<{
    operation: "API_INTEGRATION";
    api_integration_preference: {
      rest_api_integration: {
        integration_method: "PAYPAL";
        integration_type: "THIRD_PARTY";
        third_party_details: { features: Array<"PAYMENT" | "REFUND"> };
      };
    };
  }>;
  products: Array<"EXPRESS_CHECKOUT">;
  legal_consents: Array<{ type: "SHARE_DATA_CONSENT"; granted: boolean }>;
  partner_config_override: { return_url: string; partner_logo_url?: string };
}

export interface PartnerReferralResponse {
  links?: PayPalLink[];
}

export interface MerchantIntegrationResponse {
  merchant_id?: string;
  tracking_id?: string;
  payments_receivable?: boolean;
  primary_email_confirmed?: boolean;
  primary_email?: string;
  legal_name?: string;
  primary_currency?: string;
  country?: string;
  products?: Array<{ name: string; status?: string; vetting_status?: string; capabilities?: string[] }>;
  capabilities?: Array<{ name: string; status?: string }>;
  oauth_integrations?: Array<{
    integration_type?: string;
    integration_method?: string;
    oauth_third_party?: Array<{
      partner_client_id?: string;
      merchant_client_id?: string;
      scopes?: string[];
    }>;
  }>;
  links?: PayPalLink[];
}

// ---------------------------------------------------------------- Webhooks v1

export interface CreateWebhookRequest {
  url: string;
  event_types: Array<{ name: string }>;
}

export interface WebhookResponse {
  id: string;
  url: string;
  event_types: Array<{ name: string; description?: string; status?: string }>;
  links?: PayPalLink[];
}

export interface VerifyWebhookSignatureResponse {
  verification_status: "SUCCESS" | "FAILURE";
}
