import { useState } from "react";
import { addDays, fmtTime, sameDay, startOfDay } from "./calendarUtils";

const MAX_CHIPS = 3;

/** Month grid: click a day to add an event, drag chips between days, "+N more" opens the day. */
export default function MonthView({ days, cursor, events, selectedId, onCreate, onSelect, onMoveToDay, onOpenDay, onToggleDone }) {
  const [dragId, setDragId] = useState(null);
  const [overDay, setOverDay] = useState(null);
  const today = new Date();

  const eventsOn = (day) =>
    events
      .filter((e) => sameDay(e.start, day))
      .sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start - b.start);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid grid-cols-7 border-b border-surface-border">
        {days.slice(0, 7).map((d) => (
          <div key={d.getDay()} className="py-2 text-center text-[11px] font-semibold uppercase tracking-wide text-surface-muted">
            {d.toLocaleDateString(undefined, { weekday: "short" })}
          </div>
        ))}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-6">
        {days.map((day) => {
          const list = eventsOn(day);
          const inMonth = day.getMonth() === cursor.getMonth();
          const isToday = sameDay(day, today);
          const key = day.toDateString();
          return (
            <div
              key={key}
              onClick={(e) => e.target === e.currentTarget && onCreate({ start: startOfDay(day), end: startOfDay(day), allDay: true, x: e.clientX, y: e.clientY })}
              onDragOver={(e) => {
                e.preventDefault();
                setOverDay(key);
              }}
              onDragLeave={() => setOverDay((k) => (k === key ? null : k))}
              onDrop={(e) => {
                e.preventDefault();
                setOverDay(null);
                const ev = events.find((x) => String(x.id) === e.dataTransfer.getData("text/plain"));
                if (ev && !sameDay(ev.start, day)) onMoveToDay(ev, day);
              }}
              className={`flex min-h-0 cursor-pointer flex-col gap-0.5 overflow-hidden border-b border-r border-surface-border/60 p-1 ${
                inMonth ? "" : "bg-black/[0.04]"
              } ${overDay === key ? "bg-sky-500/10" : ""}`}
            >
              <button
                onClick={() => onOpenDay(day)}
                className={`mx-auto flex h-6 min-w-[24px] items-center justify-center rounded-full px-1 text-xs ${
                  isToday ? "bg-sky-500 font-semibold text-white" : inMonth ? "text-ink hover:bg-surface" : "text-surface-muted hover:bg-surface"
                }`}
              >
                {day.getDate() === 1 ? day.toLocaleDateString(undefined, { month: "short", day: "numeric" }) : day.getDate()}
              </button>
              {list.slice(0, MAX_CHIPS).map((ev) => (
                <div
                  key={ev.id}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData("text/plain", String(ev.id));
                    setDragId(ev.id);
                  }}
                  onDragEnd={() => setDragId(null)}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelect(ev, { x: e.clientX, y: e.clientY });
                  }}
                  className={`flex cursor-pointer items-center gap-1 truncate rounded px-1 py-px text-[11px] ${
                    ev.allDay ? "font-medium text-white" : "text-ink hover:bg-surface"
                  } ${ev.completed ? "opacity-50 line-through" : ""} ${dragId === ev.id ? "opacity-40" : ""} ${
                    selectedId === ev.id ? "ring-1 ring-white/70" : ""
                  }`}
                  style={ev.allDay ? { background: ev.color } : undefined}
                  title={ev.title}
                >
                  {!ev.allDay && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleDone(ev);
                      }}
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ background: ev.completed ? "transparent" : ev.color, boxShadow: `inset 0 0 0 1.5px ${ev.color}` }}
                      title={ev.completed ? "Mark as not done" : "Mark as done"}
                    />
                  )}
                  {!ev.allDay && <span className="shrink-0 text-surface-muted">{fmtTime(ev.start)}</span>}
                  <span className="truncate">{ev.title || "(No title)"}</span>
                </div>
              ))}
              {list.length > MAX_CHIPS && (
                <button onClick={() => onOpenDay(day)} className="rounded px-1 text-left text-[11px] font-medium text-surface-muted hover:bg-surface hover:text-ink">
                  +{list.length - MAX_CHIPS} more
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Schedule (agenda): the next 30 days that have something on, grouped by day. */
export function ScheduleView({ cursor, events, selectedId, onSelect, onToggleDone, onOpenDay }) {
  const days = Array.from({ length: 31 }, (_, i) => addDays(cursor, i))
    .map((day) => ({ day, list: events.filter((e) => sameDay(e.start, day)).sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start - b.start) }))
    .filter((d) => d.list.length);
  const today = new Date();

  if (!days.length) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center text-sm text-surface-muted">
        Nothing planned for the next 30 days.
        <span className="text-xs">Press C or the Create button to add something.</span>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
      {days.map(({ day, list }) => (
        <div key={day.toDateString()} className="flex gap-3 border-b border-surface-border/50 py-2.5">
          <button onClick={() => onOpenDay(day)} className="flex w-24 shrink-0 items-start gap-2 text-left">
            <span className={`flex h-8 w-8 items-center justify-center rounded-full text-lg ${sameDay(day, today) ? "bg-sky-500 text-white" : "text-ink"}`}>
              {day.getDate()}
            </span>
            <span className="pt-1.5 text-[11px] uppercase text-surface-muted">{day.toLocaleDateString(undefined, { month: "short", weekday: "short" })}</span>
          </button>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            {list.map((ev) => (
              <div
                key={ev.id}
                onClick={(e) => onSelect(ev, { x: e.clientX, y: e.clientY })}
                className={`flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-surface ${selectedId === ev.id ? "bg-surface" : ""}`}
              >
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleDone(ev);
                  }}
                  className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] text-white"
                  style={{ background: ev.completed ? ev.color : "transparent", boxShadow: `inset 0 0 0 2px ${ev.color}` }}
                  title={ev.completed ? "Mark as not done" : "Mark as done"}
                >
                  {ev.completed ? "✓" : ""}
                </button>
                <span className="w-32 shrink-0 text-xs text-surface-muted">{ev.allDay ? "All day" : `${fmtTime(ev.start)} – ${fmtTime(ev.end)}`}</span>
                <span className={`min-w-0 flex-1 truncate text-sm ${ev.completed ? "text-surface-muted line-through" : "text-ink"}`}>
                  {ev.title || "(No title)"}
                </span>
                {ev.description?.trim() && <span className="text-xs text-surface-muted" title="Has a note">✎</span>}
                {ev.series_id && <span className="text-xs text-surface-muted" title="Repeats">↻</span>}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
