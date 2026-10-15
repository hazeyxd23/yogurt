import { useRef, useState } from "react";
import { DOCK_RESERVE, isCompact, useWindows } from "./WindowManager";

const capture = (el, pointerId) => {
  try {
    el.setPointerCapture(pointerId);
  } catch {
    // pointer already released
  }
};

function TrafficLights({ active, onClose, onMinimize, onZoom }) {
  const lights = [
    ["close", onClose, "×", "Close"],
    ["minimize", onMinimize, "−", "Minimize"],
    ["zoom", onZoom, "+", "Zoom"],
  ];
  return (
    <div className={`aqua-lights group/lights flex items-center gap-2 ${active ? "is-active" : ""}`}>
      {lights.map(([kind, onClick, glyph, label]) => (
        <button
          key={kind}
          type="button"
          data-light={kind}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onClick}
          aria-label={label}
          title={label}
          className={`aqua-light aqua-light-${kind}`}
        >
          <span className="opacity-0 group-hover/lights:opacity-100">{glyph}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * An Aqua window: drag the title bar to move it, double-click it to minimise,
 * resize from the bottom-right grip, traffic lights to close / minimise / zoom.
 */
export default function Window({ app, win, active, z, children }) {
  const { focus, close, minimize, zoom, setGeometry, launching } = useWindows();
  const [live, setLive] = useState(null); // geometry while dragging / resizing
  const gesture = useRef(null);
  const compact = isCompact();
  const maximized = win.maximized || compact;
  const g = live || win;

  const begin = (kind) => (e) => {
    if (e.button !== 0 || maximized) return;
    if (kind === "move" && e.target.closest("button, input")) return;
    e.preventDefault();
    focus(app.id);
    gesture.current = { kind, sx: e.clientX, sy: e.clientY, start: { x: win.x, y: win.y, w: win.w, h: win.h } };
    capture(e.currentTarget, e.pointerId);
  };

  const move = (e) => {
    const gs = gesture.current;
    if (!gs) return;
    const dx = e.clientX - gs.sx;
    const dy = e.clientY - gs.sy;
    if (gs.kind === "move") {
      const W = window.innerWidth;
      const H = window.innerHeight;
      setLive({ ...gs.start, x: Math.max(-gs.start.w + 140, Math.min(gs.start.x + dx, W - 140)), y: Math.max(0, Math.min(gs.start.y + dy, H - 90)) });
    } else {
      setLive({ ...gs.start, w: Math.max(480, gs.start.w + dx), h: Math.max(340, gs.start.h + dy) });
    }
  };

  const end = () => {
    const gs = gesture.current;
    gesture.current = null;
    if (gs && live) setGeometry(app.id, live);
    setLive(null);
  };

  const style = maximized
    ? { left: 0, top: 0, width: "100%", height: compact ? "calc(100% - 72px)" : `calc(100% - ${DOCK_RESERVE}px)`, zIndex: z }
    : { left: g.x, top: g.y, width: g.w, height: g.h, zIndex: z };

  return (
    <section
      data-window={app.id}
      aria-label={app.title}
      onPointerDownCapture={() => !active && focus(app.id)}
      className={`aqua-window absolute flex flex-col ${active ? "is-active" : ""} ${live ? "" : "aqua-window-settle"} ${
        launching === app.id ? "aqua-window-open" : ""
      } ${win.minimized ? "hidden" : ""}`}
      style={style}
    >
      <header
        className="aqua-titlebar relative flex h-[30px] shrink-0 select-none items-center px-2.5"
        onPointerDown={begin("move")}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        onDoubleClick={(e) => !e.target.closest("button") && minimize(app.id)}
      >
        <TrafficLights active={active} onClose={() => close(app.id)} onMinimize={() => minimize(app.id)} onZoom={() => zoom(app.id)} />
        <div className="pointer-events-none absolute inset-x-24 flex items-center justify-center gap-1.5 truncate">
          <app.Icon className="h-4 w-4 shrink-0" />
          <span className="truncate text-[13px]">{app.title}</span>
        </div>
      </header>

      <div className={`aqua-window-body min-h-0 flex-1 ${app.fill ? "overflow-hidden p-3" : "overflow-auto p-5"}`}>{children}</div>

      {!maximized && (
        <div
          className="aqua-grip absolute bottom-0 right-0 h-4 w-4 cursor-nwse-resize"
          onPointerDown={begin("resize")}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
          aria-hidden="true"
        />
      )}
    </section>
  );
}
