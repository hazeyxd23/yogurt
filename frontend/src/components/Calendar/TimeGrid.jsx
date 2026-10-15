import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  HOUR_HEIGHT,
  SNAP_MINUTES,
  addMinutes,
  atMinutes,
  fmtHour,
  fmtTime,
  layoutDay,
  minutesOfDay,
  sameDay,
  snap,
} from "./calendarUtils";

function useNow(intervalMs = 60000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

const capture = (el, id) => {
  try {
    el.setPointerCapture(id);
  } catch {
    // pointer already gone
  }
};

function DoneToggle({ event, onToggleDone }) {
  return (
    <button
      type="button"
      data-nodrag
      onClick={(e) => {
        e.stopPropagation();
        onToggleDone(event);
      }}
      title={event.completed ? "Mark as not done" : "Mark as done"}
      className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border text-[8px] leading-none ${
        event.completed ? "border-white bg-white text-slate-800" : "border-white/70 hover:bg-white/20"
      }`}
    >
      {event.completed ? "✓" : ""}
    </button>
  );
}

/**
 * Day / week time grid. Drag on empty space to create, drag an event to move it
 * (across days too), drag its bottom edge to change the end time, click to open it.
 */
export default function TimeGrid({ days, events, selectedId, onCreate, onSelect, onChangeTime, onToggleDone, onOpenDay }) {
  const scrollRef = useRef(null);
  const colRefs = useRef([]);
  const gridRef = useRef(null);
  const [drag, setDrag] = useState(null);
  const dragRef = useRef(null);
  const now = useNow();

  const setDragState = (d) => {
    dragRef.current = d;
    setDrag(d);
  };

  // Open around the current time, like Google Calendar.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = Math.max(0, (new Date().getHours() - 1.5) * HOUR_HEIGHT);
  }, []);

  const timed = events.filter((e) => !e.allDay);
  const allDay = events.filter((e) => e.allDay);

  const pointerMinutes = (clientY, dayIndex) => {
    const rect = colRefs.current[dayIndex].getBoundingClientRect();
    return Math.max(0, Math.min(24 * 60, ((clientY - rect.top) / HOUR_HEIGHT) * 60));
  };

  const dayIndexAt = (clientX) => {
    const idx = colRefs.current.findIndex((el) => {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return clientX >= r.left && clientX < r.right;
    });
    if (idx !== -1) return idx;
    const first = colRefs.current[0]?.getBoundingClientRect();
    return first && clientX < first.left ? 0 : days.length - 1;
  };

  // ----- pointer handling -----

  const onColumnDown = (e, dayIndex) => {
    if (e.button !== 0 || e.target !== e.currentTarget) return;
    const m = snap(pointerMinutes(e.clientY, dayIndex), 30);
    setDragState({ type: "create", dayIndex, anchor: m, start: m, end: m + 60, moved: false, x: e.clientX, y: e.clientY });
    capture(gridRef.current, e.pointerId);
  };

  const onEventDown = (e, event) => {
    if (e.button !== 0 || e.target.closest("[data-nodrag]")) return;
    e.stopPropagation();
    const dayIndex = days.findIndex((d) => sameDay(d, event.start));
    const resize = Boolean(e.target.closest("[data-resize]"));
    const m = pointerMinutes(e.clientY, Math.max(0, dayIndex));
    setDragState({
      type: resize ? "resize" : "move",
      event,
      dayIndex: Math.max(0, dayIndex),
      grabOffset: m - minutesOfDay(event.start),
      start: event.start,
      end: event.end,
      moved: false,
      x: e.clientX,
      y: e.clientY,
    });
    capture(gridRef.current, e.pointerId);
  };

  const onPointerMove = (e) => {
    const d = dragRef.current;
    if (!d) return;
    const moved = d.moved || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4;
    if (d.type === "create") {
      const m = snap(pointerMinutes(e.clientY, d.dayIndex));
      const start = Math.min(d.anchor, m);
      const end = Math.max(d.anchor + SNAP_MINUTES, m);
      setDragState({ ...d, start, end, moved });
    } else if (d.type === "move") {
      const dayIndex = dayIndexAt(e.clientX);
      const duration = (d.event.end - d.event.start) / 60000;
      const startMin = Math.max(0, Math.min(24 * 60 - SNAP_MINUTES, snap(pointerMinutes(e.clientY, dayIndex) - d.grabOffset)));
      const start = atMinutes(days[dayIndex], startMin);
      setDragState({ ...d, dayIndex, start, end: addMinutes(start, duration), moved });
    } else if (d.type === "resize") {
      const endMin = Math.max(minutesOfDay(d.event.start) + SNAP_MINUTES, snap(pointerMinutes(e.clientY, d.dayIndex)));
      setDragState({ ...d, end: atMinutes(days[d.dayIndex], endMin), moved });
    }
  };

  const onPointerUp = (e) => {
    const d = dragRef.current;
    setDragState(null);
    if (!d) return;
    if (d.type === "create") {
      const day = days[d.dayIndex];
      onCreate({
        start: atMinutes(day, d.moved ? d.start : d.anchor),
        end: atMinutes(day, d.moved ? d.end : d.anchor + 60),
        allDay: false,
        x: e.clientX,
        y: e.clientY,
      });
    } else if (!d.moved) {
      onSelect(d.event, { x: e.clientX, y: e.clientY });
    } else if (d.start.getTime() !== d.event.start.getTime() || d.end.getTime() !== d.event.end.getTime()) {
      onChangeTime(d.event, d.start, d.end);
    }
  };

  const nowMinutes = minutesOfDay(now);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* day headers + all-day row */}
      <div className="flex border-b border-surface-border pr-[10px]">
        <div className="w-14 shrink-0" />
        {days.map((day, i) => {
          const isToday = sameDay(day, now);
          return (
            <div key={i} className="min-w-0 flex-1 border-l border-surface-border/60 px-1 pb-1 pt-2 text-center">
              <div className={`text-[11px] font-semibold uppercase tracking-wide ${isToday ? "text-sky-400" : "text-surface-muted"}`}>
                {day.toLocaleDateString(undefined, { weekday: "short" })}
              </div>
              <button
                onClick={() => onOpenDay(day)}
                className={`mx-auto mt-0.5 flex h-10 w-10 items-center justify-center rounded-full text-xl ${
                  isToday ? "bg-sky-500 font-semibold text-white" : "text-ink hover:bg-surface"
                }`}
              >
                {day.getDate()}
              </button>
              <div
                className="mt-1 flex min-h-[22px] cursor-pointer flex-col gap-0.5"
                onClick={(e) => e.target === e.currentTarget && onCreate({ start: day, end: day, allDay: true, x: e.clientX, y: e.clientY })}
                title="Add an all-day event"
              >
                {allDay
                  .filter((ev) => sameDay(ev.start, day))
                  .map((ev) => (
                    <button
                      key={ev.id}
                      onClick={(e) => onSelect(ev, { x: e.clientX, y: e.clientY })}
                      className={`flex items-center gap-1 truncate rounded px-1.5 py-0.5 text-left text-[11px] font-medium text-white ${ev.completed ? "opacity-50 line-through" : ""} ${
                        selectedId === ev.id ? "ring-2 ring-white/70" : ""
                      }`}
                      style={{ background: ev.color }}
                    >
                      <span className="truncate">{ev.title}</span>
                    </button>
                  ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* hours */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div
          ref={gridRef}
          className="relative flex select-none"
          style={{ height: 24 * HOUR_HEIGHT }}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => setDragState(null)}
        >
          <div className="relative w-14 shrink-0">
            {Array.from({ length: 23 }, (_, h) => (
              <span key={h} className="absolute right-2 -translate-y-1/2 text-[10px] text-surface-muted" style={{ top: (h + 1) * HOUR_HEIGHT }}>
                {fmtHour(h + 1)}
              </span>
            ))}
          </div>

          {days.map((day, dayIndex) => {
            const isToday = sameDay(day, now);
            const placed = layoutDay(timed.filter((ev) => sameDay(ev.start, day)));
            return (
              <div
                key={dayIndex}
                ref={(el) => (colRefs.current[dayIndex] = el)}
                className="cal-column relative min-w-0 flex-1 border-l border-surface-border/60"
                onPointerDown={(e) => onColumnDown(e, dayIndex)}
              >
                {placed.map(({ event, col, cols }) => {
                  const dragging = drag && drag.type !== "create" && drag.event.id === event.id && drag.moved;
                  const top = (minutesOfDay(event.start) / 60) * HOUR_HEIGHT;
                  const height = Math.max(18, ((event.end - event.start) / 3600000) * HOUR_HEIGHT - 2);
                  const short = height < 36;
                  return (
                    <div
                      key={event.id}
                      onPointerDown={(e) => onEventDown(e, event)}
                      className={`cal-event absolute overflow-hidden rounded-md px-1.5 py-0.5 text-white ${dragging ? "opacity-30" : ""} ${
                        event.completed ? "cal-event-done" : ""
                      } ${selectedId === event.id ? "ring-2 ring-white/80" : ""}`}
                      style={{
                        top,
                        height,
                        left: `calc(${(col / cols) * 100}% + 1px)`,
                        width: `calc(${100 / cols}% - 3px)`,
                        background: event.color,
                      }}
                    >
                      <div className={`flex gap-1 ${short ? "items-center" : "items-start"}`}>
                        <span className={`min-w-0 flex-1 text-[11px] font-semibold leading-tight ${short ? "truncate" : "line-clamp-2"}`}>
                          {event.title || "(No title)"}
                          {short && <span className="ml-1 font-normal opacity-80">{fmtTime(event.start)}</span>}
                        </span>
                        <DoneToggle event={event} onToggleDone={onToggleDone} />
                      </div>
                      {!short && (
                        <div className="text-[10px] opacity-85">
                          {fmtTime(event.start)} – {fmtTime(event.end)}
                          {event.description?.trim() && <span title="Has a note"> · ✎</span>}
                          {event.series_id && <span title="Repeats"> · ↻</span>}
                        </div>
                      )}
                      <div data-resize className="absolute inset-x-0 bottom-0 h-1.5 cursor-ns-resize" />
                    </div>
                  );
                })}

                {/* the event being created / moved / resized */}
                {drag && (drag.type === "create" ? drag.dayIndex === dayIndex : drag.moved && drag.dayIndex === dayIndex) && (
                  <div
                    className="pointer-events-none absolute left-0.5 right-1 z-10 rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-white shadow-lg ring-2 ring-white/60"
                    style={(() => {
                      const startMin = drag.type === "create" ? drag.start : minutesOfDay(drag.start);
                      const endMin = drag.type === "create" ? drag.end : minutesOfDay(drag.end) || 24 * 60;
                      return {
                        top: (startMin / 60) * HOUR_HEIGHT,
                        height: Math.max(18, ((endMin - startMin) / 60) * HOUR_HEIGHT - 2),
                        background: drag.type === "create" ? "#039be5" : drag.event.color,
                      };
                    })()}
                  >
                    {drag.type === "create" ? "(No title)" : drag.event.title}
                    <div className="text-[10px] font-normal opacity-90">
                      {drag.type === "create"
                        ? `${fmtTime(atMinutes(day, drag.start))} – ${fmtTime(atMinutes(day, drag.end))}`
                        : `${fmtTime(drag.start)} – ${fmtTime(drag.end)}`}
                    </div>
                  </div>
                )}

                {isToday && (
                  <div className="pointer-events-none absolute inset-x-0 z-20" style={{ top: (nowMinutes / 60) * HOUR_HEIGHT }}>
                    <div className="absolute -left-1.5 -top-1.5 h-3 w-3 rounded-full bg-red-500" />
                    <div className="h-0.5 bg-red-500" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
