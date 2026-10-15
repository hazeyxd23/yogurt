import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createBook, createReadingSessionFull, getBookSessions, isCancel } from "../../services/api";
import { useTimer } from "../../hooks/useTimer";
import { useToast } from "../../context/ToastContext";
import Spinner from "../common/Spinner";
import { BOOK_COLORS, bookSprite, coverSprite, texture, tiled } from "./pixelArt";

// Ask "where did you leave off?" after sessions at least this long.
// 10 seconds while testing - raise to a few minutes for real use.
const ENDING_NOTE_MIN_SECONDS = 10;
const SLOTS_PER_SHELF = 6;
const SHELF_BLOCK = 112; // px, one chiseled bookshelf on the back wall

// The 3D room (px): depth of the room, height of the scene, camera distance.
const ROOM = { h: 420, d: 300, perspective: 760 };
const TABLE = { size: 124, height: 93, z: -150 };

/** A wall/floor face: tiled texture, darkened by `shade`, placed with a 3D transform. */
const face = (name, size, shade, width, height, transform) => ({
  backgroundImage: `linear-gradient(rgba(0,0,0,${shade}), rgba(0,0,0,${shade})), url(${texture(name)})`,
  backgroundSize: `auto, ${size}px ${size}px`,
  imageRendering: "pixelated",
  width,
  height,
  marginLeft: -width / 2,
  marginTop: -height / 2,
  transform,
});
const pixelBg = (name) => ({ backgroundImage: `url(${texture(name)})`, backgroundSize: "100% 100%", imageRendering: "pixelated" });
const GLYPHS = "ᔑʖᓵ↸ᒷ⎓⊣⍑╎⋮ꖌꖎᒲリᑑ∷ᓭℸ⚍⍊∴";

function hash(str) {
  let h = 0;
  for (const ch of str) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return Math.abs(h);
}

const bookColor = (book) => BOOK_COLORS[hash(`${book.id}-${book.title}`) % BOOK_COLORS.length];
const progressOf = (book) => (book.total_pages ? Math.min(100, Math.round((book.current_page / book.total_pages) * 100)) : null);
const clock = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
const shortDate = (d) => new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** Run `done` once an animation finishes - even if the tab isn't painting (onfinish never fires then). */
function settle(anim, done, fallbackMs) {
  let called = false;
  const once = () => {
    if (!called) {
      called = true;
      done();
    }
  };
  anim.finished.then(once, once);
  setTimeout(once, fallbackMs);
}

// ---------- the open book's pages ----------

function TitlePage({ book }) {
  const pct = progressOf(book);
  return (
    <div className="flex h-full flex-col">
      <div className="text-[22px] leading-none text-[#3f2a14]">{book.title}</div>
      {book.author && <div className="mt-1 text-[#7a5b3a]">by {book.author}</div>}
      <div className="my-2 h-px bg-[#c9b78d]" />
      {pct !== null ? (
        <>
          <div>
            p. {book.current_page} of {book.total_pages}
          </div>
          <div className="mt-1 h-2 w-full bg-[#d8c79c] p-px">
            <div className="h-full bg-[#5d7c15]" style={{ width: `${pct}%` }} />
          </div>
        </>
      ) : (
        <div>{book.current_page} pages read</div>
      )}
      {book.status === "completed" && <div className="mt-auto text-[#a0700f]">✦ Finished</div>}
    </div>
  );
}

function NoteMetaPage({ note, index, total }) {
  return (
    <div className="flex h-full flex-col">
      <div className="text-[#7a5b3a]">
        Note {index + 1} of {total}
      </div>
      <div className="text-[22px] leading-none text-[#3f2a14]">{shortDate(note.session_date)}</div>
      <div className="my-2 h-px bg-[#c9b78d]" />
      {note.end_page !== null && note.end_page !== undefined && <div>Stopped at p. {note.end_page}</div>}
      <div className="text-[#7a5b3a]">
        {note.duration_minutes} min · +{note.pages_read} pages
      </div>
    </div>
  );
}

function NoteTextPage({ text }) {
  return <div className="h-full overflow-y-auto whitespace-pre-wrap break-words pr-1">{text}</div>;
}

