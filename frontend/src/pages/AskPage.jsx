import { useEffect, useRef, useState } from "react";
import { askAgent, getAgentStatus, isCancel } from "../services/api";
import Spinner from "../components/common/Spinner";

const EXAMPLES = [
  "How many minutes of guitar did I practise this month?",
  "Which book have I spent the most time reading?",
  "How many LeetCode problems have I solved by difficulty?",
  "What was my busiest week for completed tasks?",
];

function errorText(err) {
  if (err?.response?.data?.detail) return err.response.data.detail;
  if (err?.code === "ECONNABORTED") return "The model took too long to answer.";
  return "Couldn't reach the backend. Is it running?";
}

function Cell({ value }) {
  if (value === null || value === undefined) return <span className="text-surface-muted">-</span>;
  if (typeof value === "boolean") return value ? "yes" : "no";
  return String(value);
}

function ResultTable({ columns, rows, truncated }) {
  if (!columns.length) return null;
  return (
    <div className="mt-3 max-h-64 overflow-auto rounded-md border border-surface-border">
      <table className="w-full text-left text-xs">
        <thead className="sticky top-0 bg-surface">
          <tr>
            {columns.map((c) => (
              <th key={c} className="border-b border-surface-border px-2.5 py-1.5 font-semibold text-ink-soft">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r} className="odd:bg-surface/40">
              {row.map((v, c) => (
                <td key={c} className="whitespace-nowrap px-2.5 py-1 tabular-nums text-ink">
                  <Cell value={v} />
                </td>
              ))}
            </tr>
          ))}
          {!rows.length && (
            <tr>
              <td colSpan={columns.length} className="px-2.5 py-2 text-surface-muted">
                No rows.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {truncated && <p className="px-2.5 py-1.5 text-[11px] text-surface-muted">Showing the first {rows.length} rows.</p>}
    </div>
  );
}

function Corrections({ attempts, answered }) {
  const failed = attempts.filter((a) => a.error);
  if (!failed.length) return null;
  return (
    <details className="mt-3 rounded-md border border-amber-300/70 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
      <summary className="cursor-pointer select-none font-semibold">
        {answered ? "Corrected itself after " : ""}
        {failed.length} failed {failed.length === 1 ? "query" : "queries"}
      </summary>
      <ol className="mt-2 space-y-2">
        {failed.map((a, i) => (
          <li key={i}>
            {a.sql && <pre className="overflow-x-auto whitespace-pre-wrap rounded bg-black/5 p-2 font-mono text-[11px] dark:bg-white/5">{a.sql}</pre>}
            <pre className="mt-1 whitespace-pre-wrap font-mono text-[11px]">{a.error}</pre>
          </li>
        ))}
      </ol>
    </details>
  );
}

function Exchange({ item }) {
  const { question, result, error } = item;
  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <p className="max-w-[80%] rounded-2xl rounded-br-md bg-gradient-to-b from-[#36a2ff] to-[#0a7cff] px-3.5 py-2 text-[13px] text-white shadow-sm">
          {question}
        </p>
      </div>
      <div className="rounded-xl border border-surface-border bg-surface-card p-3.5 shadow-sm">
        {!result && !error && (
          <p className="flex items-center gap-2 text-[13px] text-ink-soft">
            <Spinner className="h-4 w-4" /> Writing a query and running it read-only...
          </p>
        )}
        {error && <p className="text-[13px] text-red-600">{error}</p>}
        {result && (
          <>
            <p className={`text-[13px] leading-relaxed ${result.answered ? "text-ink" : "text-ink-soft"}`}>{result.answer}</p>
            <p className="mt-1.5 text-[11px] text-surface-muted">
              {result.model} · {(result.elapsed_ms / 1000).toFixed(1)} s
              {result.answered && ` · ${result.rows.length} row${result.rows.length === 1 ? "" : "s"}`}
            </p>
            {result.sql && (
              <details className="mt-3 text-xs">
                <summary className="cursor-pointer select-none font-semibold text-ink-soft">SQL</summary>
                <pre className="mt-1.5 overflow-x-auto rounded-md border border-surface-border bg-surface p-2.5 font-mono text-[11px] text-ink">{result.sql}</pre>
              </details>
            )}
            <Corrections attempts={result.attempts} answered={result.answered} />
            {result.answered && <ResultTable columns={result.columns} rows={result.rows} truncated={result.truncated} />}
          </>
        )}
      </div>
    </div>
  );
}

export default function AskPage() {
  const [status, setStatus] = useState(null);
  const [items, setItems] = useState([]);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const scroller = useRef(null);

  useEffect(() => {
    const controller = new AbortController();
    getAgentStatus(controller.signal)
      .then(setStatus)
      .catch((err) => !isCancel(err) && setStatus({ available: false }));
    return () => controller.abort();
  }, []);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [items]);

  const ask = async (text) => {
    const q = text.trim();
    if (q.length < 3 || busy) return;
    const id = Date.now();
    setItems((prev) => [...prev, { id, question: q }]);
    setQuestion("");
    setBusy(true);
    try {
      const result = await askAgent(q);
      setItems((prev) => prev.map((it) => (it.id === id ? { ...it, result } : it)));
    } catch (err) {
      setItems((prev) => prev.map((it) => (it.id === id ? { ...it, error: errorText(err) } : it)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-surface-border px-4 py-2 text-[11px] text-ink-soft">
        <span>Ask about your habits in plain English. Answers come from your own data.</span>
        {status && (
          <span className="flex shrink-0 items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${status.available ? "bg-emerald-500" : "bg-red-500"}`} />
            {status.available ? status.model : "model offline"}
            {status.readonly_role && <span className="rounded border border-surface-border px-1.5 py-px">read-only</span>}
          </span>
        )}
      </div>

      <div ref={scroller} className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4">
        {!items.length && (
          <div className="mx-auto mt-6 max-w-md text-center">
            <h3 className="text-base">What would you like to know?</h3>
            <p className="mt-1 text-xs text-ink-soft">
              The model writes a SQL query, it runs read-only against your data, and failed queries are corrected automatically.
            </p>
            <div className="mt-4 flex flex-col gap-2">
              {EXAMPLES.map((q) => (
                <button key={q} type="button" className="btn-secondary justify-start text-left" onClick={() => ask(q)} disabled={busy}>
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}
        {items.map((item) => (
          <Exchange key={item.id} item={item} />
        ))}
      </div>

      <form
        className="flex gap-2 border-t border-surface-border px-4 py-3"
        onSubmit={(e) => {
          e.preventDefault();
          ask(question);
        }}
      >
        <input
          className="input flex-1"
          placeholder="e.g. How many hours did I read in September?"
          value={question}
          maxLength={500}
          onChange={(e) => setQuestion(e.target.value)}
          disabled={busy}
        />
        <button type="submit" className="btn-primary" disabled={busy || question.trim().length < 3}>
          {busy ? <Spinner className="h-4 w-4" /> : "Ask"}
        </button>
      </form>
    </div>
  );
}
