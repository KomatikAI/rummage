"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import { Badge, Button, cn, Input, Money, Spinner } from "@/components/ui";

import { assistantErrorMessage, summariseToolPart, toolNameOf, type ToolSummary } from "./assistant-parts";
import { signInHref } from "./hold-messages";

export interface AssistantChatProps {
  saleId: string;
  saleSlug: string;
  saleName: string;
}

type Part = UIMessage["parts"][number];

type ToolView = { id: string; summary: ToolSummary };

/** A tool part (static `tool-*` or `dynamic-tool`) as one plain summary, or null. */
function toolView(part: Part): ToolView | null {
  if (part.type === "dynamic-tool") {
    return { id: part.toolCallId, summary: summariseToolPart(part.toolName, part.state, part.output) };
  }
  if (!("toolCallId" in part)) return null;
  const name = toolNameOf(part.type);
  if (!name) return null;
  return { id: part.toolCallId, summary: summariseToolPart(name, part.state, part.output) };
}

const SUGGESTIONS = ["Anything for kids under $20?", "Show me garden tools", "What is in my cart?"];

const toneClasses: Record<ToolSummary["tone"], string> = {
  info: "bg-paper-deep text-ink",
  success: "bg-ready-soft text-ready-strong",
  warning: "bg-held-soft text-held",
};

/** The shopping helper: chat with tools that search, hold and release items in this sale. */
export function AssistantChat({ saleId, saleSlug, saleName }: AssistantChatProps) {
  const transport = useMemo(
    () => new DefaultChatTransport<UIMessage>({ api: "/api/assistant/shop", body: { saleId } }),
    [saleId],
  );
  const { messages, sendMessage, status, error, clearError } = useChat({ transport });
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const busy = status === "submitted" || status === "streaming";

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, status]);

  function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    clearError();
    void sendMessage({ text: trimmed });
    setDraft("");
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    send(draft);
  }

  const errorText = error ? assistantErrorMessage(error.message) : null;
  const needsSignIn = error?.message.includes("sign_in_required") ?? false;

  return (
    <>
      <div className="flex flex-col gap-4 pb-28">
        {messages.length === 0 ? (
          <div className="flex flex-col gap-3 rounded-sticker bg-paper-deep p-4">
            <p className="text-base text-ink">
              Tell me what you are looking for at {saleName}. I can search the tables, hold things for 15 minutes and
              check your cart. You pay from the cart.
            </p>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((suggestion) => (
                <Button key={suggestion} variant="secondary" size="sm" onClick={() => send(suggestion)}>
                  {suggestion}
                </Button>
              ))}
            </div>
          </div>
        ) : null}

        <ol className="flex flex-col gap-3" aria-live="polite">
          {messages.map((message) => (
            <li key={message.id} className={cn("flex flex-col gap-2", message.role === "user" ? "items-end" : "items-start")}>
              {message.parts.map((part, index) => {
                if (part.type === "text") {
                  if (!part.text.trim()) return null;
                  return (
                    <p
                      key={`${message.id}-${index}`}
                      className={cn(
                        "max-w-[85%] rounded-sticker px-4 py-2.5 text-base whitespace-pre-wrap",
                        message.role === "user" ? "bg-ink text-paper" : "border border-line bg-surface text-ink",
                      )}
                    >
                      {part.text}
                    </p>
                  );
                }
                const tool = toolView(part);
                if (!tool) return null;
                return <ToolLine key={tool.id} summary={tool.summary} saleSlug={saleSlug} />;
              })}
            </li>
          ))}
        </ol>

        {status === "submitted" ? (
          <p className="flex items-center gap-2 text-sm text-ink-soft">
            <Spinner size="sm" label={null} />
            Thinking
          </p>
        ) : null}

        {errorText ? (
          <div role="alert" className="flex flex-col gap-2 rounded-sticker bg-danger-soft p-3 text-sm font-semibold text-danger-strong">
            <p>{errorText}</p>
            {needsSignIn ? (
              <Link href={signInHref(`/buyer/assistant?sale=${saleSlug}`)} className="underline underline-offset-2">
                Sign in
              </Link>
            ) : null}
          </div>
        ) : null}
        <div ref={endRef} />
      </div>

      <div className="fixed inset-x-0 bottom-tabbar z-20 border-t border-line bg-surface md:bottom-0">
        <form onSubmit={onSubmit} className="mx-auto flex w-full max-w-content items-center gap-2 px-gutter py-3 md:pb-safe">
          <Input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Ask about the tables"
            aria-label="Message the shopping helper"
            autoComplete="off"
            className="flex-1"
          />
          <Button type="submit" loading={busy} disabled={draft.trim().length === 0}>
            Send
          </Button>
        </form>
      </div>
    </>
  );
}

function ToolLine({ summary, saleSlug }: { summary: ToolSummary; saleSlug: string }) {
  return (
    <div className={cn("flex w-full max-w-[85%] flex-col gap-2 rounded-sticker px-4 py-2.5 text-sm", toneClasses[summary.tone])}>
      <p className="font-semibold">{summary.text}</p>
      {summary.items && summary.items.length > 0 ? (
        <ul className="flex flex-col divide-y divide-line">
          {summary.items.map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-3 py-1.5">
              <span className="flex min-w-0 flex-col">
                <span className="truncate font-semibold text-ink">{item.title}</span>
                {item.householdName ? <span className="truncate text-xs text-ink-soft">{item.householdName}</span> : null}
              </span>
              <span className="flex shrink-0 items-center gap-2">
                {item.status === "held" || item.status === "sold" ? <Badge status={item.status} /> : null}
                <Money amount={item.price} trimWholeDollars className="font-semibold text-ink" />
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {summary.cartLink ? (
        <div className="flex flex-wrap gap-x-4">
          <Link href="/buyer/cart" className="inline-flex min-h-tap items-center font-semibold underline underline-offset-2">
            Open your cart
          </Link>
          <Link href={`/sale/${saleSlug}`} className="inline-flex min-h-tap items-center text-ink-soft underline underline-offset-2">
            Back to the sale
          </Link>
        </div>
      ) : null}
    </div>
  );
}
