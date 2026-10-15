import { useMemo, useState } from "react";

// ---------- Key pools ----------
// Circle-of-fifths order; the 15-key lists include both spellings of the three
// enharmonic pairs, the 12-key lists fold each pair into one "X/Y" entry.
const MAJORS_15 = ["C", "G", "D", "A", "E", "B", "F#", "C#", "F", "Bb", "Eb", "Ab", "Db", "Gb", "Cb"];
const MAJORS_12 = ["C", "G", "D", "A", "E", "B/Cb", "F#/Gb", "C#/Db", "F", "Bb", "Eb", "Ab"];
const MINORS_15 = ["A", "E", "B", "F#", "C#", "G#", "D#", "A#", "D", "G", "C", "F", "Bb", "Eb", "Ab"];
const MINORS_12 = ["A", "E", "B", "F#", "C#", "G#/Ab", "D#/Eb", "A#/Bb", "D", "G", "C", "F"];
const KEYS_12 = ["C", "C#/Db", "D", "D#/Eb", "E", "F", "F#/Gb", "G", "G#/Ab", "A", "A#/Bb", "B"];

const MINOR_GRID = ["C", "C#", "D", "D#", "Eb", "E", "F", "F#", "G", "G#", "Ab", "A", "A#", "Bb", "B"];
const CUSTOM_ROWS = [
  { quality: "major", label: "Major", keys: ["C", "C#", "Db", "D", "Eb", "E", "F", "F#", "Gb", "G", "Ab", "A", "Bb", "B", "Cb"] },
  { quality: "harmonic", label: "Harmonic minor", keys: MINOR_GRID },
  { quality: "melodic", label: "Melodic minor", keys: MINOR_GRID },
];

const MODES = [
  { id: "keys", label: "Keys" },
  { id: "major", label: "Major" },
  { id: "minor", label: "Minor" },
  { id: "majorMinor", label: "Major + Minor" },
  { id: "all", label: "Maj + Harm + Mel" },
];
const MIXED_MODES = new Set(["majorMinor", "all"]);

const QUALITY_LABEL = { major: "major", minor: "minor", harmonic: "harmonic minor", melodic: "melodic minor" };
const QUALITY_SHORT = { major: "maj", minor: "min", harmonic: "harm", melodic: "mel" };

const SAVED_KEY = "scaleGenerator.savedSelections";
const SLOT_COUNT = 6;

const make = (keys, quality) => keys.map((key) => ({ id: `${key}|${quality}`, key, quality }));

function buildPool(mode, merge) {
  const majors = make(merge ? MAJORS_12 : MAJORS_15, "major");
  const minors = (quality) => make(merge ? MINORS_12 : MINORS_15, quality);
  switch (mode) {
    case "keys":
      return make(KEYS_12, null);
    case "major":
      return majors;
    case "minor":
      return minors("minor");
    case "majorMinor":
      return [...majors, ...minors("minor")];
    default:
      return [...majors, ...minors("harmonic"), ...minors("melodic")];
  }
}

/** "F#/Gb" -> "F♯ / G♭" */
export function prettyKey(name) {
  return name
    .split("/")
    .map((n) => n[0] + n.slice(1).replace("#", "♯").replace("b", "♭"))
    .join(" / ");
}

function shuffle(items) {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const EMPTY = { used: [], current: null, list: null };

/** Each item appears once per round; when the pool is exhausted a new round starts
 *  (never opening with the item that's currently on screen). */
function nextDraw(prev, pool, asList) {
  if (pool.length === 0) return prev;
  if (asList) return { used: pool.map((i) => i.id), current: null, list: shuffle(pool) };
  const usedIds = new Set(prev.list ? [] : prev.used);
  let candidates = pool.filter((i) => !usedIds.has(i.id));
  const newRound = candidates.length === 0;
  if (newRound) candidates = pool.length > 1 ? pool.filter((i) => i.id !== prev.current?.id) : pool;
  const pick = candidates[Math.floor(Math.random() * candidates.length)];
  const baseUsed = newRound || prev.list ? [] : prev.used;
  return { used: [...baseUsed, pick.id], current: pick, list: null };
}

function readSaved() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SAVED_KEY) || "null");
    return Array.isArray(parsed) && parsed.length === SLOT_COUNT ? parsed : Array(SLOT_COUNT).fill(null);
  } catch {
    return Array(SLOT_COUNT).fill(null);
  }
}

function writeSaved(slots) {
  try {
    localStorage.setItem(SAVED_KEY, JSON.stringify(slots));
  } catch {
    // Storage unavailable (private window etc.) - saved slots just won't persist.
  }
}

// ---------- Shared pieces ----------

