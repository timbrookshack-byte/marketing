"use client";

import { useRef, useState } from "react";

interface Turn {
  role: "user" | "assistant";
  content: string;
}

export function AnalystChat({
  aiConfigured,
  hasData,
  suggestions,
}: {
  aiConfigured: boolean;
  hasData: boolean;
  suggestions: string[];
}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  if (!aiConfigured) {
    return (
      <p className="text-[13px] text-[var(--text-secondary)]">
        Set <code className="rounded bg-[var(--surface-sunken)] px-1">ANTHROPIC_API_KEY</code> to ask
        questions here. The dashboards, the rule findings and the budget optimiser all work without
        it.
      </p>
    );
  }

  if (!hasData) {
    return (
      <p className="text-[13px] text-[var(--text-secondary)]">
        There is no data to ask about yet. Connect an account and run a sync first.
      </p>
    );
  }

  const send = async (question: string) => {
    if (!question.trim() || busy) return;
    const history = turns;
    setTurns([...history, { role: "user", content: question }]);
    setInput("");
    setBusy(true);
    setError(null);

    try {
      const response = await fetch("/api/ai/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question, history }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? `Failed (${response.status})`);
      setTurns((current) => [...current, { role: "assistant", content: body.answer as string }]);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
      requestAnimationFrame(() => endRef.current?.scrollIntoView({ behavior: "smooth" }));
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {turns.length === 0 ? (
        <div className="flex flex-wrap gap-2">
          {suggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => send(suggestion)}
              className="rounded-full border px-3 py-1.5 text-left text-[12px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-sunken)] hover:text-[var(--text-primary)] hairline"
            >
              {suggestion}
            </button>
          ))}
        </div>
      ) : null}

      <div className="flex flex-col gap-4">
        {turns.map((turn, index) => (
          <div
            key={index}
            className={turn.role === "user" ? "flex justify-end" : "flex justify-start"}
          >
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-[13px] leading-relaxed whitespace-pre-wrap ${
                turn.role === "user" ? "text-white" : "border hairline"
              }`}
              style={
                turn.role === "user"
                  ? { background: "var(--series-1)" }
                  : { background: "var(--surface-sunken)" }
              }
            >
              {turn.content}
            </div>
          </div>
        ))}
        {busy ? (
          <div className="text-[13px] text-[var(--text-muted)]">Reading the account…</div>
        ) : null}
        <div ref={endRef} />
      </div>

      {error ? (
        <p className="text-[13px]" style={{ color: "var(--status-critical)" }}>
          {error}
        </p>
      ) : null}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void send(input);
        }}
        className="flex gap-2"
      >
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Ask about a campaign, a channel, or where to put the next dollar…"
          className="flex-1 rounded-lg border bg-transparent px-3 py-2 text-[13px] outline-none transition-colors focus:border-[var(--series-1)] hairline"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="rounded-lg px-4 py-2 text-[13px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          style={{ background: "var(--series-1)" }}
        >
          Ask
        </button>
      </form>
    </div>
  );
}
