import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useOwnWindow } from "../desktop/WindowManager";
import { useNotes } from "../context/NotesContext";
import NoteEditor from "../components/Notes/NoteEditor";
import GraphEditor from "../components/Notes/GraphEditor";
import { extractLinks, taskCounts } from "../components/Notes/noteMarkup";
import LoadingState from "../components/common/LoadingState";
import ErrorMessage from "../components/common/ErrorMessage";
import { ExternalIcon, GraphIcon, NoteIcon, PinIcon, PlusIcon, TrashIcon } from "../components/common/icons";

export function timeAgo(iso) {
  if (!iso) return "";
  const then = new Date(iso.endsWith("Z") ? iso : `${iso}Z`).getTime();
  const s = Math.max(0, (Date.now() - then) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
  return new Date(then).toLocaleDateString();
}

/** A markdown line as readable text, for snippets. */
function plainText(line) {
  return line
    .replace(/^\s*(#{1,3}\s+|>\s?|[-*+]\s+(\[[ xX]\]\s+)?|\d+[.)]\s+)/, "")
    .replace(/\[\[([^\]|]+)(\|([^\]]+))?\]\]/g, (_, target, __, alias) => alias || target)
    .replace(/(\*\*|==|~~|`)/g, "")
    .trim();
}

function NoteListItem({ note, active, onClick }) {
  const tasks = note.kind === "text" ? taskCounts(note.content) : null;
  const meta =
    note.kind === "graph"
      ? `${note.graph?.nodes?.length || 0} nodes`
      : tasks.total
        ? `${tasks.done}/${tasks.total} done`
        : (note.content || "").replace(/[#>*`[\]-]/g, "").trim().slice(0, 40) || "Empty";
  const Icon = note.kind === "graph" ? GraphIcon : NoteIcon;
  return (
    <button
      onClick={onClick}
      className={`group flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left ${
        active ? "bg-indigo-500/15 ring-1 ring-indigo-400/40" : "hover:bg-surface"
      }`}
    >
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${note.kind === "graph" ? "text-emerald-400" : "text-indigo-700"}`} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium text-ink">{note.title}</span>
          {(note.is_dashboard || note.system_key) && (
            <span className="rounded bg-surface px-1 text-[9px] uppercase tracking-wide text-surface-muted">
              {note.is_dashboard ? "dashboard" : note.system_key}
            </span>
          )}
          {note.floating && <PinIcon className={`h-3 w-3 shrink-0 ${note.pinned ? "text-amber-700" : "text-surface-muted"}`} filled={note.pinned} />}
        </span>
        <span className="flex justify-between gap-2 text-[11px] text-surface-muted">
          <span className="truncate">{meta}</span>
          <span className="shrink-0">{timeAgo(note.updated_at)}</span>
        </span>
      </span>
    </button>
  );
}

function Backlinks({ note, notes, onOpen }) {
  const title = note.title.trim().toLowerCase();
  const mentions = useMemo(() => {
    const out = [];
    for (const other of notes) {
      if (other.id === note.id) continue;
      if (other.kind === "text") {
        const line = (other.content || "")
          .split("\n")
          .find((l) => extractLinks(l).some((t) => t.toLowerCase() === title));
        if (line) out.push({ note: other, snippet: plainText(line) });
      } else if (other.graph?.nodes?.some((n) => n.noteId === note.id)) {
        const node = other.graph.nodes.find((n) => n.noteId === note.id);
        out.push({ note: other, snippet: `Node "${node.label}"` });
      }
    }
    return out;
  }, [notes, note.id, title]);

  const outgoing = note.kind === "text" ? extractLinks(note.content) : [];
  const exists = (t) => notes.some((n) => n.title.trim().toLowerCase() === t.toLowerCase());

  return (
    <div className="grid grid-cols-1 gap-4 border-t border-surface-border pt-4 md:grid-cols-2">
      <div>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-surface-muted">Linked mentions · {mentions.length}</h4>
        {mentions.length === 0 ? (
          <p className="text-xs text-surface-muted/80">
            No notes link here yet. Write <code className="rounded bg-surface px-1 text-pink-700">[[{note.title}]]</code> in another note.
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {mentions.map(({ note: other, snippet }) => (
              <li key={other.id}>
                <button onClick={() => onOpen(other.id)} className="w-full rounded-lg px-2 py-1.5 text-left hover:bg-surface">
                  <div className="text-xs font-semibold text-indigo-700">{other.title}</div>
                  <div className="truncate text-[11px] text-surface-muted">{snippet}</div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {note.kind === "text" && (
        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-surface-muted">Links · {outgoing.length}</h4>
          {outgoing.length === 0 ? (
            <p className="text-xs text-surface-muted/80">Type [[ to link to another note.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {outgoing.map((t) => (
                <span
                  key={t}
                  className={`rounded-md px-2 py-0.5 text-[11px] ${exists(t) ? "bg-indigo-500/15 text-indigo-700" : "border border-dashed border-surface-border text-surface-muted"}`}
                  title={exists(t) ? t : `"${t}" doesn't exist yet`}
                >
                  {t}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function NotesPage() {
  const { path } = useOwnWindow();
  const id = path?.match(/^\/notes\/(\d+)/)?.[1];
  const navigate = useNavigate();
  const { notes, loaded, error, saving, createNote, updateNote, deleteNote } = useNotes();
  const [query, setQuery] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const current = notes.find((n) => String(n.id) === id) || null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? notes.filter((n) => n.title.toLowerCase().includes(q) || (n.kind === "text" && n.content.toLowerCase().includes(q)))
      : notes;
    return [...list].sort((a, b) => Number(b.is_dashboard) - Number(a.is_dashboard) || (b.updated_at || "").localeCompare(a.updated_at || ""));
  }, [notes, query]);

  const open = (noteId) => {
    setConfirmDelete(false);
    navigate(`/notes/${noteId}`);
  };

  const create = async (kind) => {
    const note = await createNote({ title: kind === "graph" ? "Untitled graph" : "Untitled", kind });
    if (note) open(note.id);
  };

  const remove = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    if (await deleteNote(current.id)) navigate("/notes");
    setConfirmDelete(false);
  };

  const popOut = () => {
    updateNote(current.id, { floating: true, pinned: true, floating_page: "/notes" }, { immediate: true });
  };

  if (!loaded && error) return <ErrorMessage message={error} />;
  if (!loaded) return <LoadingState label="Loading notes..." />;

  return (
    <div className="flex h-full min-h-[420px] gap-3">
      {/* Sidebar */}
      <aside className={`card flex w-full shrink-0 flex-col p-3 md:w-72 ${current ? "hidden md:flex" : "flex"}`}>
        <div className="mb-3 flex gap-2">
          <button onClick={() => create("text")} className="btn-primary min-h-[38px] flex-1 py-1.5 text-xs">
            <PlusIcon className="h-3.5 w-3.5" /> Note
          </button>
          <button onClick={() => create("graph")} className="btn min-h-[38px] flex-1 bg-emerald-600 py-1.5 text-xs text-white hover:bg-emerald-500">
            <GraphIcon className="h-3.5 w-3.5" /> Graph
          </button>
        </div>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search notes..." className="input mb-2 min-h-[38px] py-1.5 text-xs" />
        <div className="-mx-1 flex-1 overflow-y-auto px-1">
          {filtered.length === 0 && <p className="px-2 py-4 text-center text-xs text-surface-muted">No notes match.</p>}
          <div className="flex flex-col gap-0.5">
            {filtered.map((n) => (
              <NoteListItem key={n.id} note={n} active={n.id === current?.id} onClick={() => open(n.id)} />
            ))}
          </div>
        </div>
        <p className="mt-2 border-t border-surface-border pt-2 text-[11px] text-surface-muted">
          {notes.length} notes · {saving ? "saving..." : "all changes saved"}
        </p>
      </aside>

      {/* Editor */}
      <section className={`card flex min-w-0 flex-1 flex-col p-0 ${current ? "flex" : "hidden md:flex"}`}>
        {current ? (
          <>
            <div className="flex items-center gap-2 border-b border-surface-border px-4 py-3">
              <button onClick={() => navigate("/notes")} className="btn-secondary min-h-[34px] px-2 py-1 text-xs md:hidden" aria-label="Back to notes">
                ←
              </button>
              {current.kind === "graph" ? (
                <GraphIcon className="h-5 w-5 shrink-0 text-emerald-400" />
              ) : (
                <NoteIcon className="h-5 w-5 shrink-0 text-indigo-700" />
              )}
              <input
                value={current.title}
                onChange={(e) => updateNote(current.id, { title: e.target.value })}
                className="min-w-0 flex-1 bg-transparent text-lg font-semibold text-ink outline-none placeholder:text-surface-muted"
                placeholder="Untitled"
                aria-label="Note title"
              />
              <span className="hidden text-[11px] text-surface-muted sm:inline">{saving ? "Saving..." : `Saved ${timeAgo(current.updated_at)}`}</span>
              <button
                onClick={popOut}
                disabled={current.floating && current.pinned}
                title="Open as a floating note that stays on screen across pages"
                className="btn-secondary min-h-[34px] px-2.5 py-1 text-xs"
              >
                <ExternalIcon className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{current.floating && current.pinned ? "Floating" : "Pop out"}</span>
              </button>
              {!current.is_dashboard && !current.system_key && (
                <button
                  onClick={remove}
                  onBlur={() => setConfirmDelete(false)}
                  title="Delete note"
                  className={`btn min-h-[34px] px-2.5 py-1 text-xs ${confirmDelete ? "bg-red-600 text-white hover:bg-red-500" : "bg-transparent text-surface-muted hover:bg-red-500/15 hover:text-red-700"}`}
                >
                  <TrashIcon className="h-3.5 w-3.5" />
                  {confirmDelete && <span>Delete?</span>}
                </button>
              )}
            </div>

            {current.kind === "graph" ? (
              <div className="flex min-h-0 flex-1 flex-col">
                <GraphEditor
                  key={current.id}
                  noteId={current.id}
                  graph={current.graph}
                  onChange={(graph) => updateNote(current.id, { graph })}
                  className="min-h-0 flex-1 rounded-b-xl"
                />
              </div>
            ) : (
              <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 py-4">
                <NoteEditor
                  key={current.id}
                  noteId={current.id}
                  value={current.content}
                  onChange={(content) => updateNote(current.id, { content })}
                  className="flex-1"
                  placeholder="Start writing... use - [ ] for tick markers and [[Note]] to link notes"
                />
                <div className="mt-6">
                  <Backlinks note={current} notes={notes} onOpen={open} />
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
            <NoteIcon className="h-10 w-10 text-surface-border" />
            <p className="text-sm text-surface-muted">Pick a note on the left, or start a new one.</p>
            <div className="flex gap-2">
              <button onClick={() => create("text")} className="btn-primary min-h-[38px] py-1.5 text-xs">
                New note
              </button>
              <button onClick={() => create("graph")} className="btn min-h-[38px] bg-emerald-600 py-1.5 text-xs text-white hover:bg-emerald-500">
                New graph
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
