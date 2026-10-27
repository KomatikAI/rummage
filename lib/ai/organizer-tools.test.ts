import { asSchema, tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  makeOrganizerTools,
  organizerSystemPrompt,
  ORGANIZER_MAX_STEPS,
  ORGANIZER_TOOL_NAMES,
  runOrganizerAssistant,
  type SaleReadRepo,
} from "./organizer-tools";
import { execOptions, textResult, toolCallResult } from "./test-utils";

const MUTATING =
  /(^|_)(create|update|delete|cancel|send|capture|pay|refund|accept|record|hold|release|set|write)(_|$)/i;

function fakeRepo() {
  return {
    saleSummary: vi.fn(async (saleId: string) => ({
      saleId,
      name: "Maple Street Yard Sale",
      status: "live" as const,
      startsAt: "2026-10-31T13:00:00Z",
      endsAt: "2026-10-31T20:00:00Z",
      householdCount: 12,
      itemCount: 240,
      itemsAvailable: 180,
      itemsHeld: 10,
      itemsSold: 50,
      grossSales: 612.5,
    })),
    householdStatuses: vi.fn(async () => [
      {
        householdId: "h1",
        name: "The Parks",
        onboarding: "ready" as const,
        paypalConnected: true,
        itemCount: 20,
        itemsSold: 4,
        sales: 55,
      },
    ]),
    fundraiserTotal: vi.fn(async (saleId: string) => ({
      saleId,
      currency: "USD" as const,
      raised: 120,
      goal: 500,
      paidOrderCount: 31,
    })),
  } satisfies SaleReadRepo;
}

function fakePayPalTool(name: string) {
  const execute = vi.fn(async () => JSON.stringify({ transaction_details: [], name }));
  return {
    execute,
    tool: tool({
      description: `fake ${name}`,
      inputSchema: z.object({}),
      execute,
    }),
  };
}

describe("organizer tools", () => {
  it("exposes only the three read tools", () => {
    const tools = makeOrganizerTools(fakeRepo(), { saleId: "sale-1" });
    expect(Object.keys(tools).sort()).toEqual([...ORGANIZER_TOOL_NAMES].sort());
    for (const name of Object.keys(tools)) expect(name).not.toMatch(MUTATING);
  });

  it("each tool reads the bound sale and takes no model input", async () => {
    const repo = fakeRepo();
    const tools = makeOrganizerTools(repo, { saleId: "sale-1" });
    for (const t of Object.values(tools)) {
      const validated = await Promise.resolve(
        asSchema(t.inputSchema).validate!({ saleId: "other-sale" }),
      );
      expect(validated).toEqual({ success: true, value: {} });
    }
    await tools.sale_summary.execute!({}, execOptions);
    await tools.household_statuses.execute!({}, execOptions);
    await tools.fundraiser_total.execute!({}, execOptions);
    expect(repo.saleSummary).toHaveBeenCalledWith("sale-1");
    expect(repo.householdStatuses).toHaveBeenCalledWith("sale-1");
    expect(repo.fundraiserTotal).toHaveBeenCalledWith("sale-1");
  });

  it("the read repo has no write methods", () => {
    const repo: SaleReadRepo = fakeRepo();
    expect(Object.keys(repo).sort()).toEqual(
      ["fundraiserTotal", "householdStatuses", "saleSummary"],
    );
  });
});

describe("runOrganizerAssistant", () => {
  it("answers from sale records", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: [toolCallResult("fundraiser_total", {}), textResult("You have raised $120.")],
    });
    const repo = fakeRepo();
    const reply = await runOrganizerAssistant(
      { question: "How much have we raised?", repo, saleId: "sale-1" },
      { model },
    );
    expect(reply.text).toBe("You have raised $120.");
    expect(reply.toolCalls).toEqual([{ step: 1, toolName: "fundraiser_total", input: {} }]);
    expect(repo.fundraiserTotal).toHaveBeenCalledWith("sale-1");
    const names = (model.doGenerateCalls[0].tools ?? []).map((t) => ("name" in t ? t.name : ""));
    expect(names.sort()).toEqual([...ORGANIZER_TOOL_NAMES].sort());
  });

  it("adds read-only PayPal tools when given", async () => {
    const listTx = fakePayPalTool("list_transactions");
    const model = new MockLanguageModelV4({
      doGenerate: [toolCallResult("list_transactions", {}), textResult("No transactions yet.")],
    });
    const reply = await runOrganizerAssistant(
      {
        question: "Any PayPal transactions?",
        repo: fakeRepo(),
        saleId: "sale-1",
        paypalTools: { list_transactions: listTx.tool },
      },
      { model },
    );
    expect(listTx.execute).toHaveBeenCalledTimes(1);
    expect(reply.text).toBe("No transactions yet.");
    const names = (model.doGenerateCalls[0].tools ?? []).map((t) => ("name" in t ? t.name : ""));
    expect(names).toContain("list_transactions");
    expect(JSON.stringify(model.doGenerateCalls[0].prompt[0])).toContain("PayPal sandbox");
  });

  it("refuses PayPal tools outside the read-only allowlist", async () => {
    const model = new MockLanguageModelV4({ doGenerate: async () => textResult("x") });
    for (const name of ["create_refund", "pay_order", "create_order", "accept_dispute_claim"]) {
      await expect(
        runOrganizerAssistant(
          {
            question: "Refund order 1",
            repo: fakeRepo(),
            saleId: "sale-1",
            paypalTools: { [name]: fakePayPalTool(name).tool },
          },
          { model },
        ),
      ).rejects.toThrow(/read-only/);
    }
    expect(model.doGenerateCalls).toHaveLength(0);
  });

  it("stops after the step limit", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async () => toolCallResult("sale_summary", {}),
    });
    await runOrganizerAssistant(
      { question: "Summarize", repo: fakeRepo(), saleId: "sale-1" },
      { model },
    );
    expect(model.doGenerateCalls).toHaveLength(ORGANIZER_MAX_STEPS);
  });

  it("prompt states read-only and names its sources", () => {
    expect(organizerSystemPrompt(false)).toContain("You can read, not change");
    expect(organizerSystemPrompt(false)).toContain("not available");
    expect(organizerSystemPrompt(true)).toContain("list_transactions");
  });
});
