import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FakeSupabase, ORGANIZER_ID, SALE_ID, type FakeRow } from "@/lib/repos/test-utils";

vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/ai/organizer-tools", () => ({ runOrganizerAssistant: vi.fn() }));
vi.mock("@/lib/ai/paypal-toolkit-adapter", () => ({ makePayPalOrganizerTools: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: vi.fn() }));

import { runOrganizerAssistant } from "@/lib/ai/organizer-tools";
import { makePayPalOrganizerTools } from "@/lib/ai/paypal-toolkit-adapter";
import { RepoError, SupabaseSaleReadRepo } from "@/lib/repos";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { POST } from "./route";

const sale = { id: SALE_ID, organizer_user_id: ORGANIZER_ID };
const messages = [
  { id: "m1", role: "user", parts: [{ type: "text", text: "How much have we raised?" }] },
  { id: "m2", role: "assistant", parts: [{ type: "text", text: "$10." }] },
  { id: "m3", role: "user", parts: [{ type: "text", text: "Which households have not linked PayPal?" }] },
];

function useFake(tables: Record<string, FakeRow[]>, userId: string | null = ORGANIZER_ID) {
  const fake = new FakeSupabase({ userId, tables });
  vi.mocked(createSupabaseServerClient).mockResolvedValue(fake.client);
  vi.mocked(createSupabaseAdminClient).mockReturnValue(fake.client);
  return fake;
}

function post(body: unknown) {
  return POST(
    new Request("http://localhost/api/assistant/organizer", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

type OrganizerAnswer = Awaited<ReturnType<typeof runOrganizerAssistant>>;

beforeEach(() => {
  vi.mocked(runOrganizerAssistant).mockReset();
  vi.mocked(runOrganizerAssistant).mockResolvedValue({
    text: "Two households.",
    toolCalls: [{ step: 1, toolName: "household_statuses", input: {} }],
  } as unknown as OrganizerAnswer);
  vi.mocked(makePayPalOrganizerTools).mockReset();
  vi.stubEnv("PAYPAL_CLIENT_ID", "");
  vi.stubEnv("PAYPAL_CLIENT_SECRET", "");
  useFake({ sales: [sale] });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/assistant/organizer", () => {
  it("401s when signed out", async () => {
    useFake({ sales: [sale] }, null);
    expect((await post({ saleId: SALE_ID, messages })).status).toBe(401);
  });

  it("400s on bad input or no user question", async () => {
    expect((await post("{")).status).toBe(400);
    expect((await post({ saleId: "x", messages })).status).toBe(400);
    const noQuestion = await post({
      saleId: SALE_ID,
      messages: [{ role: "assistant", content: "Hi" }],
    });
    expect(noQuestion.status).toBe(400);
    await expect(noQuestion.json()).resolves.toEqual({ error: "question_required" });
    const tooLong = await post({ saleId: SALE_ID, messages: [{ role: "user", content: "x".repeat(2001) }] });
    expect(tooLong.status).toBe(400);
  });

  it("403s a caller who is not the sale's organizer, or cannot see the sale", async () => {
    useFake({ sales: [sale] }, "someone-else");
    expect((await post({ saleId: SALE_ID, messages })).status).toBe(403);
    useFake({ sales: [] });
    expect((await post({ saleId: SALE_ID, messages })).status).toBe(403);
    expect(runOrganizerAssistant).not.toHaveBeenCalled();
  });

  it("answers the latest user message from sale records only when PayPal is not configured", async () => {
    const res = await post({ saleId: SALE_ID, messages });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      text: "Two households.",
      toolCalls: [{ step: 1, toolName: "household_statuses" }],
      paypalData: false,
    });
    const input = vi.mocked(runOrganizerAssistant).mock.calls[0][0];
    expect(input.question).toBe("Which households have not linked PayPal?");
    expect(input.saleId).toBe(SALE_ID);
    expect(input.repo).toBeInstanceOf(SupabaseSaleReadRepo);
    expect(input.paypalTools).toBeUndefined();
    expect(makePayPalOrganizerTools).not.toHaveBeenCalled();
  });

  it("accepts { role, content } messages", async () => {
    await post({ saleId: SALE_ID, messages: [{ role: "user", content: " Totals? " }] });
    expect(vi.mocked(runOrganizerAssistant).mock.calls[0][0].question).toBe("Totals?");
  });

  it("attaches the PayPal tools scoped to this sale's ids when both credentials are set", async () => {
    vi.stubEnv("PAYPAL_CLIENT_ID", "sb-client");
    vi.stubEnv("PAYPAL_CLIENT_SECRET", "sb-secret");
    useFake({
      sales: [sale],
      carts: [
        { id: "cart-1", sale_id: SALE_ID, paypal_order_id: "ORDER-1" },
        { id: "cart-9", sale_id: "other-sale", paypal_order_id: "ORDER-9" },
      ],
      purchase_units: [
        { id: "pu-1", cart_id: "cart-1", refund_id: "REF-1" },
        { id: "pu-9", cart_id: "cart-9", refund_id: "REF-9" },
      ],
    });
    const getOrder = vi.fn(async (input: { id: string }) => ({ id: input.id }));
    const tools = {
      list_transactions: { execute: vi.fn() },
      get_order: { execute: getOrder },
      get_refund: { execute: vi.fn(async () => ({})) },
    };
    vi.mocked(makePayPalOrganizerTools).mockReturnValue(
      tools as unknown as ReturnType<typeof makePayPalOrganizerTools>,
    );
    const res = await post({ saleId: SALE_ID, messages });
    await expect(res.json()).resolves.toMatchObject({ paypalData: true });
    expect(makePayPalOrganizerTools).toHaveBeenCalledWith({
      clientId: "sb-client",
      clientSecret: "sb-secret",
    });
    const scoped = vi.mocked(runOrganizerAssistant).mock.calls[0][0].paypalTools ?? {};
    expect(Object.keys(scoped).sort()).toEqual(["get_order", "get_refund"]);
    const callOptions = { toolCallId: "c1", messages: [] } as never;
    await expect(scoped.get_order.execute!({ id: "ORDER-1" }, callOptions)).resolves.toEqual({ id: "ORDER-1" });
    await expect(scoped.get_order.execute!({ id: "ORDER-9" }, callOptions)).resolves.toMatchObject({
      error: "not_this_sale",
    });
    expect(getOrder).toHaveBeenCalledTimes(1);
  });

  it("skips PayPal tools when only one credential is set", async () => {
    vi.stubEnv("PAYPAL_CLIENT_ID", "sb-client");
    await post({ saleId: SALE_ID, messages });
    expect(makePayPalOrganizerTools).not.toHaveBeenCalled();
  });

  it("maps a not_organizer repo error to 403 and other failures to 500", async () => {
    vi.mocked(runOrganizerAssistant).mockRejectedValueOnce(
      new RepoError("not_organizer", "saleSummary", "only the organizer"),
    );
    expect((await post({ saleId: SALE_ID, messages })).status).toBe(403);
    vi.mocked(runOrganizerAssistant).mockRejectedValueOnce(new Error("model down"));
    const res = await post({ saleId: SALE_ID, messages });
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: "assistant_failed" });
  });
});
