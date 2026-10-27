import { PayPalAgentToolkit } from "@paypal/agent-toolkit/ai-sdk";
import { asSchema, generateText } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import { z as z3 } from "zod/v3";
import {
  makePayPalOrganizerTools,
  ORGANIZER_PAYPAL_TOOL_NAMES,
  toInputSchema,
  wrapToolkitTools,
  type LegacyToolkitTools,
} from "./paypal-toolkit-adapter";
import { execOptions, textResult, toolCallResult } from "./test-utils";

/**
 * A fake toolkit tool in the ai@4 shape the toolkit emits:
 * `{ description, parameters: <zod 3 schema>, execute(args, options) }`.
 */
function fakeLegacyTool() {
  const execute = vi.fn(async (args: { order_id: string }) =>
    JSON.stringify({ id: args.order_id, status: "COMPLETED" }),
  );
  return {
    execute,
    tool: {
      description: "Get an order",
      parameters: z3.object({ order_id: z3.string().min(1) }),
      execute,
    },
  };
}

const FAKE_CREDENTIALS = { clientId: "test-client-id", clientSecret: "test-client-secret" };

describe("type boundary", () => {
  it("accepts the declared type of PayPalAgentToolkit.getTools() without a cast", () => {
    const toolkit = new PayPalAgentToolkit({
      ...FAKE_CREDENTIALS,
      configuration: { actions: { orders: { get: true } }, context: { sandbox: true } },
    });
    // Compile-time check: if the toolkit's ai@4 `Tool` stopped matching
    // `LegacyToolkitTools`, `tsc --noEmit` fails on this line.
    const accepted: LegacyToolkitTools = toolkit.getTools();
    expect(Object.keys(wrapToolkitTools(accepted))).toEqual(["get_order"]);
  });
});

describe("wrapToolkitTools", () => {
  it("converts zod 3 parameters into an ai@7 input schema", async () => {
    const legacy = fakeLegacyTool();
    const wrapped = wrapToolkitTools({ get_order: legacy.tool });
    const schema = asSchema(wrapped.get_order.inputSchema);
    const json = (await schema.jsonSchema) as {
      type: string;
      properties: Record<string, unknown>;
      required: string[];
    };
    expect(json.type).toBe("object");
    expect(Object.keys(json.properties)).toEqual(["order_id"]);
    expect(json.required).toEqual(["order_id"]);
    expect(wrapped.get_order.description).toBe("Get an order");
    await expect(Promise.resolve(schema.validate!({ order_id: "" }))).resolves.toMatchObject({ success: false });
    await expect(Promise.resolve(schema.validate!({ order_id: "O-1" }))).resolves.toMatchObject({ success: true });
  });

  it("delegates execute to the legacy tool with ai@4 options", async () => {
    const legacy = fakeLegacyTool();
    const wrapped = wrapToolkitTools({ get_order: legacy.tool });
    const out = await wrapped.get_order.execute!({ order_id: "O-1" }, execOptions);
    expect(out).toBe(JSON.stringify({ id: "O-1", status: "COMPLETED" }));
    expect(legacy.execute).toHaveBeenCalledWith(
      { order_id: "O-1" },
      { toolCallId: "test-call", messages: [], abortSignal: undefined },
    );
  });

  it("runs inside generateText with a mock model", async () => {
    const legacy = fakeLegacyTool();
    const model = new MockLanguageModelV4({
      doGenerate: [toolCallResult("get_order", { order_id: "O-9" }), textResult("Completed.")],
    });
    const result = await generateText({
      model,
      prompt: "Status of order O-9?",
      tools: wrapToolkitTools({ get_order: legacy.tool }),
      stopWhen: () => false,
    });
    expect(result.text).toBe("Completed.");
    expect(legacy.execute).toHaveBeenCalledTimes(1);
    const sent = model.doGenerateCalls[0].tools?.[0];
    expect(sent && "inputSchema" in sent ? sent.inputSchema : null).toMatchObject({
      type: "object",
      required: ["order_id"],
    });
  });

  it("accepts ai@4 jsonSchema() parameters", async () => {
    const schema = toInputSchema({
      jsonSchema: { type: "object", properties: { q: { type: "string" } } },
      validate: (value: unknown) => ({ success: true as const, value }),
    });
    await expect(Promise.resolve(asSchema(schema).validate!({ q: "x" }))).resolves.toEqual({
      success: true,
      value: { q: "x" },
    });
  });

  it("rejects unknown parameter shapes and tools without execute", () => {
    expect(() => toInputSchema({ foo: 1 })).toThrow(TypeError);
    expect(() =>
      wrapToolkitTools({ x: { description: "no exec", parameters: z3.object({}) } }),
    ).toThrow(/no execute/);
  });
});

describe("makePayPalOrganizerTools", () => {
  it("builds exactly the read-only set without any network call", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const tools = makePayPalOrganizerTools(FAKE_CREDENTIALS);
    expect(Object.keys(tools).sort()).toEqual([...ORGANIZER_PAYPAL_TOOL_NAMES].sort());
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("forces the sandbox environment", () => {
    const spy = vi.spyOn(PayPalAgentToolkit.prototype, "getTools");
    makePayPalOrganizerTools(FAKE_CREDENTIALS);
    const toolkit = spy.mock.contexts[0] as PayPalAgentToolkit;
    expect(toolkit.client.getBaseUrl()).toBe("https://api.sandbox.paypal.com");
    spy.mockRestore();
  });
});
