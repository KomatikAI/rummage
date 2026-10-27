/**
 * Turns the shopping assistant's tool parts (AI SDK UI message parts named
 * `tool-search_items`, `tool-hold_item`, `tool-release_hold`, `tool-get_cart`) into one
 * plain line each. Outputs are read defensively: they arrive as JSON from the stream.
 */

export type ToolSummary = {
  text: string;
  tone: "info" | "success" | "warning";
  /** Show a link to the cart under the line. */
  cartLink: boolean;
  /** Found items, for search results. */
  items?: { id: string; title: string; price: number; status: string; householdName: string }[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const PENDING: Record<string, string> = {
  search_items: "Looking through the tables",
  hold_item: "Holding that for you",
  release_hold: "Taking that out of your cart",
  get_cart: "Checking your cart",
};

const HOLD_REFUSALS: Record<string, string> = {
  not_found: "That item is no longer listed.",
  already_held: "Someone else is holding that one right now.",
  sold: "That one has already sold.",
  not_allowed: "That item could not be held for this cart.",
};

function items(value: unknown): NonNullable<ToolSummary["items"]> {
  if (!Array.isArray(value)) return [];
  const out: NonNullable<ToolSummary["items"]> = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.id !== "string" || typeof item.title !== "string") continue;
    out.push({
      id: item.id,
      title: item.title,
      price: typeof item.price === "number" ? item.price : 0,
      status: typeof item.status === "string" ? item.status : "available",
      householdName: typeof item.householdName === "string" ? item.householdName : "",
    });
  }
  return out;
}

/**
 * One line for a tool part. `toolName` is the part type without the `tool-` prefix;
 * `state` is the part's state.
 */
export function summariseToolPart(toolName: string, state: string, output: unknown): ToolSummary {
  if (state === "output-error") {
    return { text: "That step did not work. Ask again in a moment.", tone: "warning", cartLink: false };
  }
  if (state !== "output-available") {
    return { text: `${PENDING[toolName] ?? "Working on it"}…`, tone: "info", cartLink: false };
  }

  switch (toolName) {
    case "search_items": {
      const found = isRecord(output) ? items(output.items) : [];
      const text =
        found.length === 0 ? "No matches on the tables." : found.length === 1 ? "Found 1 item." : `Found ${found.length} items.`;
      return { text, tone: "info", cartLink: false, items: found };
    }
    case "hold_item": {
      if (isRecord(output) && output.ok === true) {
        return { text: "Held for 15 minutes. Pay from your cart to keep it.", tone: "success", cartLink: true };
      }
      const reason = isRecord(output) && typeof output.reason === "string" ? output.reason : "";
      return { text: HOLD_REFUSALS[reason] ?? "That item could not be held.", tone: "warning", cartLink: false };
    }
    case "release_hold": {
      if (isRecord(output) && output.ok === true) {
        return { text: "Taken out of your cart.", tone: "info", cartLink: true };
      }
      return { text: "That item was not in your cart.", tone: "warning", cartLink: false };
    }
    case "get_cart": {
      const lines = isRecord(output) && Array.isArray(output.lines) ? output.lines.length : 0;
      const text = lines === 0 ? "Your cart is empty." : lines === 1 ? "1 item in your cart." : `${lines} items in your cart.`;
      return { text, tone: "info", cartLink: lines > 0 };
    }
    default:
      return { text: "Done.", tone: "info", cartLink: false };
  }
}

/** The tool name of a part type such as `tool-hold_item`, or null for other parts. */
export function toolNameOf(partType: string): string | null {
  return partType.startsWith("tool-") ? partType.slice("tool-".length) : null;
}

/** A plain sentence for a failed request to /api/assistant/shop. */
export function assistantErrorMessage(message: string | undefined): string {
  const text = message ?? "";
  if (text.includes("sign_in_required")) return "Sign in to shop with the helper.";
  if (text.includes("cart_in_checkout")) return "Your cart is at checkout. Finish paying, then come back to shop more.";
  if (text.includes("sale_not_open")) return "This sale is closed, so the helper cannot hold items.";
  if (text.includes("sale_not_found")) return "This sale is no longer listed.";
  return "The helper could not answer just now. Try again in a moment.";
}
