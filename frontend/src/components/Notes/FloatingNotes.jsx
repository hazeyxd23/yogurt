import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useNotes } from "../../context/NotesContext";
import NoteEditor from "./NoteEditor";
import GraphEditor from "./GraphEditor";
import { ExternalIcon, GraphIcon, MinusIcon, NoteIcon, PinIcon, PlusIcon } from "../common/icons";

const DEFAULT_SIZE = { text: { w: 300, h: 280 }, graph: { w: 400, h: 320 } };
const MIN_SIZE = { w: 220, h: 150 };

/** First path segment, so /notes/12 and /notes share floating notes. */
export const pageKey = (pathname) => `/${pathname.split("/")[1] || ""}`;

function clampToViewport(x, y, w) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  // Keep at least the header grabbable on screen.
  return { x: Math.min(Math.max(x, 8 - w + 90), vw - 90), y: Math.min(Math.max(y, 64), vh - 44) };
}

function FloatingNote({ note, index, z, onFocus, page }) {
  const { updateNote } = useNotes();
  const navigate = useNavigate();
  const size0 = DEFAULT_SIZE[note.kind] || DEFAULT_SIZE.text;
  const fromNote = () => ({
    x: note.pos_x ?? window.innerWidth - (note.width || size0.w) - 24 - index * 28,
    y: note.pos_y ?? 96 + index * 28,
    w: note.width || size0.w,
    h: note.height || size0.h,
  });
  const [box, setBoxState] = useState(fromNote);
  const boxRef = useRef(box);
  const setBox = (next) => {
    const value = typeof next === "function" ? next(boxRef.current) : next;
    boxRef.current = value;
    setBoxState(value);
  };
  const [collapsed, setCollapsed] = useState(false);
  const interaction = useRef(null);

  // Follow saved geometry when it changes elsewhere (not mid-drag).
  useEffect(() => {
    if (!interaction.current) setBox(fromNote());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note.pos_x, note.pos_y, note.width, note.height]);

  useEffect(() => {
    const onResize = () => setBox((b) => ({ ...b, ...clampToViewport(b.x, b.y, b.w) }));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const start = (type) => (e) => {
    if (e.button !== 0) return;
    if (type === "move" && e.target.closest("button, input")) return;
    e.preventDefault();
    onFocus();
    interaction.current = { type, sx: e.clientX, sy: e.clientY, box: { ...box } };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // pointer already gone
    }
  };

  const move = (e) => {
    const it = interaction.current;
    if (!it) return;
    const dx = e.clientX - it.sx;
    const dy = e.clientY - it.sy;
    if (it.type === "move") {
      setBox({ ...it.box, ...clampToViewport(it.box.x + dx, it.box.y + dy, it.box.w) });
    } else {
      setBox({
        ...it.box,
        w: Math.max(MIN_SIZE.w, Math.min(it.box.w + dx, window.innerWidth - it.box.x - 8)),
        h: Math.max(MIN_SIZE.h, Math.min(it.box.h + dy, window.innerHeight - it.box.y - 8)),
      });
    }
  };

  const end = () => {
    const it = interaction.current;
    interaction.current = null;
    if (!it) return;
    const b = boxRef.current;
    if (it.type === "move" && (b.x !== it.box.x || b.y !== it.box.y)) {
      updateNote(note.id, { pos_x: Math.round(b.x), pos_y: Math.round(b.y) }, { immediate: true });
    } else if (it.type === "resize" && (b.w !== it.box.w || b.h !== it.box.h)) {
      updateNote(note.id, { width: Math.round(b.w), height: Math.round(b.h) }, { immediate: true });
    }
  };

  const togglePin = () => {
    // Unpinning keeps it on the page you're looking at right now.
    updateNote(note.id, note.pinned ? { pinned: false, floating_page: page } : { pinned: true }, { immediate: true });
  };

  const close = () => updateNote(note.id, { floating: false, pinned: false }, { immediate: true });

  const accent = note.pinned ? "border-t-amber-400" : note.kind === "graph" ? "border-t-emerald-400" : "border-t-indigo-400";

  return (
    <div
      className={`floating-note fixed flex animate-fade-in flex-col overflow-hidden rounded-xl border border-t-2 border-surface-border bg-surface-card/95 shadow-2xl shadow-black/50 backdrop-blur ${accent}`}
      style={{ left: box.x, top: box.y, width: box.w, height: collapsed ? undefined : box.h, zIndex: 60 + z }}
      onPointerDownCapture={onFocus}
    >
      <div
        className="flex cursor-grab items-center gap-1.5 border-b border-surface-border px-2 py-1.5 active:cursor-grabbing"
        onPointerDown={start("move")}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      >
        {note.kind === "graph" ? <GraphIcon className="h-3.5 w-3.5 shrink-0 text-emerald-400" /> : <NoteIcon className="h-3.5 w-3.5 shrink-0 text-indigo-700" />}
        <input
          value={note.title}
          onChange={(e) => updateNote(note.id, { title: e.target.value })}
          size={Math.max(4, Math.min(note.title.length + 1, 26))}
          className="min-w-0 max-w-[55%] rounded bg-transparent px-1 py-0.5 text-xs font-semibold text-ink outline-none hover:bg-white/5 focus:bg-surface focus:ring-1 focus:ring-indigo-400"
          aria-label="Floating note title"
          title="Rename"
        />
        {/* Drag handle: everything between the title and the buttons moves the window */}
        <div
          className="h-5 min-w-[24px] flex-1 rounded bg-[radial-gradient(circle,rgba(148,163,184,0.35)_1px,transparent_1.6px)] bg-[length:6px_6px] opacity-60 transition-opacity hover:opacity-100"
          title="Drag to move"
        />
        <button onClick={togglePin} title={note.pinned ? "Unpin (only show on this page)" : "Pin - keep on screen across pages"} className={`rounded p-1 ${note.pinned ? "text-amber-700" : "text-surface-muted hover:text-ink"}`}>
          <PinIcon className="h-3.5 w-3.5" filled={note.pinned} />
        </button>
        <button onClick={() => setCollapsed((c) => !c)} title={collapsed ? "Expand" : "Collapse"} className="rounded p-1 text-surface-muted hover:text-ink">
          <MinusIcon className="h-3.5 w-3.5" />
        </button>
        <button onClick={() => navigate(`/notes/${note.id}`)} title="Open in Notes" className="rounded p-1 text-surface-muted hover:text-ink">
          <ExternalIcon className="h-3.5 w-3.5" />
        </button>
        <button onClick={close} title="Close (the note stays in Notes)" className="rounded px-1 text-base leading-none text-surface-muted hover:text-ink">
          ×
        </button>
      </div>

      {!collapsed && (
        <>
          {note.kind === "graph" ? (
            <GraphEditor
              compact
              noteId={note.id}
              graph={note.graph}
              onChange={(graph) => updateNote(note.id, { graph })}
              className="min-h-0 flex-1"
            />
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
              <NoteEditor
                compact
                noteId={note.id}
                value={note.content}
                onChange={(content) => updateNote(note.id, { content })}
                placeholder="Jot something down..."
              />
            </div>
          )}
          <div
            className="absolute bottom-0 right-0 h-4 w-4 cursor-nwse-resize"
            onPointerDown={start("resize")}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={end}
            title="Resize"
          >
            <span className="absolute bottom-1 right-1 h-2 w-2 border-b-2 border-r-2 border-slate-500" />
          </div>
        </>
      )}
    </div>
  );
}

export default function FloatingNotes() {
  const { notes, loaded, createNote, updateNote } = useNotes();
  const location = useLocation();
  const [order, setOrder] = useState([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  const page = pageKey(location.pathname);

  const visible = notes.filter((n) => n.floating && (n.pinned || n.floating_page === page));
  const floatable = notes.filter((n) => !n.floating).slice(0, 6);

  const bringToFront = (id) => setOrder((prev) => (prev[prev.length - 1] === id ? prev : [...prev.filter((x) => x !== id), id]));

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e) => !menuRef.current?.contains(e.target) && setMenuOpen(false);
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [menuOpen]);

  const createFloating = async (kind) => {
    setMenuOpen(false);
    const size = DEFAULT_SIZE[kind];
    const offset = visible.length * 28;
    const note = await createNote({
      title: kind === "graph" ? "Quick graph" : "Quick note",
      kind,
      floating: true,
      floating_page: page,
      pinned: false,
      pos_x: Math.max(8, window.innerWidth - size.w - 24 - offset),
      pos_y: 96 + offset,
      width: size.w,
      height: size.h,
    });
    if (note) bringToFront(note.id);
  };

  const floatExisting = (note) => {
    setMenuOpen(false);
    updateNote(note.id, { floating: true, floating_page: page, pinned: false }, { immediate: true });
    bringToFront(note.id);
  };

  if (!loaded) return null;

  return (
    <>
      {visible.map((n, i) => {
        const z = order.indexOf(n.id) + 1;
        return <FloatingNote key={n.id} note={n} index={i} z={z} page={page} onFocus={() => bringToFront(n.id)} />;
      })}

      <div ref={menuRef} className="fixed bottom-[84px] right-3 z-[65] sm:bottom-4 sm:right-4">
        {menuOpen && (
          <div className="absolute bottom-14 right-0 w-60 animate-fade-in overflow-hidden rounded-xl border border-surface-border bg-surface-card shadow-2xl">
            <button onClick={() => createFloating("text")} className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-ink hover:bg-surface">
              <NoteIcon className="h-4 w-4 text-indigo-700" /> New floating note
            </button>
            <button onClick={() => createFloating("graph")} className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-ink hover:bg-surface">
              <GraphIcon className="h-4 w-4 text-emerald-400" /> New floating graph
            </button>
            {floatable.length > 0 && (
              <>
                <div className="border-t border-surface-border px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-surface-muted">
                  Float on this page
                </div>
                {floatable.map((n) => (
                  <button key={n.id} onClick={() => floatExisting(n)} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-ink-soft hover:bg-surface">
                    {n.kind === "graph" ? <GraphIcon className="h-3.5 w-3.5 text-emerald-400" /> : <NoteIcon className="h-3.5 w-3.5 text-indigo-700" />}
                    <span className="truncate">{n.title}</span>
                  </button>
                ))}
              </>
            )}
          </div>
        )}
        <button
          onClick={() => setMenuOpen((v) => !v)}
          aria-label="Floating notes"
          aria-expanded={menuOpen}
          title="Floating notes"
          className={`flex h-12 w-12 items-center justify-center aqua-fab rounded-full text-white transition-transform duration-200 hover:scale-105 ${menuOpen ? "rotate-45" : ""}`}
        >
          <PlusIcon className="h-5 w-5" />
        </button>
        {visible.length > 0 && !menuOpen && (
          <span className="pointer-events-none absolute -left-1 -top-1 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-amber-400 px-1 text-[10px] font-bold text-amber-950">
            {visible.length}
          </span>
        )}
      </div>
    </>
  );
}