function KeyDisplay({ state, poolSize, showQuality, compact = false, grow = false }) {
  const { current, list, used } = state;
  const pct = poolSize ? (used.length / poolSize) * 100 : 0;
  const roundDone = !list && poolSize > 0 && used.length === poolSize;

  return (
    <div className={grow ? "flex flex-1 flex-col" : ""}>
      <div
        className={`flex items-center justify-center rounded-xl border border-surface-border/60 bg-surface px-4 py-4 ${
          compact ? "min-h-[104px]" : "min-h-[168px]"
        } ${grow ? "flex-1" : ""}`}
      >
        {list ? (
          <ol className="flex flex-wrap justify-center gap-1.5">
            {list.map((item, i) => (
              <li
                key={item.id}
                className="animate-pop rounded-md bg-surface-card px-2 py-1 text-sm font-semibold text-ink"
                style={{ animationDelay: `${i * 20}ms`, animationFillMode: "backwards" }}
              >
                <span className="mr-1 text-[10px] font-normal tabular-nums text-surface-muted">{i + 1}</span>
                {prettyKey(item.key)}
                {showQuality && <span className="ml-1 text-xs font-normal text-guitar-dark">{QUALITY_SHORT[item.quality]}</span>}
              </li>
            ))}
          </ol>
        ) : current ? (
          <div key={`${current.id}-${used.length}`} className="animate-pop text-center">
            <div className={`${compact ? "text-4xl" : "text-6xl"} font-bold tracking-tight text-ink`}>{prettyKey(current.key)}</div>
            {showQuality && <div className="mt-1.5 text-sm font-medium text-guitar-dark">{QUALITY_LABEL[current.quality]}</div>}
          </div>
        ) : (
          <span className="text-sm text-surface-muted">Press Next to draw a key</span>
        )}
      </div>
      <div className="mt-3 flex items-center gap-3">
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-surface">
          <div className="h-1 rounded-full bg-guitar transition-all duration-300" style={{ width: `${pct}%` }} />
        </div>
        <span className="text-xs tabular-nums text-surface-muted">
          {roundDone ? "Round complete · " : ""}
          {used.length} / {poolSize}
        </span>
      </div>
    </div>
  );
}

function DrawButtons({ onNext, onList, onReset, disabled }) {
  return (
    <div className="mt-4 flex gap-2">
      <button onClick={onNext} disabled={disabled} className="btn flex-1 bg-guitar text-white hover:bg-guitar-dark focus:ring-guitar">
        Next
      </button>
      <button onClick={onList} disabled={disabled} className="btn-secondary" title="Shuffle the whole set into a list">
        Full list
      </button>
      <button onClick={onReset} disabled={disabled} className="btn-secondary px-3" title="Start a new round" aria-label="Start a new round">
        ↺
      </button>
    </div>
  );
}

function Switch({ checked, onChange, disabled, label }) {
  return (
    <label className={`flex items-center gap-2 text-xs text-surface-muted ${disabled ? "opacity-50" : "cursor-pointer"}`}>
      {label}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${checked ? "bg-guitar" : "bg-surface-border"}`}
      >
        <span
          className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform duration-200 ${
            checked ? "translate-x-4" : "translate-x-0"
          }`}
        />
      </button>
    </label>
  );
}

// ---------- Main generator: one panel, switchable sets ----------

