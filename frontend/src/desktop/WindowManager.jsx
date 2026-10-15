import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { APPS, appById, appForPath } from "./apps";

export const MENU_HEIGHT = 28;
export const DOCK_RESERVE = 92; // space kept free for the Dock when a window is zoomed
const STORAGE_KEY = "yogurt.windows.v1";
const MIN_SIZE = { w: 480, h: 340 };

const WindowContext = createContext(null);

const desktopSize = () => ({ w: window.innerWidth, h: window.innerHeight - MENU_HEIGHT });
export const isCompact = () => window.innerWidth < 768;

function defaultGeometry(app, openCount) {
  const { w: W, h: H } = desktopSize();
  const w = Math.min(app.size[0], W - 40);
  const h = Math.min(app.size[1], H - DOCK_RESERVE - 16);
  const cascade = (openCount % 6) * 26;
  return {
    x: Math.round(Math.max(8, Math.min((W - w) / 2 - 60 + cascade, W - w - 8))),
    y: Math.round(Math.max(8, Math.min(14 + cascade, H - DOCK_RESERVE - h))),
    w: Math.round(w),
    h: Math.round(h),
  };
}

/** Keep a saved window reachable on the current screen size. */
function clampGeometry(g) {
  const { w: W, h: H } = desktopSize();
  const w = Math.max(MIN_SIZE.w, Math.min(g.w, W - 16));
  const h = Math.max(MIN_SIZE.h, Math.min(g.h, H - 16));
  return { w, h, x: Math.max(-w + 140, Math.min(g.x, W - 140)), y: Math.max(0, Math.min(g.y, H - 60)) };
}

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (saved?.windows && Array.isArray(saved.order)) {
      const windows = {};
      for (const [id, w] of Object.entries(saved.windows)) {
        if (appById[id]) windows[id] = { ...w, ...clampGeometry(w) };
      }
      return { windows, order: saved.order.filter((id) => windows[id]?.open) };
    }
  } catch {
    // corrupted or unavailable storage - start fresh
  }
  return { windows: {}, order: [] };
}

const toTop = (order, id) => [...order.filter((x) => x !== id), id];

function reducer(state, action) {
  const { id } = action;
  const win = state.windows[id];
  switch (action.type) {
    case "show": {
      const openCount = state.order.length;
      const base = win && win.open ? win : { ...(win || {}), ...(win?.w ? clampGeometry(win) : defaultGeometry(appById[id], openCount)) };
      return {
        windows: { ...state.windows, [id]: { maximized: false, ...base, open: true, minimized: false, path: action.path ?? base.path ?? appById[id].path } },
        order: toTop(state.order, id),
      };
    }
    case "focus":
      return { ...state, order: toTop(state.order, id) };
    case "close":
      return { windows: { ...state.windows, [id]: { ...win, open: false, minimized: false } }, order: state.order.filter((x) => x !== id) };
    case "minimize":
      return { ...state, windows: { ...state.windows, [id]: { ...win, minimized: true } } };
    case "zoom":
      return { windows: { ...state.windows, [id]: { ...win, maximized: !win.maximized } }, order: toTop(state.order, id) };
    case "geometry":
      return { ...state, windows: { ...state.windows, [id]: { ...win, ...action.geometry, maximized: false } } };
    case "path":
      return { ...state, windows: { ...state.windows, [id]: { ...win, path: action.path } } };
    case "showAll":
      return {
        ...state,
        windows: Object.fromEntries(Object.entries(state.windows).map(([k, w]) => [k, w.open ? { ...w, minimized: false } : w])),
      };
    default:
      return state;
  }
}

/** Front-most visible window. */
const frontOf = (state, exclude) =>
  [...state.order].reverse().find((id) => id !== exclude && state.windows[id]?.open && !state.windows[id]?.minimized) ?? null;

