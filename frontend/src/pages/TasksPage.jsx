import { useCallback, useEffect, useMemo, useState } from "react";
import TimeGrid from "../components/Calendar/TimeGrid";
import MonthView, { ScheduleView } from "../components/Calendar/MonthView";
import EventPanel from "../components/Calendar/EventPanel";
import { MiniMonth, QuickCreate, ScopeDialog } from "../components/Calendar/CalendarParts";
import {
  addMinutes,
  atMinutes,
  minutesOfDay,
  rangeTitle,
  sameDay,
  shiftCursor,
  startOfDay,
  toEvent,
  toISODate,
  toLocalISO,
  viewRange,
} from "../components/Calendar/calendarUtils";
import { createTaskFull, deleteTaskScoped, getTasksRange, isCancel, updateTaskScoped } from "../services/api";
import { useToast } from "../context/ToastContext";
import { useOwnWindow } from "../desktop/WindowManager";
import { PlusIcon } from "../components/common/icons";
import ErrorMessage from "../components/common/ErrorMessage";

const VIEWS = [
  ["day", "Day", "D"],
  ["week", "Week", "W"],
  ["month", "Month", "M"],
  ["schedule", "Schedule", "A"],
];

function readView() {
  try {
    return localStorage.getItem("calendar.view") || "week";
  } catch {
    return "week";
  }
}

