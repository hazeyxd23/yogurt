// Date helpers for the calendar. Everything is local time; the API stores naive
// local datetimes ("2026-10-08T09:00:00") so no timezone conversion happens anywhere.

export const HOUR_HEIGHT = 48; // px per hour in day/week views
export const SNAP_MINUTES = 15;

export const COLORS = [
  { name: "Tomato", value: "#d50000" },
  { name: "Flamingo", value: "#e67c73" },
  { name: "Tangerine", value: "#f4511e" },
  { name: "Banana", value: "#f6bf26" },
  { name: "Sage", value: "#33b679" },
  { name: "Basil", value: "#0b8043" },
  { name: "Peacock", value: "#039be5" },
  { name: "Blueberry", value: "#3f51b5" },
  { name: "Lavender", value: "#7986cb" },
  { name: "Grape", value: "#8e24aa" },
  { name: "Graphite", value: "#616161" },
];
export const DEFAULT_COLOR = "#33b679";

const pad = (n) => String(n).padStart(2, "0");

export const toISODate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const toLocalISO = (d) => `${toISODate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
export const parseLocal = (s) => (s ? new Date(s.length === 10 ? `${s}T00:00:00` : s) : null);

export const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes());
export const addMinutes = (d, n) => new Date(d.getTime() + n * 60000);
export const addMonths = (d, n) => new Date(d.getFullYear(), d.getMonth() + n, 1);
export const startOfWeek = (d) => addDays(startOfDay(d), -startOfDay(d).getDay()); // weeks start on Sunday
export const startOfMonth = (d) => new Date(d.getFullYear(), d.getMonth(), 1);
export const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
export const minutesOfDay = (d) => d.getHours() * 60 + d.getMinutes();
export const atMinutes = (day, minutes) => new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, minutes);
export const snap = (minutes, step = SNAP_MINUTES) => Math.round(minutes / step) * step;

export const fmtTime = (d) => d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
export const fmtHour = (h) => new Date(2000, 0, 1, h).toLocaleTimeString([], { hour: "numeric" });
export const fmtDayLong = (d) => d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
export const fmtDayShort = (d) => d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });

/** The 6-week grid shown in month views (starts on the Sunday before the 1st). */
export function monthGrid(d) {
  const first = startOfWeek(startOfMonth(d));
  return Array.from({ length: 42 }, (_, i) => addDays(first, i));
}

/** Days and fetch range for a view around the cursor date. */
export function viewRange(view, cursor) {
  if (view === "day") return { start: startOfDay(cursor), end: startOfDay(cursor), days: [startOfDay(cursor)] };
  if (view === "week") {
    const start = startOfWeek(cursor);
    return { start, end: addDays(start, 6), days: Array.from({ length: 7 }, (_, i) => addDays(start, i)) };
  }
  if (view === "month") {
    const days = monthGrid(cursor);
    return { start: days[0], end: days[41], days };
  }
  const start = startOfDay(cursor);
  return { start, end: addDays(start, 30), days: Array.from({ length: 31 }, (_, i) => addDays(start, i)) };
}

export function shiftCursor(view, cursor, dir) {
  if (view === "day") return addDays(cursor, dir);
  if (view === "week") return addDays(cursor, dir * 7);
  if (view === "month") return addMonths(cursor, dir);
  return addDays(cursor, dir * 30);
}

export function rangeTitle(view, cursor) {
  if (view === "day") return cursor.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
  if (view === "week") {
    const s = startOfWeek(cursor);
    const e = addDays(s, 6);
    if (s.getMonth() === e.getMonth()) return s.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    return `${s.toLocaleDateString(undefined, { month: "short" })} – ${e.toLocaleDateString(undefined, { month: "short", year: "numeric" })}`;
  }
  return cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

/** A task row from the API as a calendar event with real Dates. */
export function toEvent(task) {
  const allDay = Boolean(task.all_day) || !task.scheduled_time;
  const start = task.scheduled_time ? parseLocal(task.scheduled_time) : parseLocal(task.task_date);
  let end = task.end_time ? parseLocal(task.end_time) : null;
  if (!allDay && (!end || end <= start)) end = addMinutes(start, 60);
  return { ...task, allDay, start, end: allDay ? start : end, color: task.color || DEFAULT_COLOR };
}

/**
 * Side-by-side columns for overlapping events in one day (like Google Calendar).
 * Returns [{ event, col, cols }].
 */
export function layoutDay(events) {
  const sorted = [...events].sort((a, b) => a.start - b.start || b.end - a.end);
  const out = [];
  let cluster = [];
  let clusterEnd = 0;
  const flush = () => {
    const columnEnds = [];
    const placed = cluster.map((e) => {
      let col = columnEnds.findIndex((end) => end <= e.start);
      if (col === -1) {
        col = columnEnds.length;
        columnEnds.push(e.end);
      } else {
        columnEnds[col] = e.end;
      }
      return { event: e, col };
    });
    placed.forEach((p) => out.push({ ...p, cols: columnEnds.length }));
    cluster = [];
    clusterEnd = 0;
  };
  for (const e of sorted) {
    if (cluster.length && e.start >= clusterEnd) flush();
    cluster.push(e);
    clusterEnd = Math.max(clusterEnd, e.end);
  }
  if (cluster.length) flush();
  return out;
}

export function recurrenceOptions(date) {
  const weekday = date.toLocaleDateString(undefined, { weekday: "long" });
  return [
    { value: "none", label: "Does not repeat" },
    { value: "daily", label: "Daily" },
    { value: "weekdays", label: "Every weekday (Mon–Fri)" },
    { value: "weekly", label: `Weekly on ${weekday}` },
    { value: "monthly", label: `Monthly on day ${date.getDate()}` },
  ];
}