/** Fly a window into (or out of) its Dock icon. */
function genie(id, direction) {
  const el = document.querySelector(`[data-window="${id}"]`);
  const icon = document.querySelector(`[data-dock="${id}"]`);
  if (!el || !icon || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return Promise.resolve();
  const r = el.getBoundingClientRect();
  const i = icon.getBoundingClientRect();
  const away = {
    transform: `translate(${i.left + i.width / 2 - (r.left + r.width / 2)}px, ${i.top + i.height / 2 - (r.top + r.height / 2)}px) scale(${Math.max(0.05, i.width / r.width)}, ${Math.max(0.05, i.height / r.height)})`,
    opacity: 0.2,
  };
  const home = { transform: "none", opacity: 1 };
  el.getAnimations().forEach((a) => a.cancel()); // drop a held "minimised" frame
  const frames = direction === "in" ? [home, away] : [away, home];
  const anim = el.animate(frames, {
    duration: 380,
    easing: direction === "in" ? "cubic-bezier(.55,.05,.7,.4)" : "cubic-bezier(.2,.7,.3,1)",
    fill: direction === "in" ? "forwards" : "none", // hold the shrunken frame until the window hides
  });
  return new Promise((resolve) => {
    let done = false;
    const once = () => {
      if (!done) {
        done = true;
        resolve();
      }
    };
    anim.finished.then(once, once);
    setTimeout(once, 500);
  });
}

export function WindowManager({ children }) {
  const [state, dispatch] = useReducer(reducer, null, load);
  const [launching, setLaunching] = useState(null);
  const location = useLocation();
  const navigate = useNavigate();
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // layout just won't be remembered
    }
  }, [state]);

  // The URL decides which window is in front (links like /notes/12 open Notes).
  useEffect(() => {
    const id = appForPath(location.pathname);
    if (!id) return;
    const wasMinimized = stateRef.current.windows[id]?.minimized;
    dispatch({ type: "show", id, path: location.pathname + location.search });
    if (wasMinimized) requestAnimationFrame(() => genie(id, "out"));
  }, [location.pathname, location.search]);

  const front = frontOf(state);
  const go = useCallback((id) => navigate(id ? stateRef.current.windows[id]?.path || appById[id].path : "/desktop"), [navigate]);

  const actions = useMemo(
    () => ({
      open(id) {
        const win = stateRef.current.windows[id];
        if (!win?.open) {
          setLaunching(id);
          setTimeout(() => setLaunching((l) => (l === id ? null : l)), 900);
        }
        navigate(win?.open ? win.path : appById[id].path);
      },
      focus(id) {
        if (frontOf(stateRef.current) === id) return;
        dispatch({ type: "focus", id });
        go(id);
      },
      close(id) {
        const next = frontOf(stateRef.current, id);
        dispatch({ type: "close", id });
        if (frontOf(stateRef.current) === id) go(next);
      },
      async minimize(id) {
        const next = frontOf(stateRef.current, id);
        await genie(id, "in");
        dispatch({ type: "minimize", id });
        go(next);
      },
      zoom(id) {
        dispatch({ type: "zoom", id });
        if (frontOf(stateRef.current) !== id) go(id);
      },
      setGeometry(id, geometry) {
        dispatch({ type: "geometry", id, geometry: clampGeometry({ ...stateRef.current.windows[id], ...geometry }) });
      },
      showAll() {
        const hidden = Object.entries(stateRef.current.windows).filter(([, w]) => w.open && w.minimized).map(([k]) => k);
        dispatch({ type: "showAll" });
        requestAnimationFrame(() => hidden.forEach((k) => genie(k, "out")));
      },
      closeAll() {
        for (const id of stateRef.current.order) dispatch({ type: "close", id });
        navigate("/desktop");
      },
    }),
    [navigate, go]
  );

  const value = useMemo(() => ({ state, front, launching, ...actions }), [state, front, launching, actions]);
  return <WindowContext.Provider value={value}>{children}</WindowContext.Provider>;
}

export function useWindows() {
  const ctx = useContext(WindowContext);
  if (!ctx) throw new Error("useWindows must be used inside <WindowManager>");
  return ctx;
}

// ----- per-window context, so pages know about their own window -----

const OwnWindowContext = createContext({ id: null, active: true, path: "/" });
export const OwnWindowProvider = OwnWindowContext.Provider;

/** The window a page is rendered in: { id, active, path }. */
export const useOwnWindow = () => useContext(OwnWindowContext);

export { APPS };