// ---------- the scene ----------

export default function Library({ books: unsorted, onChanged }) {
  const books = useMemo(() => [...unsorted].sort((a, b) => a.id - b.id), [unsorted]);
  const [activeId, setActiveId] = useState(null);
  const [open, setOpen] = useState(false);
  const [moving, setMoving] = useState(false);
  const [started, setStarted] = useState(false);
  const [page, setPage] = useState(0);
  const [startPage, setStartPage] = useState(0);
  const [notes, setNotes] = useState(null); // null while loading
  const [noteIdx, setNoteIdx] = useState(0);
  const [flip, setFlip] = useState(null); // { dir, from, to }
  const [ending, setEnding] = useState(false);
  const [endNote, setEndNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmPutBack, setConfirmPutBack] = useState(false);
  const [tip, setTip] = useState(null); // { book, left, top }
  const [adding, setAdding] = useState(null); // { left, top }
  const [fresh, setFresh] = useState(() => new Set());
  const knownIds = useRef(null);
  const slotRefs = useRef(new Map());
  const bookRef = useRef(null);
  const sceneRef = useRef(null);
  const timer = useTimer(0);
  const { showToast } = useToast();

  const active = books.find((b) => b.id === activeId) || null;
  const [roomW, setRoomW] = useState(440);
  const shelfCols = Math.max(3, Math.min(5, Math.floor((roomW - 30) / (SHELF_BLOCK + 8))));
  const shelfCount = Math.max(shelfCols, Math.ceil((books.length + 1) / SLOTS_PER_SHELF));
  const slots = Array.from({ length: shelfCount * SLOTS_PER_SHELF }, (_, i) => books[i] || null);
  const firstEmpty = books.length;

  useLayoutEffect(() => {
    const el = sceneRef.current;
    if (!el) return undefined;
    setRoomW(el.offsetWidth);
    const ro = new ResizeObserver(([entry]) => setRoomW(Math.round(entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // New books pop into their slot.
  useEffect(() => {
    const ids = new Set(books.map((b) => b.id));
    if (knownIds.current) {
      const added = [...ids].filter((id) => !knownIds.current.has(id));
      if (added.length) {
        setFresh(new Set(added));
        setTimeout(() => setFresh(new Set()), 700);
      }
    }
    knownIds.current = ids;
  }, [books]);

  // Notes ("where I left off") for the book on the table, newest first.
  useEffect(() => {
    if (!activeId) return undefined;
    const controller = new AbortController();
    getBookSessions(activeId, controller.signal)
      .then((sessions) => setNotes(sessions.filter((s) => (s.key_note || "").trim())))
      .catch((err) => !isCancel(err) && setNotes([]));
    return () => controller.abort();
  }, [activeId]);

  // ----- flight between the shelf and the table -----

  /** Where the closed book (right half of the book element) sits on screen. */
  const coverRect = () => {
    const r = bookRef.current.getBoundingClientRect();
    return { left: r.left + r.width / 2, top: r.top, width: r.width / 2, height: r.height };
  };

  const flightFrames = (slotRect, cover) => {
    const s = slotRect.height / cover.height;
    const dx = slotRect.left + slotRect.width / 2 - (cover.left + cover.width / 2);
    const dy = slotRect.top + slotRect.height / 2 - (cover.top + cover.height / 2);
    return [
      { transform: `translate(${dx}px, ${dy}px) scale(${s})`, offset: 0 },
      { transform: `translate(${dx * 0.45}px, ${dy * 0.45 - 70}px) scale(${(s + 1) / 2}) rotate(-8deg)`, offset: 0.45 },
      { transform: "translate(0px, 0px) scale(1) rotate(0deg)", offset: 1 },
    ];
  };

  useLayoutEffect(() => {
    if (!activeId || !moving || open) return;
    const el = bookRef.current;
    const slot = slotRefs.current.get(activeId);
    const arrive = () => {
      setMoving(false);
      setOpen(true);
    };
    if (!el || !slot || reducedMotion()) {
      arrive();
      return;
    }
    el.style.transformOrigin = "75% 50%";
    settle(el.animate(flightFrames(slot.getBoundingClientRect(), coverRect()), { duration: 750, easing: "cubic-bezier(.25,.8,.25,1)" }), arrive, 1100);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  const pick = (book) => {
    if (moving) return;
    if (activeId) {
      if (book.id !== activeId) showToast("Put back the book on the table first", "error");
      return;
    }
    setTip(null);
    setAdding(null);
    timer.reset();
    setStarted(false);
    setPage(book.current_page || 0);
    setStartPage(book.current_page || 0);
    setNotes(null);
    setNoteIdx(0);
    setFlip(null);
    setEnding(false);
    setEndNote("");
    setConfirmPutBack(false);
    setOpen(false);
    setMoving(true);
    setActiveId(book.id);
  };

  const returnBook = (after) => {
    timer.stop();
    setStarted(false);
    setEnding(false);
    setConfirmPutBack(false);
    setOpen(false);
    setMoving(true);
    const done = () => {
      setActiveId(null);
      setMoving(false);
      after?.();
    };
    if (reducedMotion()) {
      done();
      return;
    }
    // Close the cover first, then fly back to the shelf.
    setTimeout(() => {
      const el = bookRef.current;
      const slot = slotRefs.current.get(activeId);
      if (!el || !slot) {
        done();
        return;
      }
      const frames = flightFrames(slot.getBoundingClientRect(), coverRect())
        .reverse()
        .map((f) => ({ ...f, offset: 1 - f.offset }));
      settle(el.animate(frames, { duration: 650, easing: "cubic-bezier(.5,0,.3,1)", fill: "forwards" }), done, 1000);
    }, 650);
  };

  // ----- session -----

  const start = () => {
    setStarted(true);
    timer.start();
  };

  const save = async (note) => {
    setSaving(true);
    try {
      const pagesRead = Math.max(0, page - startPage);
      await createReadingSessionFull({
        book_id: active.id,
        duration_minutes: Math.max(1, Math.round(timer.seconds / 60)),
        pages_read: pagesRead,
        end_page: page,
        key_note: note.trim() || null,
      });
      const finished = active.total_pages && page >= active.total_pages && active.status !== "completed";
      showToast(finished ? `Finished "${active.title}"! 🎉` : `Session saved - ${pagesRead} page${pagesRead === 1 ? "" : "s"}, ${clock(timer.seconds)}`);
      returnBook(onChanged);
    } catch {
      showToast("Couldn't save the session", "error");
    } finally {
      setSaving(false);
    }
  };

  const stop = () => {
    timer.pause();
    if (timer.seconds >= ENDING_NOTE_MIN_SECONDS) {
      setEnding(true);
      setEndNote("");
    } else {
      save("");
    }
  };

  const putBack = () => {
    if (started && timer.seconds >= 60 && !confirmPutBack) {
      setConfirmPutBack(true);
      return;
    }
    returnBook();
  };

  const clampPage = (n) => {
    const v = Number.isFinite(n) ? Math.round(n) : 0;
    return Math.max(0, active?.total_pages ? Math.min(v, active.total_pages) : v);
  };

  // ----- turning pages through the notes -----

  const flipTo = (dir) => {
    if (!notes?.length || flip || ending) return;
    const to = dir === "next" ? noteIdx + 1 : noteIdx - 1;
    if (to < 0 || to >= notes.length) return;
    if (!open || reducedMotion()) {
      setNoteIdx(to);
      return;
    }
    setFlip({ dir, from: noteIdx, to });
    setTimeout(() => {
      setNoteIdx(to);
      setFlip(null);
    }, 480);
  };

  const leftPage = (i) => {
    if (ending) {
      return (
        <div className="flex h-full flex-col">
          <div className="text-[#7a5b3a]">This session</div>
          <div className="text-[22px] leading-none text-[#3f2a14]">{clock(timer.seconds)}</div>
          <div className="my-2 h-px bg-[#c9b78d]" />
          <div>
            p. {startPage} → p. {page}
          </div>
          <div className="text-[#7a5b3a]">+{Math.max(0, page - startPage)} pages</div>
        </div>
      );
    }
    if (!notes || !notes.length) return active ? <TitlePage book={active} /> : null;
    return <NoteMetaPage note={notes[i]} index={i} total={notes.length} />;
  };

  const rightPage = (i) => {
    if (ending) {
      return (
        <div className="flex h-full flex-col">
          <div className="text-[#7a5b3a]">Where did you leave off?</div>
          <div className="mt-1 flex-1 overflow-y-auto whitespace-pre-wrap break-words">
            {endNote}
            <span className="mc-caret">_</span>
          </div>
        </div>
      );
    }
    if (notes === null) return <div className="text-[#7a5b3a]">Opening...</div>;
    if (!notes.length) {
      return (
        <div className="text-[#7a5b3a]">
          No notes yet.
          <br />
          <br />
          Finish a session and you&apos;ll be asked where you left off - it gets written here.
        </div>
      );
    }
    return <NoteTextPage text={notes[i].key_note} />;
  };

  // During a flip the pages underneath show the destination on one side and the origin on the other.
  const leftIdx = flip ? (flip.dir === "next" ? flip.from : flip.to) : noteIdx;
  const rightIdx = flip ? (flip.dir === "next" ? flip.to : flip.from) : noteIdx;

  // ----- tooltips & add form -----

  const sceneOffset = (el) => {
    const s = sceneRef.current.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return { left: Math.min(Math.max(r.left - s.left + r.width / 2, 80), s.width - 80), top: r.top - s.top, bottom: r.bottom - s.top, width: s.width };
  };

  const addBookAt = (el) => {
    if (activeId) return;
    const o = sceneOffset(el);
    setTip(null);
    setAdding({ left: Math.min(Math.max(o.left, 125), o.width - 125), top: o.bottom + 6 });
  };

  const glyphs = useMemo(
    () =>
      Array.from({ length: 14 }, (_, i) => {
        const r = (n) => (hash(`g${i}-${n}`) % 1000) / 1000;
        const side = i % 3;
        return {
          ch: GLYPHS[hash(`c${i}`) % GLYPHS.length],
          sx: side === 0 ? -150 - r(1) * 60 : side === 1 ? 150 + r(1) * 60 : -120 + r(1) * 240,
          sy: side === 2 ? -150 - r(2) * 40 : -40 + r(2) * 110,
          dur: 2.2 + r(3) * 1.4,
          delay: r(4) * 3,
        };
      }),
    []
  );

  const pct = active ? progressOf(active) : null;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      {/* ---------- session controls ---------- */}
      <div className="card order-2 lg:order-1">
        <h3 className="mb-4">Reading Session</h3>

        {active ? (
          <div className="mb-4 rounded-lg bg-surface px-3 py-2.5">
            <div className="truncate text-sm font-semibold text-ink">{active.title}</div>
            {active.author && <div className="truncate text-xs text-surface-muted">{active.author}</div>}
            {pct !== null && (
              <div className="mt-2 flex items-center gap-2">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-card">
                  <div className="h-1.5 rounded-full bg-reading" style={{ width: `${pct}%` }} />
                </div>
                <span className="text-[11px] tabular-nums text-surface-muted">{pct}%</span>
              </div>
            )}
          </div>
        ) : (
          <div className="mb-4 rounded-lg border border-dashed border-surface-border px-3 py-3 text-sm text-surface-muted">
            Pick a book from the shelf - it opens on the enchanting table.
          </div>
        )}

        <p className={`mb-4 text-center text-5xl font-bold tabular-nums ${active ? "text-ink" : "text-surface-border"}`}>{clock(timer.seconds)}</p>

        {active && !ending && (
          <>
            {/* page stepper: -1 / +1, or type a page to jump */}
            <div className="mb-3 flex items-center gap-2">
              <span className="w-12 text-xs text-surface-muted">Page</span>
              <button onClick={() => setPage((p) => clampPage(p - 1))} className="btn-secondary h-10 min-h-0 w-10 px-0 text-lg" aria-label="Previous page">
                −
              </button>
              <input
                type="number"
                inputMode="numeric"
                value={page}
                onChange={(e) => setPage(clampPage(Number(e.target.value)))}
                onFocus={(e) => e.target.select()}
                className="input h-10 min-h-0 w-20 text-center text-base font-semibold tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                aria-label="Current page"
              />
              <button onClick={() => setPage((p) => clampPage(p + 1))} className="btn-secondary h-10 min-h-0 w-10 px-0 text-lg" aria-label="Next page">
                +
              </button>
              <span className="text-xs text-surface-muted">
                {active.total_pages ? `of ${active.total_pages}` : ""}
                {page !== startPage && (
                  <span className={`ml-1.5 ${page > startPage ? "text-emerald-400" : "text-amber-400"}`}>
                    {page > startPage ? "+" : ""}
                    {page - startPage}
                  </span>
                )}
              </span>
            </div>

            {/* notes: flip through them instead of writing one up front */}
            <div className="mb-4 flex items-center gap-2 rounded-lg bg-surface px-2 py-2">
              <button
                onClick={() => flipTo("prev")}
                disabled={!notes?.length || noteIdx === 0 || Boolean(flip)}
                className="btn-secondary h-8 min-h-0 w-8 px-0 disabled:opacity-30"
                aria-label="Newer note"
              >
                ‹
              </button>
              <div className="min-w-0 flex-1 text-xs">
                {notes === null ? (
                  <span className="text-surface-muted">Loading notes...</span>
                ) : notes.length ? (
                  <>
                    <div className="text-surface-muted">
                      Note {noteIdx + 1}/{notes.length} · {shortDate(notes[noteIdx].session_date)}
                    </div>
                    <div className="truncate text-ink">{notes[noteIdx].key_note}</div>
                  </>
                ) : (
                  <span className="text-surface-muted">No notes for this book yet.</span>
                )}
              </div>
              <button
                onClick={() => flipTo("next")}
                disabled={!notes?.length || noteIdx >= notes.length - 1 || Boolean(flip)}
                className="btn-secondary h-8 min-h-0 w-8 px-0 disabled:opacity-30"
                aria-label="Older note"
              >
                ›
              </button>
            </div>
          </>
        )}

        {active && ending && (
          <div className="mb-4 animate-fade-in">
            <label className="label" htmlFor="ending-note">
              Where did you leave off? It&apos;s waiting in the book next time.
            </label>
            <textarea
              id="ending-note"
              autoFocus
              rows={3}
              value={endNote}
              onChange={(e) => setEndNote(e.target.value)}
              placeholder="e.g. Chapter 4 - the part about habit stacking"
              className="input resize-none"
            />
          </div>
        )}

        {!active ? (
          <button disabled className="btn-primary w-full">
            Start reading
          </button>
        ) : ending ? (
          <div className="flex gap-2">
            <button onClick={() => save(endNote)} disabled={saving} className="btn flex-1 bg-reading text-white hover:bg-reading-dark focus:ring-reading">
              {saving && <Spinner className="h-4 w-4" />}
              {saving ? "Saving..." : "Save note & finish"}
            </button>
            <button onClick={() => save("")} disabled={saving} className="btn-secondary">
              Skip
            </button>
          </div>
        ) : !started ? (
          <div className="flex gap-2">
            <button onClick={start} disabled={moving} className="btn flex-1 bg-reading text-white hover:bg-reading-dark focus:ring-reading">
              ▶ Start reading
            </button>
            <button onClick={putBack} disabled={moving} className="btn-secondary">
              Put back
            </button>
          </div>
        ) : (
          <div className="flex gap-2">
            <button onClick={timer.isRunning ? timer.pause : timer.start} disabled={moving} className="btn-secondary">
              {timer.isRunning ? "Pause" : "Resume"}
            </button>
            <button onClick={stop} disabled={saving || moving} className="btn flex-1 bg-reading text-white hover:bg-reading-dark focus:ring-reading">
              Stop & Save
            </button>
            <button
              onClick={putBack}
              disabled={saving || moving}
              className={`btn ${confirmPutBack ? "bg-red-600 text-white hover:bg-red-500" : "btn-secondary"}`}
            >
              {confirmPutBack ? "Discard?" : "Put back"}
            </button>
          </div>
        )}
      </div>

      {/* ---------- the library ---------- */}
      <div className="card order-1 p-3 lg:order-2">
        <div className="mb-3 flex items-baseline justify-between px-1">
          <h3>Library</h3>
          <span className="text-xs text-surface-muted">
            {books.length} book{books.length === 1 ? "" : "s"} · {books.filter((b) => b.status === "completed").length} finished
          </span>
        </div>

        <div ref={sceneRef} className="mc-scene" style={{ height: ROOM.h }} onMouseLeave={() => setTip(null)}>
          {/* A real 3D room: brick ceiling, carpet floor, bookshelf walls, enchanting table */}
          <div className="mc-room" style={{ perspective: `${ROOM.perspective}px` }}>
            <div className="mc-3d">
              <div className="mc-face" style={face("bricks", 124, 0.45, roomW, ROOM.d, `translate3d(0, ${-ROOM.h / 2}px, ${-ROOM.d / 2}px) rotateX(-90deg)`)} />
              <div className="mc-face" style={face("carpet", 124, 0.12, roomW, ROOM.d, `translate3d(0, ${ROOM.h / 2}px, ${-ROOM.d / 2}px) rotateX(90deg)`)} />
              <div className="mc-face" style={face("bookshelf", 124, 0.42, ROOM.d, ROOM.h, `translate3d(${-roomW / 2}px, 0, ${-ROOM.d / 2}px) rotateY(90deg)`)} />
              <div className="mc-face" style={face("bookshelf", 124, 0.42, ROOM.d, ROOM.h, `translate3d(${roomW / 2}px, 0, ${-ROOM.d / 2}px) rotateY(-90deg)`)} />

              {/* back wall: your books live in the chiseled shelves */}
              <div className="mc-face mc-back" style={face("bookshelf", 124, 0.22, roomW, ROOM.h, `translateZ(${-ROOM.d}px)`)}>
                <div className="mc-shelves" style={{ gridTemplateColumns: `repeat(${shelfCols}, ${SHELF_BLOCK}px)` }}>
                  {Array.from({ length: shelfCount }, (_, s) => (
                    <div key={s} className="mc-shelf" style={tiled("planks", 112)}>
                      {slots.slice(s * SLOTS_PER_SHELF, (s + 1) * SLOTS_PER_SHELF).map((book, j) => {
                        const index = s * SLOTS_PER_SHELF + j;
                        if (!book) {
                          return (
                            <button
                              key={`empty-${index}`}
                              className="mc-slot mc-slot-empty"
                              onClick={(e) => addBookAt(e.currentTarget)}
                              title={activeId ? undefined : "Add a book"}
                              aria-label="Add a book"
                            >
                              {index === firstEmpty && !activeId && <span className="mc-slot-plus">+</span>}
                            </button>
                          );
                        }
                        const out = book.id === activeId;
                        return (
                          <div
                            key={book.id}
                            ref={(el) => (el ? slotRefs.current.set(book.id, el) : slotRefs.current.delete(book.id))}
                            className="mc-slot"
                          >
                            {!out && (
                              <button
                                className={`mc-book ${fresh.has(book.id) ? "mc-book-in" : ""} ${activeId ? "cursor-not-allowed" : ""}`}
                                style={{ backgroundImage: `url(${bookSprite(bookColor(book))})` }}
                                onClick={() => pick(book)}
                                onMouseEnter={(e) => setTip({ book, ...sceneOffset(e.currentTarget) })}
                                onMouseLeave={() => setTip(null)}
                                onFocus={(e) => setTip({ book, ...sceneOffset(e.currentTarget) })}
                                onBlur={() => setTip(null)}
                                aria-label={`Read ${book.title}`}
                              />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>

              {/* enchanting table: top and front faces (the sides face away from us) */}
              <div
                className="mc-face"
                style={{
                  ...pixelBg("tableTop"),
                  width: TABLE.size,
                  height: TABLE.size,
                  marginLeft: -TABLE.size / 2,
                  marginTop: -TABLE.size / 2,
                  transform: `translate3d(0, ${ROOM.h / 2 - TABLE.height}px, ${TABLE.z}px) rotateX(90deg)`,
                }}
              />
              <div
                className="mc-face"
                style={{
                  ...pixelBg("tableSide"),
                  width: TABLE.size,
                  height: TABLE.height,
                  marginLeft: -TABLE.size / 2,
                  marginTop: -TABLE.height / 2,
                  transform: `translate3d(0, ${ROOM.h / 2 - TABLE.height / 2}px, ${TABLE.z + TABLE.size / 2}px)`,
                }}
              />
            </div>
            <div className="mc-light" aria-hidden="true" />
          </div>

          {started && timer.isRunning && (
            <div className="mc-glyphs" aria-hidden="true">
              {glyphs.map((g, i) => (
                <span key={i} className="mc-glyph" style={{ "--sx": `${g.sx}px`, "--sy": `${g.sy}px`, "--dur": `${g.dur}s`, "--delay": `${g.delay}s` }}>
                  {g.ch}
                </span>
              ))}
            </div>
          )}

          <div className="mc-anchor">
            <div className="mc-bob">
              {active ? (
                <div className={`mc-shift ${open ? "is-open" : ""}`}>
                  <div ref={bookRef} className={`mc-tbook ${open ? "is-open" : ""}`}>
                    <div className="mc-paper mc-page-right" onClick={() => flipTo("next")}>
                      {rightPage(rightIdx)}
                      {notes?.length > 1 && !ending && rightIdx < notes.length - 1 && <span className="mc-arrow mc-arrow-next">▶</span>}
                    </div>
                    <div className="mc-cover">
                      <div className="mc-cover-front" style={{ backgroundImage: `url(${coverSprite(bookColor(active))})` }}>
                        <span>{active.title}</span>
                      </div>
                      <div className="mc-paper mc-cover-back" onClick={() => flipTo("prev")}>
                        {leftPage(leftIdx)}
                        {notes?.length > 1 && !ending && leftIdx > 0 && <span className="mc-arrow mc-arrow-prev">◀</span>}
                      </div>
                    </div>
                    {flip && (
                      <div className={`mc-sheet ${flip.dir}`}>
                        <div className="mc-paper mc-face-page">{rightPage(flip.dir === "next" ? flip.from : flip.to)}</div>
                        <div className="mc-paper mc-face-page mc-face-back">{leftPage(flip.dir === "next" ? flip.to : flip.from)}</div>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="mc-idle-book" style={pixelBg("openBook")} title="Pick a book from the shelf" />
              )}
            </div>
          </div>

          {tip && !activeId && (
            <div className="mc-tooltip" style={{ left: tip.left, top: tip.top }}>
              <div>{tip.book.title}</div>
              {tip.book.author && <div className="mc-sub">{tip.book.author}</div>}
              {tip.book.status === "completed" ? (
                <div className="mc-gold">Finished</div>
              ) : progressOf(tip.book) !== null ? (
                <div className="mc-aqua">
                  {progressOf(tip.book)}% · p. {tip.book.current_page}/{tip.book.total_pages}
                </div>
              ) : null}
            </div>
          )}

          {adding && <AddBookForm position={adding} onClose={() => setAdding(null)} onAdded={onChanged} />}
        </div>
      </div>
    </div>
  );
}

function AddBookForm({ position, onClose, onAdded }) {
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [pages, setPages] = useState("");
  const [saving, setSaving] = useState(false);
  const { showToast } = useToast();

  const submit = async (e) => {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    try {
      await createBook(title.trim(), author.trim() || null, pages ? Number(pages) : null);
      showToast(`Shelved "${title.trim()}"`);
      onClose();
      onAdded?.();
    } catch {
      showToast("Couldn't add the book", "error");
      setSaving(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      onKeyDown={(e) => e.key === "Escape" && onClose()}
      className="mc-quill"
      style={{ left: position.left, top: position.top }}
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[22px] leading-none">Book &amp; Quill</span>
        <button type="button" onClick={onClose} className="text-xl leading-none text-[#7a5b3a] hover:text-[#3f2a14]" aria-label="Close">
          ×
        </button>
      </div>
      <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" required className="mc-input" />
      <input value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="Author" className="mc-input" />
      <input type="number" min="1" value={pages} onChange={(e) => setPages(e.target.value)} placeholder="Total pages" className="mc-input" />
      <button type="submit" disabled={saving} className="mc-button mt-1 w-full">
        {saving ? "Shelving..." : "Put on shelf"}
      </button>
    </form>
  );
}
