import { describe, expect, it } from "vitest";

import { saleDateTime, SupabaseSaleReadRepo, toSummaryStatus } from "./sale-read-repo";
import { FakeSupabase, ORGANIZER_ID, SALE_ID, summaryJson, type FakeRow } from "./test-utils";

const saleRow = {
  id: SALE_ID,
  organizer_user_id: ORGANIZER_ID,
  name: "Forest Park PTA sale",
  status: "open",
  sale_date: "2026-11-07",
  starts_at: "08:00:00",
  ends_at: "13:00:00",
};

function setup(summary: FakeRow | null = summaryJson(), households: FakeRow[] = []) {
  const fake = new FakeSupabase({
    userId: ORGANIZER_ID,
    tables: { sales: [saleRow], households },
  });
  fake.rpcHandlers.organizer_sale_summary = () => ({ data: summary, error: null });
  return { fake, repo: new SupabaseSaleReadRepo(fake.client) };
}

describe("helpers", () => {
  it("maps sale statuses", () => {
    expect(toSummaryStatus("draft")).toBe("draft");
    expect(toSummaryStatus("open")).toBe("live");
    expect(toSummaryStatus("closed")).toBe("ended");
  });

  it("joins date and time", () => {
    expect(saleDateTime("2026-11-07", "08:00:00")).toBe("2026-11-07T08:00:00");
    expect(saleDateTime("2026-11-07", null)).toBe("2026-11-07");
    expect(saleDateTime(null, "08:00:00")).toBeNull();
  });
});

describe("SupabaseSaleReadRepo.saleSummary", () => {
  it("combines organizer_sale_summary with the sale row", async () => {
    const { fake, repo } = setup();
    await expect(repo.saleSummary(SALE_ID)).resolves.toEqual({
      saleId: SALE_ID,
      name: "Forest Park PTA sale",
      status: "live",
      startsAt: "2026-11-07T08:00:00",
      endsAt: "2026-11-07T13:00:00",
      householdCount: 2,
      itemCount: 10,
      itemsAvailable: 5,
      itemsHeld: 1,
      itemsSold: 4,
      grossSales: 46.5,
    });
    expect(fake.calls).toContainEqual(
      expect.objectContaining({ kind: "rpc", table: "organizer_sale_summary", args: { p_sale: SALE_ID } }),
    );
    expect(fake.calls.some((c) => c.kind === "insert")).toBe(false);
  });

  it("reads the summary once per repo across all three tools", async () => {
    const { fake, repo } = setup();
    await repo.saleSummary(SALE_ID);
    await repo.householdStatuses(SALE_ID);
    await repo.fundraiserTotal(SALE_ID);
    expect(fake.calls.filter((c) => c.kind === "rpc")).toHaveLength(1);
  });

  it("throws not_organizer when the function refuses (42501), and retries later", async () => {
    const { fake, repo } = setup();
    fake.failNext("organizer_sale_summary", "rpc", {
      code: "42501",
      message: "only the organizer can read this sale summary",
    });
    await expect(repo.saleSummary(SALE_ID)).rejects.toMatchObject({ code: "not_organizer" });
    await expect(repo.saleSummary(SALE_ID)).resolves.toMatchObject({ saleId: SALE_ID });
  });

  it("throws invalid_summary on an unexpected shape", async () => {
    const { repo } = setup({ sale_id: SALE_ID });
    await expect(repo.saleSummary(SALE_ID)).rejects.toMatchObject({ code: "invalid_summary" });
  });

  it("throws sale_not_found when the sale row is not visible", async () => {
    const { fake, repo } = setup();
    fake.tables.sales = [];
    await expect(repo.saleSummary(SALE_ID)).rejects.toMatchObject({ code: "sale_not_found" });
  });
});

describe("SupabaseSaleReadRepo.householdStatuses", () => {
  it("maps per-household totals and onboarding state", async () => {
    const { fake, repo } = setup(summaryJson(), [
      { id: "b0000000-0000-4000-8000-000000000001", sale_id: SALE_ID, owner_user_id: "u1" },
      { id: "b0000000-0000-4000-8000-000000000002", sale_id: SALE_ID, owner_user_id: null },
    ]);
    await expect(repo.householdStatuses(SALE_ID)).resolves.toEqual([
      {
        householdId: "b0000000-0000-4000-8000-000000000001",
        name: "Oak corner",
        onboarding: "ready",
        paypalConnected: true,
        itemCount: 7,
        itemsSold: 3,
        sales: 42.5,
      },
      {
        householdId: "b0000000-0000-4000-8000-000000000002",
        name: "The Lindqvist stall",
        onboarding: "invited",
        paypalConnected: false,
        itemCount: 3,
        itemsSold: 1,
        sales: 4,
      },
    ]);
    expect(fake.callsTo("households")[0].filters).toContain(`eq:sale_id:"${SALE_ID}"`);
  });

  it("marks a joined household without PayPal as in_progress", async () => {
    const { repo } = setup(summaryJson(), [
      { id: "b0000000-0000-4000-8000-000000000002", sale_id: SALE_ID, owner_user_id: "u2" },
    ]);
    const statuses = await repo.householdStatuses(SALE_ID);
    expect(statuses[1].onboarding).toBe("in_progress");
  });
});

describe("SupabaseSaleReadRepo.fundraiserTotal", () => {
  it("reports the donation total with no goal when the organizer set none", async () => {
    const { repo } = setup();
    await expect(repo.fundraiserTotal(SALE_ID)).resolves.toEqual({
      saleId: SALE_ID,
      currency: "USD",
      raised: 10,
      goal: null,
      paidOrderCount: 0,
    });
  });

  it("reads the goal and the paid order count from organizer_sale_summary", async () => {
    const { repo } = setup(summaryJson({ paid_order_count: 7, fundraiser_goal: "500.00" }));
    await expect(repo.fundraiserTotal(SALE_ID)).resolves.toMatchObject({
      goal: 500,
      paidOrderCount: 7,
    });
  });

  it("rejects a summary without paid_order_count (migration 20261028090000 not applied)", async () => {
    const summary = summaryJson();
    delete summary.paid_order_count;
    const { repo } = setup(summary);
    await expect(repo.fundraiserTotal(SALE_ID)).rejects.toMatchObject({ code: "invalid_summary" });
  });
});
