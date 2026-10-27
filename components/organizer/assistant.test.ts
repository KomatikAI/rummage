import { describe, expect, it } from "vitest";

import {
  assistantErrorMessage,
  HISTORY_LIMIT,
  paypalDataRows,
  toAssistantMessage,
  toolCaption,
  toolCaptions,
  toRequestBody,
  type ChatMessage,
} from "./assistant";

const SALE = "a0000000-0000-4000-8000-000000000001";

describe("toRequestBody", () => {
  it("sends role and content for recent messages only", () => {
    const messages: ChatMessage[] = Array.from({ length: HISTORY_LIMIT + 5 }, (_, index) => ({
      id: String(index),
      role: index % 2 === 0 ? "user" : "assistant",
      text: `m${index}`,
      toolCaptions: ["x"],
    }));
    const body = toRequestBody(SALE, messages);
    expect(body.saleId).toBe(SALE);
    expect(body.messages).toHaveLength(HISTORY_LIMIT);
    expect(body.messages[0]).toEqual({ role: "assistant", content: "m5" });
    expect(body.messages.at(-1)).toEqual({ role: "user", content: `m${HISTORY_LIMIT + 4}` });
  });
});

describe("tool captions", () => {
  it("names known tools in plain words", () => {
    expect(toolCaption("sale_summary")).toBe("Checked the sale summary");
    expect(toolCaption("list_transactions")).toBe("Read PayPal sandbox transactions");
    expect(toolCaption("new_tool")).toBe("Used new tool");
  });

  it("dedupes repeated tools", () => {
    expect(
      toolCaptions([
        { step: 0, toolName: "sale_summary" },
        { step: 1, toolName: "fundraiser_total" },
        { step: 1, toolName: "sale_summary" },
      ]),
    ).toEqual(["Checked the sale summary", "Checked the fundraiser total"]);
  });
});

describe("toAssistantMessage", () => {
  it("parses the route's answer", () => {
    const message = toAssistantMessage("a1", {
      text: "Six households joined.",
      toolCalls: [{ step: 0, toolName: "household_statuses" }],
      paypalData: false,
    });
    expect(message).toEqual({
      id: "a1",
      role: "assistant",
      text: "Six households joined.",
      toolCaptions: ["Looked at each household"],
      toolNames: ["household_statuses"],
      paypalData: false,
    });
  });

  it("fills in an empty answer and rejects the wrong shape", () => {
    expect(toAssistantMessage("a2", { text: "  ", toolCalls: [], paypalData: true })?.text).toContain("could not find");
    expect(toAssistantMessage("a3", { text: "hi" })).toBeNull();
    expect(toAssistantMessage("a4", null)).toBeNull();
  });
});

describe("paypalDataRows", () => {
  it("counts PayPal lookups and says whether data was available", () => {
    expect(paypalDataRows({ paypalData: true, toolNames: ["list_transactions", "sale_summary", "get_order"] })).toEqual([
      { label: "PayPal sandbox data", value: "Available" },
      { label: "PayPal lookups in this answer", value: "2" },
      { label: "Access", value: "Read only" },
    ]);
    expect(paypalDataRows({ paypalData: false })[0].value).toBe("Not set up");
  });
});

describe("assistantErrorMessage", () => {
  it("explains known errors and falls back for the rest", () => {
    expect(assistantErrorMessage("organizer_only")).toBe("Only this sale's organizer can ask about it here.");
    expect(assistantErrorMessage("assistant_failed")).toContain("Try again");
    expect(assistantErrorMessage(undefined)).toContain("Try again");
  });
});
