import { useState } from "react";
import { APPS } from "./apps";
import { useWindows } from "./WindowManager";

const BASE = 52; // icon size at rest
const MAX_GROWTH = 0.6; // +60% right under the pointer
const REACH = 150; // px over which magnification falls off

/** Leopard-style Dock: glass shelf, magnification, running lights, launch bounce. */
export default function Dock() {
  const { state, front, launching, open, focus } = useWindows();
  const [pointerX, setPointerX] = useState(null);
  const [centers, setCenters] = useState({});

  const sizeFor = (id) => {
    if (pointerX === null || centers[id] === undefined) return BASE;
    const d = Math.abs(pointerX - centers[id]);
    return Math.round(BASE * (1 + MAX_GROWTH * Math.max(0, Math.cos(Math.min(d / REACH, 1) * (Math.PI / 2)))));
  };

  // Record resting centres when the pointer enters, so growth doesn't feed back into itself.
  const onEnter = (e) => {
    const next = {};
    e.currentTarget.querySelectorAll("[data-dock]").forEach((el) => {
      const r = el.getBoundingClientRect();
      next[el.dataset.dock] = r.left + r.width / 2;
    });
    setCenters(next);
  };

  const activate = (id) => {
    const win = state.windows[id];
    if (win?.open && !win.minimized) focus(id);
    else open(id);
  };

  return (
    <nav
      className="aqua-dock fixed bottom-1 left-1/2 z-[80] -translate-x-1/2"
      onMouseEnter={onEnter}
      onMouseMove={(e) => setPointerX(e.clientX)}
      onMouseLeave={() => setPointerX(null)}
      aria-label="Dock"
    >
      <div className="aqua-dock-shelf" aria-hidden="true" />
      <ul className="relative flex items-end gap-1.5 px-4 pb-2">
        {APPS.map((app) => {
          const win = state.windows[app.id];
          const running = Boolean(win?.open);
          const size = sizeFor(app.id);
          return (
            <li key={app.id} className="group relative flex flex-col items-center" style={{ width: size }}>
              <span className="aqua-dock-label pointer-events-none absolute bottom-full mb-3 whitespace-nowrap opacity-0 group-hover:opacity-100">
                {app.short || app.title}
              </span>
              <button
                type="button"
                data-dock={app.id}
                onClick={() => activate(app.id)}
                aria-label={`${app.title}${running ? " (open)" : ""}`}
                className={`aqua-dock-icon ${launching === app.id ? "is-launching" : ""} ${front === app.id ? "is-front" : ""}`}
                style={{ width: size, height: size }}
              >
                <app.Icon className="h-full w-full" />
              </button>
              <span className={`aqua-dock-light ${running ? "opacity-100" : "opacity-0"}`} />
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
