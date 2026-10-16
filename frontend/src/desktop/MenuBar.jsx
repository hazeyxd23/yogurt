import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { APPS, appById } from "./apps";
import { useWindows } from "./WindowManager";
import { useNotes } from "../context/NotesContext";
import YogurtLogo from "./Logo";
import { useTheme } from "../context/ThemeContext";

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 15000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function AboutWindow({ onClose }) {
  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="aqua-window is-active aqua-window-open w-[340px]" role="dialog" aria-label="About yogurt">
        <header className="aqua-titlebar relative flex h-[30px] items-center px-2.5">
          <div className="aqua-lights is-active flex gap-2">
            <button className="aqua-light aqua-light-close" onClick={onClose} aria-label="Close" />
            <span className="aqua-light aqua-light-minimize opacity-40" />
            <span className="aqua-light aqua-light-zoom opacity-40" />
          </div>
        </header>
        <div className="aqua-window-body flex flex-col items-center px-8 pb-7 pt-6 text-center">
          <YogurtLogo className="mb-4 h-24" />
          <h2 className="text-2xl">yogurt</h2>
          <p className="mb-4 text-xs text-surface-muted">Version 2.0 (Aqua)</p>
          <p className="text-[13px] leading-relaxed text-ink-soft">
            Guitar, reading, LeetCode, a calendar and an Obsidian-style notebook - in one desktop.
          </p>
          <p className="mt-4 text-[11px] text-surface-muted">FastAPI · React · PostgreSQL</p>
        </div>
      </div>
    </div>
  );
}

/** Mac OS X menu bar (Leopard translucent style). */
export default function MenuBar() {
  const { state, front, open, close, minimize, zoom, showAll, closeAll } = useWindows();
  const { createNote } = useNotes();
  const { dark, toggle: toggleTheme } = useTheme();
  const navigate = useNavigate();
  const [menu, setMenu] = useState(null);
  const [about, setAbout] = useState(false);
  const barRef = useRef(null);
  const now = useClock();

  useEffect(() => {
    if (!menu) return undefined;
    const onDown = (e) => !barRef.current?.contains(e.target) && setMenu(null);
    const onKey = (e) => e.key === "Escape" && setMenu(null);
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  // Alt+1..N jumps to the Nth app
  useEffect(() => {
    const onKey = (e) => {
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      const n = Number(e.key);
      if (n >= 1 && n <= APPS.length) {
        e.preventDefault();
        open(APPS[n - 1].id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const newNote = async (kind) => {
    const note = await createNote({ title: kind === "graph" ? "Untitled graph" : "Untitled", kind });
    if (note) navigate(`/notes/${note.id}`);
  };

  const run = (fn) => () => {
    setMenu(null);
    fn();
  };

  const openApps = APPS.filter((a) => state.windows[a.id]?.open);
  const menus = {
    logo: [
      { label: "About yogurt", action: () => setAbout(true) },
      "-",
      { label: "Close All Windows", action: closeAll, disabled: !openApps.length },
    ],
    File: [
      { label: "New Note", action: () => newNote("text") },
      { label: "New Graph", action: () => newNote("graph") },
      "-",
      { label: "Close Window", action: () => front && close(front), disabled: !front },
    ],
    View: [{ label: "Dark Mode", checked: dark, action: toggleTheme }],
    Go: APPS.map((a, i) => ({ label: a.title, shortcut: `⌥${i + 1}`, action: () => open(a.id) })),
    Window: [
      { label: "Minimize", action: () => front && minimize(front), disabled: !front },
      { label: "Zoom", action: () => front && zoom(front), disabled: !front },
      "-",
      { label: "Bring All to Front", action: showAll, disabled: !openApps.length },
      "-",
      ...(openApps.length
        ? openApps.map((a) => ({ label: a.title, checked: front === a.id, action: () => open(a.id) }))
        : [{ label: "No windows open", disabled: true }]),
    ],
    Help: [{ label: "About yogurt", action: () => setAbout(true) }],
  };

  const renderMenu = (key) => (
    <ul className="aqua-menu absolute left-0 top-full min-w-[210px] py-1" role="menu">
      {menus[key].map((item, i) =>
        item === "-" ? (
          <li key={i} className="my-1 border-t border-black/10" role="separator" />
        ) : (
          <li key={item.label}>
            <button
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={run(item.action)}
              className="aqua-menu-item flex w-full items-center gap-2 px-4 py-[3px] text-left"
            >
              <span className="w-3 text-[11px]">{item.checked ? "✓" : ""}</span>
              <span className="flex-1">{item.label}</span>
              {item.shortcut && <span className="opacity-60">{item.shortcut}</span>}
            </button>
          </li>
        )
      )}
    </ul>
  );

  const menuButton = (key, content, className = "") => (
    <div key={key} className={`relative ${className.includes("hidden") ? "hidden sm:block" : ""}`}>
      <button
        type="button"
        className={`aqua-menubar-item h-7 px-2.5 ${menu === key ? "is-open" : ""} ${className}`}
        onClick={() => setMenu((m) => (m === key ? null : key))}
        onMouseEnter={() => menu && setMenu(key)}
        aria-haspopup="menu"
        aria-expanded={menu === key}
      >
        {content}
      </button>
      {menu === key && renderMenu(key)}
    </div>
  );

  return (
    <>
      <header ref={barRef} className="aqua-menubar fixed inset-x-0 top-0 z-[90] flex h-7 items-center text-[13px]">
        {menuButton("logo", <YogurtLogo className="h-[24px]" />, "px-2")}
        <div className="px-2 font-bold">{front ? appById[front].short || appById[front].title : "yogurt"}</div>
        {["File", "View", "Go", "Window", "Help"].map((k) => menuButton(k, k, ["View", "Window", "Help"].includes(k) ? "hidden sm:flex" : ""))}
        <div className="ml-auto flex items-center gap-3 whitespace-nowrap px-3 text-[13px]">
          <button
            type="button"
            onClick={toggleTheme}
            title={dark ? "Switch to light mode" : "Switch to dark mode"}
            aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
            className="aqua-menubar-item h-7 rounded px-1.5 text-[15px] leading-none"
          >
            {dark ? "☀" : "☾"}
          </button>
          <span className="hidden sm:inline">{now.toLocaleDateString(undefined, { weekday: "short" })}</span>
          <span>{now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden="true">
            <circle cx="6.5" cy="6.5" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
            <path d="M10 10l4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </div>
      </header>
      {about && <AboutWindow onClose={() => setAbout(false)} />}
    </>
  );
}