export default function ScaleGenerator() {
  const [mode, setMode] = useState("major");
  const [merge, setMerge] = useState(false);
  const [rounds, setRounds] = useState({});

  const pool = useMemo(() => buildPool(mode, merge), [mode, merge]);
  // Each set keeps its own round, so switching tabs doesn't lose progress.
  const roundKey = `${mode}:${mode === "keys" ? "merged" : merge}`;
  const state = rounds[roundKey] || EMPTY;

  const update = (fn) => setRounds((prev) => ({ ...prev, [roundKey]: fn(prev[roundKey] || EMPTY) }));

  return (
    <div className="card flex flex-col">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3>Scale Generator</h3>
        <Switch
          label="Merge enharmonics"
          checked={mode === "keys" || merge}
          disabled={mode === "keys"}
          onChange={setMerge}
        />
      </div>

      <div className="mb-1 flex flex-wrap gap-1 rounded-xl bg-surface p-1" role="tablist">
        {MODES.map((m) => (
          <button
            key={m.id}
            role="tab"
            aria-selected={mode === m.id}
            onClick={() => setMode(m.id)}
            className={`flex-1 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs font-medium ${
              mode === m.id ? "bg-surface-card text-ink shadow" : "text-surface-muted hover:text-ink"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>
      <p className="mb-4 text-[11px] text-surface-muted">
        {pool.length} {mode === "keys" ? "key names" : "keys"} · each appears once per round
      </p>

      <KeyDisplay state={state} poolSize={pool.length} showQuality={MIXED_MODES.has(mode)} grow />
      <DrawButtons
        onNext={() => update((prev) => nextDraw(prev, pool, false))}
        onList={() => update((prev) => nextDraw(prev, pool, true))}
        onReset={() => update(() => EMPTY)}
      />
    </div>
  );
}

// ---------- Custom selection (separate card) ----------

export function CustomScaleSelection() {
  const [selected, setSelected] = useState(() => new Set());
  const [locked, setLocked] = useState(false);
  const [state, setState] = useState(EMPTY);
  const [slots, setSlots] = useState(readSaved);

  const pool = useMemo(
    () => CUSTOM_ROWS.flatMap((row) => make(row.keys, row.quality)).filter((item) => selected.has(item.id)),
    [selected]
  );
  const mixed = new Set(pool.map((i) => i.quality)).size > 1;

  const edit = (fn) => {
    if (locked) return;
    setSelected((prev) => {
      const next = new Set(prev);
      fn(next);
      return next;
    });
  };

  const toggleKey = (id) => edit((next) => (next.has(id) ? next.delete(id) : next.add(id)));
  const toggleRow = (row) =>
    edit((next) => {
      const ids = row.keys.map((k) => `${k}|${row.quality}`);
      const allOn = ids.every((id) => next.has(id));
      ids.forEach((id) => (allOn ? next.delete(id) : next.add(id)));
    });

  const setLock = (value) => {
    setLocked(value);
    setState(EMPTY);
  };

  const handleSlot = (index) => {
    const slot = slots[index];
    if (slot) {
      setSelected(new Set(slot));
      setLock(true);
      return;
    }
    if (!locked || selected.size === 0) return;
    const next = slots.map((s, i) => (i === index ? [...selected] : s));
    setSlots(next);
    writeSaved(next);
  };

  const clearSlot = (index) => {
    const next = slots.map((s, i) => (i === index ? null : s));
    setSlots(next);
    writeSaved(next);
  };

  return (
    <div className="card">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3>Custom Selection</h3>
          <p className="text-xs text-surface-muted">Pick the keys you want to drill, then lock to draw from them.</p>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="mr-1 text-xs text-surface-muted">Saved</span>
          {slots.map((slot, i) => (
            <div key={i} className="group relative">
              <button
                onClick={() => handleSlot(i)}
                disabled={!slot && (!locked || selected.size === 0)}
                title={slot ? `${slot.length} keys - click to load` : "Lock a selection, then click to save it here"}
                className={`h-7 w-7 rounded-full text-xs font-semibold ${
                  slot
                    ? "bg-guitar/20 text-guitar-dark ring-1 ring-guitar/60 hover:bg-guitar/30"
                    : "border border-dashed border-surface-border text-surface-muted hover:border-guitar/60 disabled:opacity-40"
                }`}
              >
                {i + 1}
              </button>
              {slot && (
                <button
                  onClick={() => clearSlot(i)}
                  aria-label={`Clear saved selection ${i + 1}`}
                  className="absolute -right-1 -top-1 hidden h-3.5 w-3.5 items-center justify-center rounded-full bg-red-600 text-[9px] leading-none text-white group-hover:flex"
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_280px]">
        <div className="flex flex-col gap-3">
          {CUSTOM_ROWS.map((row) => (
            <div key={row.quality}>
              <button
                onClick={() => toggleRow(row)}
                disabled={locked}
                className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-surface-muted hover:text-ink disabled:hover:text-surface-muted"
                title="Toggle the whole row"
              >
                {row.label}
              </button>
              <div className="flex flex-wrap gap-1">
                {row.keys.map((k) => {
                  const id = `${k}|${row.quality}`;
                  const on = selected.has(id);
                  return (
                    <button
                      key={id}
                      onClick={() => toggleKey(id)}
                      aria-pressed={on}
                      className={`h-8 min-w-[2.25rem] rounded-lg px-1.5 text-xs font-semibold transition-all duration-150 ${
                        on
                          ? "bg-guitar text-white shadow-[0_0_12px_rgba(249,115,22,.35)]"
                          : `border border-surface-border text-ink-soft ${k.length > 1 ? "bg-surface" : "bg-surface-card"} ${
                              locked ? "opacity-30" : "hover:border-guitar/60 hover:text-ink"
                            }`
                      } ${locked ? "cursor-default" : ""}`}
                    >
                      {prettyKey(k)}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          {!locked && selected.size > 0 && (
            <button onClick={() => setSelected(new Set())} className="self-start text-xs text-surface-muted hover:text-ink">
              Clear selection
            </button>
          )}
        </div>

        <div>
          <KeyDisplay state={state} poolSize={pool.length} showQuality={mixed} compact />
          <div className="mt-4 flex gap-2">
            <button
              onClick={() => setLock(!locked)}
              disabled={!locked && selected.size === 0}
              className={`btn px-3 ${locked ? "bg-surface-border text-ink hover:bg-slate-600" : "bg-guitar text-white hover:bg-guitar-dark"}`}
            >
              {locked ? "Unlock" : "Lock"}
            </button>
            <button
              onClick={() => setState((prev) => nextDraw(prev, pool, false))}
              disabled={!locked}
              className="btn flex-1 bg-guitar text-white hover:bg-guitar-dark focus:ring-guitar"
            >
              Next
            </button>
            <button onClick={() => setState((prev) => nextDraw(prev, pool, true))} disabled={!locked} className="btn-secondary px-3">
              List
            </button>
          </div>
          {!locked && (
            <p className="mt-2 text-[11px] text-surface-muted">
              {selected.size === 0 ? "Select some keys to get started." : `${selected.size} selected - lock to start drawing.`}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
