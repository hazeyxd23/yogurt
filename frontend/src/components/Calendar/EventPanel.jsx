import { useEffect, useRef, useState } from "react";
import NoteEditor from "../Notes/NoteEditor";
import { ColorDots } from "./CalendarParts";
import { addMinutes, atMinutes, fmtDayLong, minutesOfDay, parseLocal, recurrenceOptions, toISODate, toLocalISO } from "./calendarUtils";
import { TrashIcon } from "../common/icons";

const hhmm = (d) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
const toMinutes = (v) => {
  const [h, m] = v.split(":").map(Number);
  return h * 60 + m;
};

const PRIORITIES = [
  [1, "High", "bg-red-500/20 text-red-700 ring-red-400/50"],
  [2, "Medium", "bg-amber-500/20 text-amber-700 ring-amber-400/50"],
  [3, "Low", "bg-slate-500/20 text-ink-soft ring-slate-400/50"],
];

/**
 * Side panel for one event. The event's description is a full note (tick markers,
 * [[links]], headings...). For repeating events, field changes can apply to just this
 * event or the whole series; notes always belong to the single event.
 */
export default function EventPanel({ event, onClose, onPatch, onDelete, onToggleDone }) {
  const [title, setTitle] = useState(event.title);
  const [note, setNote] = useState(event.description || "");
  const [scope, setScope] = useState("this");
  const [deleting, setDeleting] = useState(false);
  const titleTimer = useRef(null);
  const noteTimer = useRef(null);
  const pending = useRef({});
  const eventRef = useRef(event);
  eventRef.current = event;

  // Push any unsaved typing when switching events or closing - to the event it was typed in.
  const flush = (target = eventRef.current) => {
    clearTimeout(titleTimer.current);
    clearTimeout(noteTimer.current);
    const { title: t, note: n, scope: s } = pending.current;
    pending.current = {};
    if (t !== undefined) onPatch(target, { title: t.trim() || "(No title)" }, s);
    if (n !== undefined) onPatch(target, { description: n }, "this");
  };

  useEffect(() => {
    const shown = event;
    setTitle(event.title);
    setNote(event.description || "");
    setScope("this");
    setDeleting(false);
    return () => flush(shown);
  }, [event.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const series = Boolean(event.series_id);
  const applyScope = series ? scope : "this";

  const changeTitle = (v) => {
    setTitle(v);
    pending.current = { ...pending.current, title: v, scope: applyScope };
    clearTimeout(titleTimer.current);
    titleTimer.current = setTimeout(() => {
      const { title: t, scope: s } = pending.current;
      delete pending.current.title;
      if (t !== undefined) onPatch(eventRef.current, { title: t.trim() || "(No title)" }, s);
    }, 600);
  };

  const changeNote = (v) => {
    setNote(v);
    pending.current = { ...pending.current, note: v };
    clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => {
      const n = pending.current.note;
      delete pending.current.note;
      if (n !== undefined) onPatch(eventRef.current, { description: n }, "this");
    }, 700);
  };

  // ----- date & time -----

  const setDate = (value) => {
    if (!value) return;
    const day = parseLocal(value);
    if (event.allDay) {
      onPatch(event, { task_date: value, ...(event.scheduled_time ? { scheduled_time: toLocalISO(atMinutes(day, minutesOfDay(event.start))) } : {}) }, applyScope);
      return;
    }
    const start = atMinutes(day, minutesOfDay(event.start));
    const end = addMinutes(start, (event.end - event.start) / 60000);
    onPatch(event, { scheduled_time: toLocalISO(start), end_time: toLocalISO(end) }, applyScope);
  };

  const setStartTime = (value) => {
    if (!value) return;
    const duration = (event.end - event.start) / 60000;
    const start = atMinutes(event.start, toMinutes(value));
    onPatch(event, { scheduled_time: toLocalISO(start), end_time: toLocalISO(addMinutes(start, duration)) }, applyScope);
  };

  const setEndTime = (value) => {
    if (!value) return;
    let end = atMinutes(event.start, toMinutes(value));
    if (end <= event.start) end = addMinutes(event.start, 15);
    onPatch(event, { end_time: toLocalISO(end) }, applyScope);
  };

  const setAllDay = (allDay) => {
    if (allDay) {
      onPatch(event, { all_day: true }, applyScope);
      return;
    }
    const start = event.scheduled_time ? event.start : atMinutes(event.start, 9 * 60);
    onPatch(event, { all_day: false, scheduled_time: toLocalISO(start), end_time: toLocalISO(addMinutes(start, 60)) }, applyScope);
  };

  const label = "mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-surface-muted";

  return (
    <aside className="absolute inset-y-0 right-0 z-30 flex w-full max-w-md animate-slide-in flex-col border-l border-surface-border bg-surface-card shadow-2xl shadow-black/50">
      <div className="flex items-center gap-2 border-b border-surface-border px-4 py-2.5">
        <span className="h-3 w-3 rounded-full" style={{ background: event.color }} />
        <span className="flex-1 text-xs text-surface-muted">{event.allDay ? fmtDayLong(event.start) : `${fmtDayLong(event.start)}`}</span>
        <button
          onClick={() => onToggleDone(event)}
          className={`rounded-md px-2 py-1 text-xs font-medium ${event.completed ? "bg-emerald-500/20 text-emerald-700" : "text-surface-muted hover:bg-surface hover:text-ink"}`}
          title="Mark as done"
        >
          {event.completed ? "✓ Done" : "Mark done"}
        </button>
        <button onClick={() => setDeleting((v) => !v)} className="rounded-md p-1.5 text-surface-muted hover:bg-red-500/15 hover:text-red-700" title="Delete">
          <TrashIcon className="h-4 w-4" />
        </button>
        <button
          onClick={() => {
            flush();
            onClose();
          }}
          className="rounded-md px-2 text-lg leading-none text-surface-muted hover:text-ink"
          aria-label="Close"
        >
          ×
        </button>
      </div>

      {deleting && (
        <div className="flex animate-fade-in flex-wrap items-center gap-2 border-b border-surface-border bg-red-500/10 px-4 py-2.5 text-xs">
          <span className="text-red-700">Delete {series ? "" : "this event?"}</span>
          {series ? (
            <>
              <button onClick={() => onDelete(event, "this")} className="rounded-md bg-red-600 px-2 py-1 font-medium text-white hover:bg-red-500">
                This event
              </button>
              <button onClick={() => onDelete(event, "following")} className="rounded-md bg-red-600/80 px-2 py-1 font-medium text-white hover:bg-red-500">
                This & following
              </button>
              <button onClick={() => onDelete(event, "all")} className="rounded-md bg-red-600/60 px-2 py-1 font-medium text-white hover:bg-red-500">
                All events
              </button>
            </>
          ) : (
            <button onClick={() => onDelete(event, "this")} className="rounded-md bg-red-600 px-2 py-1 font-medium text-white hover:bg-red-500">
              Delete
            </button>
          )}
          <button onClick={() => setDeleting(false)} className="ml-auto text-surface-muted hover:text-ink">
            Cancel
          </button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <input
          value={title}
          onChange={(e) => changeTitle(e.target.value)}
          placeholder="Add title"
          className={`mb-4 w-full border-b-2 border-transparent bg-transparent pb-1 text-xl font-semibold text-ink outline-none placeholder:text-surface-muted focus:border-sky-500 ${
            event.completed ? "line-through decoration-slate-500" : ""
          }`}
        />

        {series && (
          <div className="mb-4 flex items-center gap-2 rounded-lg bg-surface px-3 py-2 text-xs text-ink-soft">
            <span className="text-surface-muted">↻ Changes apply to</span>
            {[
              ["this", "this event"],
              ["following", "this & following"],
              ["all", "all events"],
            ].map(([value, text]) => (
              <button
                key={value}
                onClick={() => setScope(value)}
                className={`rounded-md px-2 py-0.5 ${scope === value ? "bg-sky-500/25 text-ink ring-1 ring-sky-400/60" : "hover:text-ink"}`}
              >
                {text}
              </button>
            ))}
          </div>
        )}

        <div className="mb-4 grid grid-cols-[1fr_auto] items-end gap-3">
          <div>
            <span className={label}>Date</span>
            <input type="date" value={toISODate(event.start)} onChange={(e) => setDate(e.target.value)} className="input min-h-[38px] py-1.5 [color-scheme:dark]" />
          </div>
          <label className="flex cursor-pointer items-center gap-2 pb-2 text-sm text-ink">
            <input type="checkbox" checked={event.allDay} onChange={(e) => setAllDay(e.target.checked)} className="h-4 w-4 accent-sky-500" />
            All day
          </label>
        </div>

        {!event.allDay && (
          <div className="mb-4 flex items-center gap-2">
            <input type="time" step="900" value={hhmm(event.start)} onChange={(e) => setStartTime(e.target.value)} className="input min-h-[38px] py-1.5 [color-scheme:dark]" />
            <span className="text-surface-muted">–</span>
            <input type="time" step="900" value={hhmm(event.end)} onChange={(e) => setEndTime(e.target.value)} className="input min-h-[38px] py-1.5 [color-scheme:dark]" />
          </div>
        )}

        <div className="mb-4">
          <span className={label}>Repeat</span>
          <select
            value={event.recurrence || "none"}
            onChange={(e) => onPatch(event, { recurrence: e.target.value }, applyScope)}
            className="input min-h-[38px] py-1.5"
          >
            {recurrenceOptions(event.start).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <span className={label}>Color</span>
            <ColorDots value={event.color} onChange={(color) => onPatch(event, { color }, applyScope)} size="h-5 w-5" />
          </div>
          <div>
            <span className={label}>Priority</span>
            <div className="flex gap-1">
              {PRIORITIES.map(([value, text, style]) => (
                <button
                  key={value}
                  onClick={() => onPatch(event, { priority: value }, applyScope)}
                  className={`rounded-md px-2 py-1 text-xs font-medium ${event.priority === value ? `${style} ring-1` : "bg-surface text-surface-muted hover:text-ink"}`}
                >
                  {text}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="border-t border-surface-border pt-3">
          <span className={label}>Note{series ? " (just this event)" : ""}</span>
          <NoteEditor
            value={note}
            onChange={changeNote}
            placeholder="Write anything - - [ ] for a checklist, [[Note]] to link a note"
            className="min-h-[180px]"
          />
        </div>
      </div>
    </aside>
  );
}
