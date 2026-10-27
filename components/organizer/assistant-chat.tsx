"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";

import { Button, Card, cn, Spinner, Textarea } from "@/components/ui";

import {
  assistantErrorMessage,
  paypalDataRows,
  QUESTION_MAX_LENGTH,
  STARTER_QUESTIONS,
  toAssistantMessage,
  toRequestBody,
  type ChatMessage,
} from "./assistant";

let nextId = 0;
function newId(prefix: string): string {
  nextId += 1;
  return `${prefix}-${nextId}`;
}

function PayPalDataCard({ message }: { message: ChatMessage }) {
  const rows = paypalDataRows(message);
  return (
    <Card tone="sunken" padding="sm" className="w-full max-w-sm">
      <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
        {rows.map((row) => (
          <div key={row.label} className="contents">
            <dt className="text-ink-soft">{row.label}</dt>
            <dd className="text-right font-semibold text-ink">{row.value}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

function MessageView({ message }: { message: ChatMessage }) {
  const mine = message.role === "user";
  return (
    <li className={cn("flex flex-col gap-1.5", mine ? "items-end" : "items-start")}>
      <span className="sr-only">{mine ? "You said" : "The assistant said"}</span>
      <div
        className={cn(
          "max-w-prose whitespace-pre-wrap rounded-sticker px-4 py-3 text-base",
          mine ? "bg-accent-soft text-ink" : "border border-line bg-surface text-ink shadow-sticker",
        )}
      >
        {message.text}
      </div>
      {message.toolCaptions && message.toolCaptions.length > 0 ? (
        <ul className="flex flex-col gap-0.5 text-xs text-ink-faint">
          {message.toolCaptions.map((caption) => (
            <li key={caption}>{caption}</li>
          ))}
        </ul>
      ) : null}
      {!mine && message.paypalData !== undefined ? <PayPalDataCard message={message} /> : null}
    </li>
  );
}

/**
 * The organizer assistant: one question at a time to POST /api/assistant/organizer,
 * which answers with plain text and the tools it used. The composer stays pinned above
 * the tab bar on phones.
 */
export function AssistantChat({ saleId }: { saleId: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, pending]);

  async function ask(question: string) {
    const text = question.trim();
    if (!text || pending) return;
    if (text.length > QUESTION_MAX_LENGTH) {
      setError(assistantErrorMessage("question_too_long"));
      return;
    }
    const history = [...messages, { id: newId("user"), role: "user" as const, text }];
    setMessages(history);
    setDraft("");
    setError(null);
    setPending(true);
    try {
      const response = await fetch("/api/assistant/organizer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(toRequestBody(saleId, history)),
      });
      const json: unknown = await response.json().catch(() => null);
      const answer = response.ok ? toAssistantMessage(newId("assistant"), json) : null;
      if (answer) {
        setMessages((current) => [...current, answer]);
      } else {
        const code =
          typeof json === "object" && json !== null && typeof (json as Record<string, unknown>).error === "string"
            ? ((json as Record<string, unknown>).error as string)
            : undefined;
        setError(assistantErrorMessage(code));
      }
    } catch {
      setError(assistantErrorMessage(undefined));
    }
    setPending(false);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void ask(draft);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void ask(draft);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {messages.length === 0 ? (
        <Card tone="sunken" className="flex flex-col gap-3">
          <p className="text-sm text-ink-soft">
            Ask about this sale in plain words. The assistant can read the summary, each household and the fundraiser
            total. It cannot change anything.
          </p>
          <div className="flex flex-wrap gap-2">
            {STARTER_QUESTIONS.map((question) => (
              <Button key={question} variant="secondary" size="sm" onClick={() => void ask(question)}>
                {question}
              </Button>
            ))}
          </div>
        </Card>
      ) : null}

      <ol aria-label="Conversation" aria-live="polite" className="flex flex-col gap-4">
        {messages.map((message) => (
          <MessageView key={message.id} message={message} />
        ))}
      </ol>
      {pending ? (
        <p className="flex items-center gap-2 text-sm text-ink-soft">
          <Spinner size="sm" label={null} />
          Looking into it
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      ) : null}
      <div ref={endRef} />

      <form
        onSubmit={submit}
        className="sticky bottom-tabbar z-10 -mx-gutter flex items-end gap-2 border-t border-line bg-paper px-gutter py-3 md:bottom-0"
      >
        <label htmlFor="assistant-question" className="sr-only">
          Your question
        </label>
        <Textarea
          id="assistant-question"
          rows={1}
          value={draft}
          maxLength={QUESTION_MAX_LENGTH}
          placeholder="Ask about this sale"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          className="min-h-tap flex-1 resize-none"
        />
        <Button type="submit" loading={pending} disabled={draft.trim() === ""}>
          Ask
        </Button>
      </form>
    </div>
  );
}