/** Tasks as a Google-Calendar-style calendar; every event carries its own note. */
export default function TasksPage() {
  const [view, setViewState] = useState(readView);
  const [cursor, setCursor] = useState(() => startOfDay(new Date()));
  const [tasks, setTasks] = useState([]);
  const [error, setError] = useState(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [selectedId, setSelectedId] = useState(null);
  const [draft, setDraft] = useState(null); // quick create
  const [pendingMove, setPendingMove] = useState(null); // repeating event dragged -> ask scope
  const { showToast } = useToast();
  const { active } = useOwnWindow();

  const setView = (v) => {
    setViewState(v);
    try {
      localStorage.setItem("calendar.view", v);
    } catch {
      // per-viewer preference only
    }
  };

  const range = useMemo(() => viewRange(view, cursor), [view, cursor]);
  const startKey = toISODate(range.start);
  const endKey = toISODate(range.end);

  useEffect(() => {
    const controller = new AbortController();
    getTasksRange(startKey, endKey, controller.signal)
      .then((rows) => {
        setTasks(rows);
        setError(null);
      })
      .catch((err) => !isCancel(err) && setError("Couldn't load your calendar. Is the backend running?"));
    return () => controller.abort();
  }, [startKey, endKey, reloadToken]);

  const reload = () => setReloadToken((t) => t + 1);
  const events = useMemo(() => tasks.map(toEvent), [tasks]);
  const selected = events.find((e) => e.id === selectedId) || null;

  // ----- mutations -----

  const create = async (data, openAfter) => {
    try {
      const created = await createTaskFull(data);
      setDraft(null);
      reload();
      if (openAfter) setSelectedId(created.id);
      else showToast(`Added "${created.title}"`);
    } catch {
      showToast("Couldn't create the event", "error");
    }
  };

  const patch = useCallback(async (event, changes, scope = "this") => {
    try {
      const updated = await updateTaskScoped(event.id, changes, scope);
      const local = scope === "this" && !("recurrence" in changes);
      if (local) setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
      else setReloadToken((t) => t + 1);
      return updated;
    } catch {
      showToast("Couldn't save the change", "error");
      return null;
    }
  }, [showToast]);

  const remove = async (event, scope) => {
    try {
      const res = await deleteTaskScoped(event.id, scope);
      setSelectedId(null);
      reload();
      showToast(res.deleted > 1 ? `Deleted ${res.deleted} events` : `Deleted "${event.title}"`);
    } catch {
      showToast("Couldn't delete the event", "error");
    }
  };

  const toggleDone = (event) => patch(event, { completed: !event.completed });

  const changeTime = (event, start, end) => {
    const changes = { scheduled_time: toLocalISO(start), end_time: toLocalISO(end) };
    if (event.series_id) setPendingMove({ event, changes });
    else patch(event, changes);
  };

  const moveToDay = (event, day) => {
    const changes = event.allDay
      ? { task_date: toISODate(day), ...(event.scheduled_time ? { scheduled_time: toLocalISO(atMinutes(day, minutesOfDay(event.start))) } : {}) }
      : (() => {
          const start = atMinutes(day, minutesOfDay(event.start));
          return { scheduled_time: toLocalISO(start), end_time: toLocalISO(addMinutes(start, (event.end - event.start) / 60000)) };
        })();
    if (event.series_id) setPendingMove({ event, changes });
    else patch(event, changes);
  };

  const openCreate = (slot) => {
    setSelectedId(null);
    setDraft(slot);
  };

  const saveDraft = (fields, more) =>
    create(
      draft.allDay
        ? { ...fields, all_day: true, task_date: toISODate(draft.start) }
        : { ...fields, all_day: false, scheduled_time: toLocalISO(draft.start), end_time: toLocalISO(draft.end) },
      more
    );

  const createNow = () => {
    const now = new Date();
    const start = atMinutes(startOfDay(sameDay(cursor, now) || view === "month" ? now : cursor), (now.getHours() + 1) * 60);
    openCreate({ start, end: addMinutes(start, 60), allDay: false, x: window.innerWidth / 2 - 170, y: window.innerHeight / 3 });
  };

  const openDay = (day) => {
    setCursor(startOfDay(day));
    setView("day");
  };

  // ----- Google Calendar keyboard shortcuts -----
  useEffect(() => {
    const onKey = (e) => {
      if (!active || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      if (t.closest?.("input, textarea, select, [contenteditable=true]")) return;
      const key = e.key.toLowerCase();
      const views = { d: "day", w: "week", m: "month", a: "schedule" };
      if (views[key]) setView(views[key]);
      else if (key === "t") setCursor(startOfDay(new Date()));
      else if (key === "j" || key === "n") setCursor((c) => shiftCursor(view, c, 1));
      else if (key === "k" || key === "p") setCursor((c) => shiftCursor(view, c, -1));
      else if (key === "c") {
        e.preventDefault();
        createNow();
      } else if (key === "escape") {
        setDraft(null);
        setSelectedId(null);
      } else return;
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const todays = events.filter((e) => sameDay(e.start, new Date()));
  const todayDone = todays.filter((e) => e.completed).length;
  const upcoming = events
    .filter((e) => e.start >= new Date() && !e.completed)
    .sort((a, b) => a.start - b.start)
    .slice(0, 5);

  const viewProps = {
    events,
    selectedId,
    onSelect: (ev) => {
      setDraft(null);
      setSelectedId(ev.id);
    },
    onToggleDone: toggleDone,
    onOpenDay: openDay,
  };

  return (
    <div className="flex h-full min-h-[520px] gap-3">
      {/* sidebar */}
      <aside className="hidden w-60 shrink-0 flex-col gap-5 lg:flex">
        <button
          onClick={createNow}
          className="flex w-fit items-center gap-3 rounded-2xl bg-surface-card px-5 py-3.5 text-sm font-medium text-ink shadow-lg shadow-black/30 ring-1 ring-surface-border transition-shadow hover:shadow-xl hover:ring-sky-500/60"
          title="Create (C)"
        >
          <PlusIcon className="h-6 w-6 text-sky-400" /> Create
        </button>
        <MiniMonth cursor={cursor} rangeStart={range.start} rangeEnd={view === "schedule" || view === "month" ? range.start : range.end} onPick={(d) => setCursor(startOfDay(d))} />
        <div className="rounded-xl bg-surface-card p-3 ring-1 ring-surface-border">
          <div className="mb-1 flex justify-between text-xs">
            <span className="font-semibold text-ink">Today</span>
            <span className="text-surface-muted">
              {todayDone}/{todays.length} done
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-surface">
            <div className="h-1.5 rounded-full bg-tasks transition-all" style={{ width: `${todays.length ? (todayDone / todays.length) * 100 : 0}%` }} />
          </div>
          {upcoming.length > 0 && (
            <div className="mt-3 flex flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-surface-muted">Coming up</span>
              {upcoming.map((ev) => (
                <button key={ev.id} onClick={() => setSelectedId(ev.id)} className="flex items-center gap-2 truncate rounded px-1 py-0.5 text-left text-xs text-ink-soft hover:bg-surface">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: ev.color }} />
                  <span className="truncate">{ev.title}</span>
                  <span className="ml-auto shrink-0 text-surface-muted">
                    {ev.allDay ? ev.start.toLocaleDateString(undefined, { month: "short", day: "numeric" }) : ev.start.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
        <p className="mt-auto text-[11px] leading-relaxed text-surface-muted">
          Shortcuts: <b className="text-ink-soft">C</b> create · <b className="text-ink-soft">T</b> today · <b className="text-ink-soft">D/W/M/A</b> views ·{" "}
          <b className="text-ink-soft">J/K</b> next/prev
        </p>
      </aside>

      {/* calendar */}
      <section className="card relative flex min-w-0 flex-1 flex-col overflow-hidden p-0">
        <header className="flex flex-wrap items-center gap-2 border-b border-surface-border px-3 py-2.5">
          <button onClick={() => setCursor(startOfDay(new Date()))} className="btn-secondary min-h-[34px] rounded-full px-4 py-1 text-xs" title="Today (T)">
            Today
          </button>
          <button onClick={() => setCursor((c) => shiftCursor(view, c, -1))} className="h-8 w-8 rounded-full text-lg text-ink-soft hover:bg-surface" aria-label="Previous (K)">
            ‹
          </button>
          <button onClick={() => setCursor((c) => shiftCursor(view, c, 1))} className="h-8 w-8 rounded-full text-lg text-ink-soft hover:bg-surface" aria-label="Next (J)">
            ›
          </button>
          <h2 className="ml-1 text-lg font-semibold text-ink">{rangeTitle(view, cursor)}</h2>
          <button onClick={createNow} className="btn ml-auto min-h-[34px] bg-sky-600 px-3 py-1 text-xs text-white hover:bg-sky-500 lg:hidden">
            + Create
          </button>
          <div className="flex rounded-lg bg-surface p-0.5 lg:ml-auto">
            {VIEWS.map(([id, text, key]) => (
              <button
                key={id}
                onClick={() => setView(id)}
                title={`${text} (${key})`}
                className={`rounded-md px-3 py-1 text-xs font-medium ${view === id ? "bg-surface-card text-ink shadow" : "text-surface-muted hover:text-ink"}`}
              >
                {text}
              </button>
            ))}
          </div>
        </header>

        {error && (
          <div className="p-3">
            <ErrorMessage message={error} />
          </div>
        )}

        {view === "day" || view === "week" ? (
          <TimeGrid
            key={view}
            days={range.days}
            {...viewProps}
            onCreate={openCreate}
            onChangeTime={changeTime}
          />
        ) : view === "month" ? (
          <MonthView days={range.days} cursor={cursor} {...viewProps} onCreate={openCreate} onMoveToDay={moveToDay} />
        ) : (
          <ScheduleView cursor={range.start} {...viewProps} />
        )}

        {selected && (
          <EventPanel event={selected} onClose={() => setSelectedId(null)} onPatch={patch} onDelete={remove} onToggleDone={toggleDone} />
        )}
      </section>

      {draft && <QuickCreate draft={draft} onSave={saveDraft} onClose={() => setDraft(null)} />}

      {pendingMove && (
        <ScopeDialog
          title="Move repeating event"
          actionLabel="Move"
          onCancel={() => setPendingMove(null)}
          onChoose={(scope) => {
            patch(pendingMove.event, pendingMove.changes, scope);
            setPendingMove(null);
          }}
        />
      )}
    </div>
  );
}
