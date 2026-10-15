import { useEffect, useState } from "react";
import { COLORS, DEFAULT_COLOR, addMonths, fmtDayLong, fmtDayShort, fmtTime, monthGrid, sameDay, startOfMonth } from "./calendarUtils";

/** Small month in the sidebar for jumping around. */
export function MiniMonth({ cursor, rangeStart, rangeEnd, onPick }) {
  const [month, setMonth] = useState(() => startOfMonth(cursor));
  const today = new Date();

  useEffect(() => {
    setMonth(startOfMonth(cursor));
  }, [cursor.getFullYear(), cursor.getMonth()]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <div className="mb-1 flex items-center justify-between px-1">
        <span className="text-sm font-semibold text-ink">{month.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</span>
        <div className="flex">
          <button onClick={() => setMonth((m) => addMonths(m, -1))} className="h-7 w-7 rounded-full text-surface-muted hover:bg-surface hover:text-ink" aria-label="Previous month">
            ‹
          </button>
          <button onClick={() => setMonth((m) => addMonths(m, 1))} className="h-7 w-7 rounded-full text-surface-muted hover:bg-surface hover:text-ink" aria-label="Next month">
            ›
          </button>
        </div>
      </div>
      <div className="grid grid-cols-7 text-center text-[10px] text-surface-muted">
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
          <span key={i} className="py-1">
            {d}
          </span>
        ))}
        {monthGrid(month).map((day) => {
          const inRange = day >= rangeStart && day <= rangeEnd;
          const isToday = sameDay(day, today);
          return (
            <button
              key={day.toDateString()}
              onClick={() => onPick(day)}
              className={`mx-auto my-px flex h-7 w-7 items-center justify-center rounded-full text-[11px] ${
                isToday
                  ? "bg-sky-500 font-semibold text-white"
                  : inRange
                    ? "bg-sky-500/15 text-sky-700"
                    : day.getMonth() === month.getMonth()
                      ? "text-ink hover:bg-surface"
                      : "text-surface-muted/60 hover:bg-surface"
              }`}
            >
              {day.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function ColorDots({ value, onChange, size = "h-5 w-5" }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {COLORS.map((c) => (
        <button
          key={c.value}
          type="button"
          title={c.name}
          onClick={() => onChange(c.value)}
          className={`${size} flex items-center justify-center rounded-full text-[10px] text-white transition-transform hover:scale-110`}
          style={{ background: c.value }}
        >
          {value === c.value ? "✓" : ""}
        </button>
      ))}
    </div>
  );
}

const clampToViewport = (x, y, w, h) => ({
  left: Math.max(8, Math.min(x + 12, window.innerWidth - w - 8)),
  top: Math.max(72, Math.min(y - 30, window.innerHeight - h - 8)),
});

/** Google-style quick create: title + Save, or "More options" to open the full editor. */
export function QuickCreate({ draft, onSave, onClose }) {
  const [title, setTitle] = useState("");
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [saving, setSaving] = useState(false);
  const pos = clampToViewport(draft.x, draft.y, 340, 230);

  const save = async (more) => {
    setSaving(true);
    await onSave({ title: title.trim() || "(No title)", color }, more);
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-[55]" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save(false);
        }}
        onKeyDown={(e) => e.key === "Escape" && onClose()}
        className="absolute w-[340px] animate-fade-in rounded-xl border border-surface-border bg-surface-card p-4 shadow-2xl shadow-black/60"
        style={pos}
      >
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Add title"
          className="mb-3 w-full border-b-2 border-surface-border bg-transparent pb-1.5 text-lg text-ink outline-none placeholder:text-surface-muted focus:border-sky-500"
        />
        <p className="mb-3 text-sm text-ink-soft">
          {draft.allDay ? `${fmtDayLong(draft.start)} · All day` : `${fmtDayShort(draft.start)} · ${fmtTime(draft.start)} – ${fmtTime(draft.end)}`}
        </p>
        <div className="mb-4">
          <ColorDots value={color} onChange={setColor} size="h-4 w-4" />
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => save(true)} disabled={saving} className="btn-secondary min-h-[36px] py-1.5 text-xs">
            More options
          </button>
          <button type="submit" disabled={saving} className="btn min-h-[36px] bg-sky-600 py-1.5 text-xs text-white hover:bg-sky-500">
            Save
          </button>
        </div>
      </form>
    </div>
  );
}

/** "This event / This and following / All events" for repeating events. */
export function ScopeDialog({ title, actionLabel = "Save", onChoose, onCancel, withFollowing = true }) {
  const [scope, setScope] = useState("this");
  const options = [
    ["this", "This event"],
    ...(withFollowing ? [["following", "This and following events"]] : []),
    ["all", "All events"],
  ];
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4" onPointerDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="w-full max-w-xs animate-fade-in rounded-xl border border-surface-border bg-surface-card p-5 shadow-2xl">
        <h3 className="mb-3 text-base">{title}</h3>
        <div className="mb-5 flex flex-col gap-2">
          {options.map(([value, label]) => (
            <label key={value} className="flex cursor-pointer items-center gap-2.5 text-sm text-ink">
              <input type="radio" name="scope" checked={scope === value} onChange={() => setScope(value)} className="h-4 w-4 accent-sky-500" />
              {label}
            </label>
          ))}
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="btn-secondary min-h-[36px] py-1.5 text-xs">
            Cancel
          </button>
          <button onClick={() => onChoose(scope)} className="btn min-h-[36px] bg-sky-600 py-1.5 text-xs text-white hover:bg-sky-500">
            {actionLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
