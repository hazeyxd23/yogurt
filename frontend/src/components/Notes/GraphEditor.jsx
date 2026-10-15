import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useNotes } from "../../context/NotesContext";

// ---------- constants & geometry helpers ----------

const DEFAULT_NODE = { w: 120, h: 46 };
const GROUP_PAD = 20;
const GROUP_HEAD = 30;
const HISTORY_LIMIT = 80;
const LERP = 0.3;
const PRIORITY_COLORS = { low: "#22c55e", medium: "#f59e0b", high: "#ef4444" };
const PRIORITY_LABEL = { low: "Low", medium: "Medium", high: "High" };
// Graphs saved before "status" became "priority".
const LEGACY_STATUS = { done: "low", progress: "medium", todo: "high" };
const SIDES = ["top", "right", "bottom", "left"];
const NORMAL = { top: { x: 0, y: -1 }, bottom: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };

const uid = (prefix) => `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const center = (r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
const inside = (pt, r) => pt.x >= r.x && pt.x <= r.x + r.w && pt.y >= r.y && pt.y <= r.y + r.h;
const contains = (outer, inner) =>
  inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
const intersects = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/** Pointer capture that never throws (the pointer may already be gone, e.g. after a cancel). */
const capture = (el, pointerId, on) => {
  try {
    if (on) el?.setPointerCapture(pointerId);
    else if (el?.hasPointerCapture(pointerId)) el.releasePointerCapture(pointerId);
  } catch {
    // ignore
  }
};

const normalize = (g) => ({
  nodes: (g?.nodes || []).map((n) => {
    if (n.priority !== undefined || n.status === undefined) return n;
    const { status, ...rest } = n;
    return { ...rest, priority: LEGACY_STATUS[status] ?? null };
  }),
  edges: g?.edges || [],
  groups: g?.groups || [],
});

const makeNode = (x, y, label = "New node") => ({
  id: uid("n"),
  label,
  x: Math.round(x),
  y: Math.round(y),
  priority: null,
  progress: 0,
  accent: false,
  noteId: null,
});

/** Sides facing each other, picked by which axis has the bigger gap between the boxes. */
function pickSides(a, b) {
  const ca = center(a);
  const cb = center(b);
  const dx = cb.x - ca.x;
  const dy = cb.y - ca.y;
  const gapX = Math.abs(dx) - (a.w + b.w) / 2;
  const gapY = Math.abs(dy) - (a.h + b.h) / 2;
  if (gapX > gapY) return dx >= 0 ? ["right", "left"] : ["left", "right"];
  return dy >= 0 ? ["bottom", "top"] : ["top", "bottom"];
}

function anchorPoint(r, side, t) {
  if (side === "top") return { x: r.x + r.w * t, y: r.y };
  if (side === "bottom") return { x: r.x + r.w * t, y: r.y + r.h };
  if (side === "left") return { x: r.x, y: r.y + r.h * t };
  return { x: r.x + r.w, y: r.y + r.h * t };
}

/**
 * Curved arrows that attach to the facing sides of each box. Several arrows on the
 * same side are spread out (ordered by where their other end is) so arrowheads never
 * stack on top of each other and stay visible outside the boxes.
 */
function layoutEdges(edges, rectOf) {
  const items = [];
  const buckets = new Map();
  const add = (key, entry) => (buckets.has(key) ? buckets.get(key).push(entry) : buckets.set(key, [entry]));

  for (const edge of edges) {
    const a = rectOf(edge.from);
    const b = rectOf(edge.to);
    if (!a || !b) continue;
    const [sa, sb] = pickSides(a, b);
    const item = { edge, a, b, sa, sb, ta: 0.5, tb: 0.5 };
    items.push(item);
    add(`${edge.from}|${sa}`, { item, end: "a", other: center(b) });
    add(`${edge.to}|${sb}`, { item, end: "b", other: center(a) });
  }

  for (const [key, list] of buckets) {
    const side = key.slice(key.lastIndexOf("|") + 1);
    const horizontal = side === "top" || side === "bottom";
    list.sort((p, q) => (horizontal ? p.other.x - q.other.x : p.other.y - q.other.y));
    list.forEach((entry, i) => {
      entry.item[entry.end === "a" ? "ta" : "tb"] = 0.5 + ((i + 1) / (list.length + 1) - 0.5) * 0.8;
    });
  }

  return items.map(({ edge, a, b, sa, sb, ta, tb }) => {
    const p0 = anchorPoint(a, sa, ta);
    const p3 = anchorPoint(b, sb, tb);
    const n0 = NORMAL[sa];
    const n3 = NORMAL[sb];
    const s = { x: p0.x + n0.x * 2, y: p0.y + n0.y * 2 };
    const t = { x: p3.x + n3.x * 3, y: p3.y + n3.y * 3 };
    const c = clamp(Math.hypot(t.x - s.x, t.y - s.y) * 0.45, 24, 140);
    const d = `M ${s.x} ${s.y} C ${s.x + n0.x * c} ${s.y + n0.y * c}, ${t.x + n3.x * c} ${t.y + n3.y * c}, ${t.x} ${t.y}`;
    return { edge, d, s, t };
  });
}

// ---------- example template (a small guitar roadmap) ----------

function exampleGraph() {
  const n = (id, label, x, y, priority, progress = 0, extra = {}) => ({ id, label, x, y, priority, progress, accent: false, noteId: null, ...extra });
  const g = (id, label, x, y, w, h) => ({ id, label, x, y, w, h });
  const e = (from, to, style = "solid") => ({ id: uid("e"), from, to, style });
  return {
    nodes: [
      n("n_root", "Learn Guitar", 262, 0, null, null, { accent: true }),
      n("n_chords", "Open Chords", 60, 140, "high", 60),
      n("n_strum", "Strumming", 60, 210, "medium", 30),
      n("n_major", "Major Scale", 420, 140, "medium", 40),
      n("n_penta", "Pentatonic", 420, 210, "low"),
      n("n_song", "First Song", 262, 340, "high"),
    ],
    groups: [g("g_rhythm", "Rhythm", 40, 100, 180, 175), g("g_lead", "Lead", 400, 100, 180, 175)],
    edges: [
      e("n_root", "g_rhythm", "dashed"),
      e("n_root", "g_lead", "dashed"),
      e("n_chords", "n_strum"),
      e("n_major", "n_penta"),
      e("n_strum", "n_song"),
      e("n_penta", "n_song"),
    ],
  };
}

// ---------- the editor ----------

export default function GraphEditor({ graph: graphProp, onChange, noteId, compact = false, className = "" }) {
  const markerPrefix = `gm${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const { notes } = useNotes();
  const navigate = useNavigate();

  const [graph, setGraphState] = useState(() => normalize(graphProp));
  const graphRef = useRef(graph);
  const setGraph = (next) => {
    graphRef.current = next;
    setGraphState(next);
  };
  const lastEmitted = useRef(graphProp);
  const history = useRef({ past: [], future: [] });

  const containerRef = useRef(null);
  const worldRef = useRef(null);
  const [view, setViewState] = useState({ x: 40, y: 40, k: 1 });
  const viewRef = useRef(view);
  const setView = (v) => {
    viewRef.current = v;
    setViewState(v);
  };

  const [sizes, setSizes] = useState({});
  const [selection, setSelection] = useState({ ids: new Set(), edge: null });
  const [hover, setHover] = useState(null); // node/group id, or "edge:<id>"
  const [editingId, setEditingId] = useState(null);
  const [connect, setConnect] = useState(null); // { from, x, y, target }
  const [box, setBox] = useState(null); // screen-space rubber band
  const [newEdges, setNewEdges] = useState(() => new Set());
  const [showHelp, setShowHelp] = useState(false);
  const [, setFrame] = useState(0);
  const anim = useRef({});
  const raf = useRef(0);
  const drag = useRef(null);
  const editStart = useRef(null);
  const viewTween = useRef(0);

  // Pick up changes made elsewhere (e.g. the same note open in a floating window).
  useEffect(() => {
    if (graphProp === lastEmitted.current || drag.current) return;
    lastEmitted.current = graphProp;
    setGraph(normalize(graphProp));
    history.current = { past: [], future: [] };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphProp]);

  // ----- history -----

  const emit = (next) => {
    lastEmitted.current = next;
    onChange?.(next);
  };

  const commit = (next, from = graphRef.current) => {
    const h = history.current;
    h.past.push(from);
    if (h.past.length > HISTORY_LIMIT) h.past.shift();
    h.future = [];
    setGraph(next);
    emit(next);
  };

  const undo = () => {
    const h = history.current;
    if (!h.past.length) return;
    h.future.push(graphRef.current);
    const prev = h.past.pop();
    setGraph(prev);
    emit(prev);
  };

  const redo = () => {
    const h = history.current;
    if (!h.future.length) return;
    h.past.push(graphRef.current);
    const next = h.future.pop();
    setGraph(next);
    emit(next);
  };

  // ----- fluid positions: rendered positions ease toward the stored ones -----

  const targets = useMemo(() => {
    const t = {};
    for (const n of graph.nodes) t[n.id] = { x: n.x, y: n.y };
    for (const g of graph.groups) t[g.id] = { x: g.x, y: g.y };
    return t;
  }, [graph]);

  useEffect(() => {
    const a = anim.current;
    for (const id of Object.keys(a)) if (!targets[id]) delete a[id];
    for (const id of Object.keys(targets)) if (!a[id]) a[id] = { ...targets[id] };
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const step = () => {
      let moving = false;
      for (const id in targets) {
        const p = a[id];
        const t = targets[id];
        const dx = t.x - p.x;
        const dy = t.y - p.y;
        if (!reduce && (Math.abs(dx) > 0.25 || Math.abs(dy) > 0.25)) {
          p.x += dx * LERP;
          p.y += dy * LERP;
          moving = true;
        } else {
          p.x = t.x;
          p.y = t.y;
        }
      }
      setFrame((f) => (f + 1) % 1e9);
      raf.current = moving ? requestAnimationFrame(step) : 0;
    };
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [targets]);

  const pos = (id) => anim.current[id] || targets[id] || { x: 0, y: 0 };

  // Measure node boxes whenever labels / progress bars change.
  useLayoutEffect(() => {
    const els = worldRef.current?.querySelectorAll("[data-node-id]") || [];
    let changed = false;
    const next = { ...sizes };
    els.forEach((el) => {
      const id = el.dataset.nodeId;
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      if (!next[id] || next[id].w !== w || next[id].h !== h) {
        next[id] = { w, h };
        changed = true;
      }
    });
    if (changed) setSizes(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph.nodes, editingId]);

  const nodeById = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph.nodes]);
  const groupById = useMemo(() => new Map(graph.groups.map((g) => [g.id, g])), [graph.groups]);

  const sizeOf = (id) => sizes[id] || DEFAULT_NODE;
  /** Rect of a node or group, using rendered (animated) positions or stored ones. */
  const rectOf = (id, live = true) => {
    const at = live ? pos(id) : targets[id];
    if (!at) return null;
    if (nodeById.has(id)) {
      const s = sizeOf(id);
      return { x: at.x, y: at.y, w: s.w, h: s.h };
    }
    const g = groupById.get(id);
    return g ? { x: at.x, y: at.y, w: g.w, h: g.h } : null;
  };

  // ----- view -----

  const contentBounds = () => {
    const rects = [...graph.nodes.map((n) => rectOf(n.id, false)), ...graph.groups.map((g) => rectOf(g.id, false))].filter(Boolean);
    if (!rects.length) return null;
    const x = Math.min(...rects.map((r) => r.x));
    const y = Math.min(...rects.map((r) => r.y));
    return { x, y, w: Math.max(...rects.map((r) => r.x + r.w)) - x, h: Math.max(...rects.map((r) => r.y + r.h)) - y };
  };

  // Animated view changes (fit); any manual pan/zoom cancels them.
  const tweenViewTo = (target) => {
    const id = ++viewTween.current;
    const from = viewRef.current;
    const start = performance.now();
    const step = (now) => {
      if (viewTween.current !== id) return;
      const t = Math.min(1, (now - start) / 380);
      const e = 1 - Math.pow(1 - t, 3);
      setView({ x: from.x + (target.x - from.x) * e, y: from.y + (target.y - from.y) * e, k: from.k + (target.k - from.k) * e });
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
    // Land exactly even if frames are throttled (background tab).
    setTimeout(() => viewTween.current === id && setView(target), 450);
  };

  const stopTween = () => {
    viewTween.current += 1;
  };

  const fitView = (animate = true) => {
    const el = containerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const b = contentBounds();
    if (!b) {
      setView({ x: r.width / 2 - 60, y: r.height / 2 - 23, k: 1 });
      return;
    }
    const pad = compact ? 18 : 56;
    const k = clamp(Math.min((r.width - pad * 2) / b.w, (r.height - pad * 2) / b.h), 0.25, 1.2);
    const target = { k, x: (r.width - b.w * k) / 2 - b.x * k, y: (r.height - b.h * k) / 2 - b.y * k };
    if (animate) tweenViewTo(target);
    else setView(target);
  };

  useLayoutEffect(() => {
    fitView(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-fit once after bulk changes (e.g. loading the example), when node sizes are known.
  const pendingFit = useRef(false);
  useEffect(() => {
    if (!pendingFit.current) return;
    pendingFit.current = false;
    fitView();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sizes]);

  const zoomBy = (factor, cx, cy) => {
    stopTween();
    const el = containerRef.current;
    const r = el.getBoundingClientRect();
    const v = viewRef.current;
    const k = clamp(v.k * factor, 0.2, 2.5);
    const px = cx ?? r.width / 2;
    const py = cy ?? r.height / 2;
    setView({ k, x: px - (px - v.x) * (k / v.k), y: py - (py - v.y) * (k / v.k) });
  };

  // Wheel pans, Ctrl/Cmd + wheel (or pinch) zooms - needs a non-passive listener.
  useEffect(() => {
    const el = containerRef.current;
    const onWheel = (e) => {
      if (e.target.closest?.("[data-ui]")) return;
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const r = el.getBoundingClientRect();
        zoomBy(Math.exp(-e.deltaY * 0.0025), e.clientX - r.left, e.clientY - r.top);
      } else {
        stopTween();
        const v = viewRef.current;
        setView({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY });
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toWorld = (clientX, clientY) => {
    const r = containerRef.current.getBoundingClientRect();
    const v = viewRef.current;
    return { x: (clientX - r.left - v.x) / v.k, y: (clientY - r.top - v.y) / v.k };
  };

  const viewCenterWorld = () => {
    const r = containerRef.current.getBoundingClientRect();
    return toWorld(r.left + r.width / 2, r.top + r.height / 2);
  };

  // ----- editing operations -----

  const markNewEdge = (id) => {
    setNewEdges((s) => new Set(s).add(id));
    setTimeout(() => {
      setNewEdges((s) => {
        const next = new Set(s);
        next.delete(id);
        return next;
      });
    }, 650);
  };

  const addNodeAt = (x, y, label) => {
    const node = makeNode(x, y, label);
    commit({ ...graphRef.current, nodes: [...graphRef.current.nodes, node] });
    setSelection({ ids: new Set([node.id]), edge: null });
    setEditingId(node.id);
    return node;
  };

  const updateNode = (id, changes) => {
    const g = graphRef.current;
    commit({ ...g, nodes: g.nodes.map((n) => (n.id === id ? { ...n, ...changes } : n)) });
  };

  const updateGroup = (id, changes) => {
    const g = graphRef.current;
    commit({ ...g, groups: g.groups.map((x) => (x.id === id ? { ...x, ...changes } : x)) });
  };

  const updateEdge = (id, changes) => {
    const g = graphRef.current;
    commit({ ...g, edges: g.edges.map((x) => (x.id === id ? { ...x, ...changes } : x)) });
  };

  const deleteSelection = (withGroupContents = false) => {
    const g = graphRef.current;
    if (selection.edge) {
      commit({ ...g, edges: g.edges.filter((e) => e.id !== selection.edge) });
      setSelection({ ids: new Set(), edge: null });
      return;
    }
    if (!selection.ids.size) return;
    const doomed = new Set(selection.ids);
    if (withGroupContents) {
      for (const id of selection.ids) {
        const gr = groupById.get(id);
        if (!gr) continue;
        const r = rectOf(id, false);
        g.nodes.forEach((n) => contains(r, rectOf(n.id, false)) && doomed.add(n.id));
        g.groups.forEach((x) => x.id !== id && contains(r, rectOf(x.id, false)) && doomed.add(x.id));
      }
    }
    commit({
      nodes: g.nodes.filter((n) => !doomed.has(n.id)),
      groups: g.groups.filter((x) => !doomed.has(x.id)),
      edges: g.edges.filter((e) => !doomed.has(e.from) && !doomed.has(e.to)),
    });
    setSelection({ ids: new Set(), edge: null });
  };

  const groupSelection = () => {
    const g = graphRef.current;
    const rects = [...selection.ids].map((id) => rectOf(id, false)).filter(Boolean);
    let group;
    if (rects.length) {
      const x = Math.min(...rects.map((r) => r.x)) - GROUP_PAD;
      const y = Math.min(...rects.map((r) => r.y)) - GROUP_HEAD - 6;
      const right = Math.max(...rects.map((r) => r.x + r.w)) + GROUP_PAD;
      const bottom = Math.max(...rects.map((r) => r.y + r.h)) + GROUP_PAD;
      group = { id: uid("g"), label: "Group", x: Math.round(x), y: Math.round(y), w: Math.round(right - x), h: Math.round(bottom - y) };
    } else {
      const c = viewCenterWorld();
      group = { id: uid("g"), label: "Group", x: Math.round(c.x - 110), y: Math.round(c.y - 80), w: 220, h: 160 };
    }
    commit({ ...g, groups: [...g.groups, group] });
    setSelection({ ids: new Set([group.id]), edge: null });
    setEditingId(group.id);
  };

  const fitGroupToContents = (id) => {
    const g = graphRef.current;
    const gr = groupById.get(id);
    const r = rectOf(id, false);
    const members = g.nodes.map((n) => rectOf(n.id, false)).filter((nr) => inside(center(nr), r));
    if (!gr || !members.length) return;
    const x = Math.min(...members.map((m) => m.x)) - GROUP_PAD;
    const y = Math.min(...members.map((m) => m.y)) - GROUP_HEAD - 6;
    const w = Math.max(...members.map((m) => m.x + m.w)) + GROUP_PAD - x;
    const h = Math.max(...members.map((m) => m.y + m.h)) + GROUP_PAD - y;
    updateGroup(id, { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) });
  };

  /** What moves when the given ids are dragged: groups carry the nodes/groups inside them. */
  const collectMovable = (ids) => {
    const g = graphRef.current;
    const moving = new Map();
    const addItem = (id) => targets[id] && !moving.has(id) && moving.set(id, { ...targets[id] });
    for (const id of ids) {
      addItem(id);
      if (groupById.has(id)) {
        const r = rectOf(id, false);
        g.nodes.forEach((n) => inside(center(rectOf(n.id, false)), r) && addItem(n.id));
        g.groups.forEach((x) => x.id !== id && contains(r, rectOf(x.id, false)) && addItem(x.id));
      }
    }
    return moving;
  };

  // ----- pointer interaction -----

  const onPointerDown = (e) => {
    if (e.button !== 0 && e.button !== 1) return;
    if (e.target.closest("[data-ui]") || e.target.closest("input")) return;
    containerRef.current.focus({ preventScroll: true });
    const world = toWorld(e.clientX, e.clientY);
    const base = { startX: e.clientX, startY: e.clientY, moved: false, startGraph: graphRef.current };
    const handle = e.target.closest("[data-handle]");
    const resize = e.target.closest("[data-resize]");
    const nodeEl = e.target.closest("[data-node-id]");
    const groupEl = e.target.closest("[data-group-id]");
    const edgeEl = e.target.closest("[data-edge-id]");

    const pick = (id) => {
      let ids = selection.ids;
      if (e.shiftKey) {
        ids = new Set(ids);
        ids.has(id) ? ids.delete(id) : ids.add(id);
      } else if (!ids.has(id)) {
        ids = new Set([id]);
      }
      setSelection({ ids, edge: null });
      return ids;
    };

    if (e.button === 1) {
      drag.current = { ...base, type: "pan", view: viewRef.current };
    } else if (handle) {
      const from = handle.dataset.handle;
      drag.current = { ...base, type: "connect", from };
      setConnect({ from, x: world.x, y: world.y, target: null });
    } else if (resize) {
      const id = resize.dataset.resize;
      const gr = groupById.get(id);
      drag.current = { ...base, type: "resize", id, w: gr.w, h: gr.h };
    } else if (nodeEl || groupEl) {
      const id = nodeEl ? nodeEl.dataset.nodeId : groupEl.dataset.groupId;
      const ids = pick(id);
      drag.current = { ...base, type: "move", moving: collectMovable(ids), clickedId: id, mod: e.ctrlKey || e.metaKey };
    } else if (edgeEl) {
      setSelection({ ids: new Set(), edge: edgeEl.dataset.edgeId });
      return;
    } else if (e.shiftKey) {
      drag.current = { ...base, type: "box" };
      setBox({ x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY });
    } else {
      drag.current = { ...base, type: "pan", view: viewRef.current };
    }
    capture(containerRef.current, e.pointerId, true);
  };

  const targetUnder = (clientX, clientY, from) => {
    const el = document.elementFromPoint(clientX, clientY);
    const id = el?.closest?.("[data-node-id]")?.dataset.nodeId || el?.closest?.("[data-group-id]")?.dataset.groupId || null;
    return id && id !== from ? id : null;
  };

  const onPointerMove = (e) => {
    const d = drag.current;
    if (!d) return;
    const dxs = e.clientX - d.startX;
    const dys = e.clientY - d.startY;
    if (!d.moved && Math.hypot(dxs, dys) > 3) d.moved = true;
    if (!d.moved) return;
    const k = viewRef.current.k;

    if (d.type === "pan") {
      stopTween();
      setView({ ...d.view, x: d.view.x + dxs, y: d.view.y + dys });
    } else if (d.type === "move") {
      const g = graphRef.current;
      const shift = (item) => {
        const start = d.moving.get(item.id);
        return start ? { ...item, x: Math.round(start.x + dxs / k), y: Math.round(start.y + dys / k) } : item;
      };
      setGraph({ ...g, nodes: g.nodes.map(shift), groups: g.groups.map(shift) });
    } else if (d.type === "resize") {
      const g = graphRef.current;
      setGraph({
        ...g,
        groups: g.groups.map((x) =>
          x.id === d.id ? { ...x, w: Math.max(120, Math.round(d.w + dxs / k)), h: Math.max(70, Math.round(d.h + dys / k)) } : x
        ),
      });
    } else if (d.type === "box") {
      setBox((b) => ({ ...b, x1: e.clientX, y1: e.clientY }));
    } else if (d.type === "connect") {
      const world = toWorld(e.clientX, e.clientY);
      setConnect({ from: d.from, x: world.x, y: world.y, target: targetUnder(e.clientX, e.clientY, d.from) });
    }
  };

  const onPointerUp = (e) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    capture(containerRef.current, e.pointerId, false);
    const g = graphRef.current;

    if (d.type === "pan") {
      if (!d.moved) setSelection({ ids: new Set(), edge: null });
    } else if (d.type === "move" || d.type === "resize") {
      if (d.moved) commit(g, d.startGraph);
      else if (d.type === "move" && d.mod) {
        const node = nodeById.get(d.clickedId);
        if (node?.noteId) navigate(`/notes/${node.noteId}`);
      }
    } else if (d.type === "box") {
      setBox(null);
      if (!d.moved) return;
      const a = toWorld(Math.min(d.startX, e.clientX), Math.min(d.startY, e.clientY));
      const b = toWorld(Math.max(d.startX, e.clientX), Math.max(d.startY, e.clientY));
      const area = { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
      const ids = new Set(g.nodes.filter((n) => intersects(area, rectOf(n.id, false))).map((n) => n.id));
      g.groups.forEach((x) => contains(area, rectOf(x.id, false)) && ids.add(x.id));
      setSelection({ ids, edge: null });
    } else if (d.type === "connect") {
      setConnect(null);
      const target = targetUnder(e.clientX, e.clientY, d.from);
      if (target) {
        if (!g.edges.some((x) => x.from === d.from && x.to === target)) {
          const edge = { id: uid("e"), from: d.from, to: target, style: "solid" };
          commit({ ...g, edges: [...g.edges, edge] });
          markNewEdge(edge.id);
        }
      } else if (d.moved) {
        // Dropped on empty canvas: create a node there, already connected.
        const world = toWorld(e.clientX, e.clientY);
        const node = makeNode(world.x - DEFAULT_NODE.w / 2, world.y - DEFAULT_NODE.h / 2);
        const edge = { id: uid("e"), from: d.from, to: node.id, style: "solid" };
        commit({ ...g, nodes: [...g.nodes, node], edges: [...g.edges, edge] });
        markNewEdge(edge.id);
        setSelection({ ids: new Set([node.id]), edge: null });
        setEditingId(node.id);
      }
    }
  };

  const onDoubleClick = (e) => {
    if (e.target.closest("[data-ui]") || e.target.closest("input")) return;
    const nodeEl = e.target.closest("[data-node-id]");
    const head = e.target.closest("[data-group-head]");
    if (nodeEl) return setEditingId(nodeEl.dataset.nodeId);
    if (head) return setEditingId(head.dataset.groupHead);
    if (e.target.closest("[data-edge-id]")) return;
    const w = toWorld(e.clientX, e.clientY);
    addNodeAt(w.x - DEFAULT_NODE.w / 2, w.y - DEFAULT_NODE.h / 2);
  };

  const onKeyDown = (e) => {
    if (editingId || e.target.closest?.("input, textarea, select")) return;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (mod && key === "z") {
      e.preventDefault();
      e.shiftKey ? redo() : undo();
    } else if (mod && key === "y") {
      e.preventDefault();
      redo();
    } else if (mod && key === "g") {
      e.preventDefault();
      groupSelection();
    } else if (mod && key === "a") {
      e.preventDefault();
      setSelection({ ids: new Set(graph.nodes.map((n) => n.id)), edge: null });
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      deleteSelection();
    } else if (e.key === "Escape") {
      setSelection({ ids: new Set(), edge: null });
    } else if (e.key === "Enter" && selection.ids.size === 1) {
      e.preventDefault();
      setEditingId([...selection.ids][0]);
    } else if (!mod && key === "f") {
      fitView();
    } else if (!mod && key === "n") {
      const c = viewCenterWorld();
      addNodeAt(c.x - DEFAULT_NODE.w / 2, c.y - DEFAULT_NODE.h / 2);
    }
  };

  // ----- inline renaming -----

  useEffect(() => {
    if (editingId) editStart.current = graphRef.current;
  }, [editingId]);

  const setLabelLive = (id, label) => {
    const g = graphRef.current;
    if (nodeById.has(id)) setGraph({ ...g, nodes: g.nodes.map((n) => (n.id === id ? { ...n, label } : n)) });
    else setGraph({ ...g, groups: g.groups.map((x) => (x.id === id ? { ...x, label } : x)) });
  };

  const finishEditing = (cancel = false) => {
    const id = editingId;
    const start = editStart.current;
    setEditingId(null);
    editStart.current = null;
    if (!id || !start) return; // already finished (blur after Enter)
    if (cancel) {
      setGraph(start);
      return;
    }
    const g = graphRef.current;
    const current = g.nodes.find((n) => n.id === id) || g.groups.find((x) => x.id === id);
    if (current && !current.label.trim()) setLabelLive(id, nodeById.has(id) ? "Untitled" : "Group");
    if (graphRef.current !== start) commit(graphRef.current, start);
  };

  const labelInput = (id, value, className) => (
    <input
      autoFocus
      value={value}
      onFocus={(e) => e.target.select()}
      onChange={(e) => setLabelLive(id, e.target.value)}
      onBlur={() => finishEditing()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") finishEditing();
        if (e.key === "Escape") finishEditing(true);
      }}
      onPointerDown={(e) => e.stopPropagation()}
      size={Math.max(4, value.length)}
      className={`rounded bg-surface px-1 text-center text-ink outline-none ring-1 ring-indigo-400 ${className}`}
    />
  );

  // ----- derived render state -----

  const hoverEdgeId = hover?.startsWith("edge:") ? hover.slice(5) : null;
  const hoverItemId = hover && !hoverEdgeId ? hover : null;
  const focusEdges = new Set();
  const focusItems = new Set();
  if (hoverItemId && !drag.current) {
    focusItems.add(hoverItemId);
    for (const e of graph.edges) {
      if (e.from === hoverItemId || e.to === hoverItemId) {
        focusEdges.add(e.id);
        focusItems.add(e.from);
        focusItems.add(e.to);
      }
    }
  } else if (hoverEdgeId) {
    const e = graph.edges.find((x) => x.id === hoverEdgeId);
    if (e) {
      focusEdges.add(e.id);
      focusItems.add(e.from);
      focusItems.add(e.to);
    }
  }
  const focusing = focusEdges.size > 0 || focusItems.size > 0;

  const paths = layoutEdges(graph.edges, (id) => rectOf(id));
  const orderedPaths = [...paths].sort((a, b) => Number(focusEdges.has(a.edge.id)) - Number(focusEdges.has(b.edge.id)));

  // SVG canvas big enough for everything currently drawn.
  const allRects = [...graph.nodes.map((n) => rectOf(n.id)), ...graph.groups.map((g) => rectOf(g.id))].filter(Boolean);
  if (connect) allRects.push({ x: connect.x, y: connect.y, w: 1, h: 1 });
  const svgBox = allRects.length
    ? {
        x: Math.min(...allRects.map((r) => r.x)) - 300,
        y: Math.min(...allRects.map((r) => r.y)) - 300,
        x2: Math.max(...allRects.map((r) => r.x + r.w)) + 300,
        y2: Math.max(...allRects.map((r) => r.y + r.h)) + 300,
      }
    : { x: 0, y: 0, x2: 1, y2: 1 };

  const groupsByArea = [...graph.groups].sort((a, b) => b.w * b.h - a.w * a.h);
  const selectedNode = selection.ids.size === 1 ? nodeById.get([...selection.ids][0]) : null;
  const selectedGroup = selection.ids.size === 1 ? groupById.get([...selection.ids][0]) : null;
  const selectedEdge = selection.edge ? graph.edges.find((e) => e.id === selection.edge) : null;
  const linkableNotes = notes.filter((n) => n.id !== noteId);

  const edgeState = (id) => {
    if (newEdges.has(id)) return "new";
    if (selection.edge === id) return "selected";
    if (focusEdges.has(id)) return "flow";
    if (focusing) return "dim";
    return "normal";
  };

  const connectSource = connect ? rectOf(connect.from) : null;

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      data-canvas
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
      onKeyDown={onKeyDown}
      className={`graph-canvas relative select-none overflow-hidden outline-none ${connect ? "cursor-crosshair" : "cursor-default"} ${className}`}
      style={{
        backgroundSize: `${22 * view.k}px ${22 * view.k}px`,
        backgroundPosition: `${view.x}px ${view.y}px`,
        touchAction: "none",
      }}
    >
      {/* ---------- world ---------- */}
      <div
        ref={worldRef}
        className="absolute left-0 top-0"
        style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})`, transformOrigin: "0 0" }}
      >
        {groupsByArea.map((g) => {
          const p = pos(g.id);
          const isSel = selection.ids.has(g.id);
          const state = hoverItemId === g.id ? "is-hover" : isSel ? "is-selected" : focusing && !focusItems.has(g.id) ? "is-dim" : "";
          return (
            <div
              key={g.id}
              data-group-id={g.id}
              className={`ggroup ${state} ${isSel ? "is-selected" : ""}`}
              style={{ transform: `translate(${p.x}px, ${p.y}px)`, width: g.w, height: g.h }}
              onMouseEnter={() => setHover(g.id)}
              onMouseLeave={() => setHover((h) => (h === g.id ? null : h))}
            >
              <div data-group-head={g.id} className="absolute left-3 top-2 cursor-grab text-[11px] font-semibold tracking-wide text-slate-300">
                {editingId === g.id ? labelInput(g.id, g.label, "text-[11px]") : g.label}
              </div>
              <div data-resize={g.id} className="ggroup-resize" title="Resize" />
              {SIDES.map((s) => (
                <span key={s} data-handle={g.id} className={`ghandle ghandle-${s}`} />
              ))}
            </div>
          );
        })}

        <svg
          className="pointer-events-none absolute overflow-visible"
          style={{ left: svgBox.x, top: svgBox.y, width: svgBox.x2 - svgBox.x, height: svgBox.y2 - svgBox.y }}
        >
          <defs>
            {[
              ["normal", "#64748b"],
              ["dim", "#64748b"],
              ["flow", "#a5b4fc"],
              ["selected", "#818cf8"],
            ].map(([state, color]) => (
              <marker
                key={state}
                id={`${markerPrefix}-${state}`}
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="9"
                markerHeight="9"
                markerUnits="userSpaceOnUse"
                orient="auto-start-reverse"
              >
                <path d="M0,1 L10,5 L0,9 z" fill={color} />
              </marker>
            ))}
          </defs>
          <g transform={`translate(${-svgBox.x} ${-svgBox.y})`}>
            {orderedPaths.map(({ edge, d }) => {
              const state = edgeState(edge.id);
              return (
                <g
                  key={edge.id}
                  data-edge-id={edge.id}
                  onMouseEnter={() => setHover(`edge:${edge.id}`)}
                  onMouseLeave={() => setHover((h) => (h === `edge:${edge.id}` ? null : h))}
                >
                  <path d={d} fill="none" stroke="transparent" strokeWidth={14} style={{ pointerEvents: "stroke", cursor: "pointer" }} />
                  <path
                    d={d}
                    pathLength={state === "new" ? 1 : undefined}
                    className={`gedge is-${state} ${edge.style === "dashed" ? "is-dashed" : ""}`}
                    markerEnd={state === "new" ? undefined : `url(#${markerPrefix}-${state})`}
                  />
                </g>
              );
            })}
            {connect && connectSource && (
              <path
                d={`M ${center(connectSource).x} ${center(connectSource).y} L ${connect.x} ${connect.y}`}
                className="gedge is-flow"
                markerEnd={`url(#${markerPrefix}-flow)`}
              />
            )}
          </g>
        </svg>

        {graph.nodes.map((n) => {
          const p = pos(n.id);
          const isSel = selection.ids.has(n.id);
          const classes = [
            "gnode gnode-in",
            n.accent ? "is-accent" : "",
            isSel ? "is-selected" : "",
            hoverItemId === n.id || connect?.target === n.id ? "is-hover" : "",
            focusing && !focusItems.has(n.id) ? "is-dim" : "",
            focusing && focusItems.has(n.id) && hoverItemId !== n.id ? "is-related" : "",
          ].join(" ");
          return (
            <div
              key={n.id}
              data-node-id={n.id}
              className={classes}
              style={{ transform: `translate(${p.x}px, ${p.y}px)` }}
              onMouseEnter={() => setHover(n.id)}
              onMouseLeave={() => setHover((h) => (h === n.id ? null : h))}
              title={n.noteId ? "Ctrl+click to open the linked note" : undefined}
            >
              {editingId === n.id ? labelInput(n.id, n.label, "text-[13px] font-semibold") : <span>{n.label}</span>}
              {n.progress !== null && n.progress !== undefined && (
                <div className="mt-2 h-[3px] w-full overflow-hidden rounded-full bg-slate-600/50">
                  <div
                    className="h-full rounded-full bg-blue-500 transition-all duration-300"
                    style={{ width: `${n.progress}%` }}
                  />
                </div>
              )}
              {n.priority && (
                <span className="gstatus" style={{ background: PRIORITY_COLORS[n.priority] }} title={`${PRIORITY_LABEL[n.priority]} priority`} />
              )}
              {n.noteId && <span className="glink" title="Linked note">↗</span>}
              {SIDES.map((s) => (
                <span key={s} data-handle={n.id} className={`ghandle ghandle-${s}`} />
              ))}
            </div>
          );
        })}
      </div>

      {/* ---------- overlays ---------- */}
      {box && (
        <div
          className="pointer-events-none absolute rounded border border-indigo-400/70 bg-indigo-400/10"
          style={(() => {
            const r = containerRef.current.getBoundingClientRect();
            return {
              left: Math.min(box.x0, box.x1) - r.left,
              top: Math.min(box.y0, box.y1) - r.top,
              width: Math.abs(box.x1 - box.x0),
              height: Math.abs(box.y1 - box.y0),
            };
          })()}
        />
      )}

      {graph.nodes.length === 0 && graph.groups.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center">
          <p className={`${compact ? "text-xs" : "text-sm"} text-surface-muted`}>Double-click anywhere to add a node</p>
          {!compact && (
            <>
              <p className="text-xs text-surface-muted/70">Drag from the dots on a node's edge to connect it to another</p>
              <button
                data-ui
                onClick={() => {
                  pendingFit.current = true;
                  commit(exampleGraph());
                }}
                className="btn-secondary pointer-events-auto mt-2 min-h-[36px] py-1.5 text-xs">
                Load example roadmap
              </button>
            </>
          )}
        </div>
      )}

      <div data-ui className="absolute left-2 top-2 flex items-center gap-0.5 rounded-lg border border-surface-border bg-surface-card/90 p-0.5 shadow-lg backdrop-blur">
        <ToolButton onClick={() => { const c = viewCenterWorld(); addNodeAt(c.x - DEFAULT_NODE.w / 2, c.y - DEFAULT_NODE.h / 2); }} title="Add node (N)">
          + Node
        </ToolButton>
        {!compact && (
          <>
            <ToolButton onClick={groupSelection} title="Group selection (Ctrl+G)">
              ▢ Group
            </ToolButton>
            <ToolButton onClick={undo} title="Undo (Ctrl+Z)" disabled={!history.current.past.length}>
              ↶
            </ToolButton>
            <ToolButton onClick={redo} title="Redo (Ctrl+Y)" disabled={!history.current.future.length}>
              ↷
            </ToolButton>
          </>
        )}
        <ToolButton onClick={() => fitView()} title="Fit to view (F)">
          ⤢
        </ToolButton>
        {!compact && (
          <ToolButton onClick={() => setShowHelp((v) => !v)} title="Shortcuts">
            ?
          </ToolButton>
        )}
      </div>

      {showHelp && !compact && (
        <div data-ui className="absolute left-2 top-12 z-10 w-64 animate-fade-in rounded-xl border border-surface-border bg-surface-card/95 p-3 text-xs text-ink-soft shadow-xl backdrop-blur">
          {[
            ["Double-click", "add node / rename"],
            ["Drag edge dots", "connect (drop on empty space for a new node)"],
            ["Shift + drag", "box select"],
            ["Drag background", "pan · wheel pans"],
            ["Ctrl + wheel", "zoom"],
            ["Ctrl + G", "group selection"],
            ["Ctrl + Z / Y", "undo / redo"],
            ["Delete", "remove selection"],
            ["Ctrl + click", "open a node's linked note"],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between gap-3 py-0.5">
              <span className="font-semibold text-ink">{k}</span>
              <span className="text-right text-surface-muted">{v}</span>
            </div>
          ))}
        </div>
      )}

      <div
        data-ui
        className={`absolute bottom-2 flex items-center gap-0.5 rounded-lg border border-surface-border bg-surface-card/90 p-0.5 text-xs shadow-lg backdrop-blur ${
          compact ? "right-2" : "left-2"
        }`}
      >
        <ToolButton onClick={() => zoomBy(1 / 1.2)} title="Zoom out">
          −
        </ToolButton>
        <span className="w-10 text-center tabular-nums text-surface-muted">{Math.round(view.k * 100)}%</span>
        <ToolButton onClick={() => zoomBy(1.2)} title="Zoom in">
          +
        </ToolButton>
      </div>

      {(selectedNode || selectedGroup || selectedEdge || selection.ids.size > 1) && (
        <Inspector
          compact={compact}
          node={selectedNode}
          group={selectedGroup}
          edge={selectedEdge}
          count={selection.ids.size}
          notes={linkableNotes}
          onNode={(changes) => updateNode(selectedNode.id, changes)}
          onGroup={(changes) => updateGroup(selectedGroup.id, changes)}
          onEdge={(changes) => updateEdge(selectedEdge.id, changes)}
          onReverse={() => updateEdge(selectedEdge.id, { from: selectedEdge.to, to: selectedEdge.from })}
          onFitGroup={() => fitGroupToContents(selectedGroup.id)}
          onGroupSelection={groupSelection}
          onDelete={deleteSelection}
          onOpenNote={(id) => navigate(`/notes/${id}`)}
        />
      )}
    </div>
  );
}

function ToolButton({ children, onClick, title, disabled }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      disabled={disabled}
      className="min-w-[28px] rounded-md px-2 py-1 text-xs font-medium text-ink-soft hover:bg-surface hover:text-ink disabled:opacity-30"
    >
      {children}
    </button>
  );
}

function Inspector({ compact, node, group, edge, count, notes, onNode, onGroup, onEdge, onReverse, onFitGroup, onGroupSelection, onDelete, onOpenNote }) {
  const panel = compact
    ? "absolute bottom-2 left-2 right-16 flex flex-wrap items-center gap-1.5 rounded-lg border border-surface-border bg-surface-card/95 p-1.5 shadow-lg backdrop-blur"
    : "absolute right-2 top-2 w-60 animate-fade-in rounded-xl border border-surface-border bg-surface-card/95 p-3 shadow-xl backdrop-blur";
  const label = "mb-1 block text-[10px] font-semibold uppercase tracking-wider text-surface-muted";
  const chip = (active) =>
    `rounded-md px-2 py-1 text-[11px] font-medium ${active ? "bg-indigo-500/25 text-ink ring-1 ring-indigo-400/60" : "bg-surface text-ink-soft hover:text-ink"}`;

  const priorityRow = node && (
    <div className="flex flex-wrap items-center gap-1">
      {[null, "low", "medium", "high"].map((p) => (
        <button
          key={p ?? "none"}
          type="button"
          title={p ? `${PRIORITY_LABEL[p]} priority` : "No priority"}
          onClick={() => onNode({ priority: p })}
          className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium ${
            node.priority === p ? "bg-indigo-500/25 text-ink ring-1 ring-indigo-400/60" : "bg-surface text-ink-soft hover:text-ink"
          }`}
        >
          <span
            className="h-2.5 w-2.5 rounded-full"
            style={{ background: p ? PRIORITY_COLORS[p] : "transparent", border: p ? "none" : "1.5px dashed #64748b" }}
          />
          {p ? PRIORITY_LABEL[p] : "None"}
        </button>
      ))}
    </div>
  );

  if (compact) {
    return (
      <div data-ui className={panel}>
        {node && priorityRow}
        {edge && (
          <button type="button" className={chip(edge.style === "dashed")} onClick={() => onEdge({ style: edge.style === "dashed" ? "solid" : "dashed" })}>
            {edge.style === "dashed" ? "Dashed" : "Solid"}
          </button>
        )}
        <button type="button" onClick={() => onDelete()} className="ml-auto rounded-md px-2 py-1 text-[11px] font-medium text-red-700 hover:bg-red-500/15">
          Delete
        </button>
      </div>
    );
  }

  return (
    <div data-ui className={panel}>
      {node && (
        <div className="flex flex-col gap-3">
          <div>
            <span className={label}>Node</span>
            <input value={node.label} onChange={(e) => onNode({ label: e.target.value })} className="input min-h-[34px] py-1.5 text-xs" />
          </div>
          <div>
            <span className={label}>Priority</span>
            {priorityRow}
          </div>
          <div>
            <span className={label}>
              Progress {node.progress !== null && node.progress !== undefined ? `· ${node.progress}%` : ""}
            </span>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min="0"
                max="100"
                step="5"
                disabled={node.progress === null || node.progress === undefined}
                value={node.progress ?? 0}
                onChange={(e) => onNode({ progress: Number(e.target.value) })}
                className="flex-1 accent-indigo-500 disabled:opacity-30"
              />
              <button type="button" className={chip(node.progress !== null && node.progress !== undefined)} onClick={() => onNode({ progress: node.progress === null || node.progress === undefined ? 0 : null })}>
                {node.progress === null || node.progress === undefined ? "Off" : "On"}
              </button>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <span className={`${label} mb-0`}>Accent border</span>
            <button
              type="button"
              role="switch"
              aria-checked={Boolean(node.accent)}
              onClick={() => onNode({ accent: !node.accent })}
              className={`relative h-5 w-9 rounded-full transition-colors ${node.accent ? "bg-emerald-500" : "bg-surface-border"}`}
              title="Highlight this node (e.g. a milestone)"
            >
              <span className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform duration-200 ${node.accent ? "translate-x-4" : ""}`} />
            </button>
          </div>
          <div>
            <span className={label}>Linked note</span>
            <div className="flex gap-1">
              <select
                value={node.noteId ?? ""}
                onChange={(e) => onNode({ noteId: e.target.value ? Number(e.target.value) : null })}
                className="input min-h-[34px] flex-1 py-1 text-xs"
              >
                <option value="">None</option>
                {notes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.title}
                  </option>
                ))}
              </select>
              {node.noteId && (
                <button type="button" onClick={() => onOpenNote(node.noteId)} className="btn-secondary min-h-[34px] px-2 py-1 text-xs" title="Open linked note">
                  ↗
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {group && (
        <div className="flex flex-col gap-3">
          <div>
            <span className={label}>Group</span>
            <input value={group.label} onChange={(e) => onGroup({ label: e.target.value })} className="input min-h-[34px] py-1.5 text-xs" />
          </div>
          <button type="button" onClick={onFitGroup} className="btn-secondary min-h-[34px] py-1 text-xs">
            Fit to contents
          </button>
          <button type="button" onClick={() => onDelete(true)} className="btn min-h-[34px] bg-red-500/10 py-1 text-xs text-red-700 hover:bg-red-500/20">
            Delete group and contents
          </button>
        </div>
      )}

      {edge && (
        <div className="flex flex-col gap-3">
          <span className={label}>Connection</span>
          <div className="flex gap-1">
            {["solid", "dashed"].map((s) => (
              <button key={s} type="button" className={chip(edge.style === s)} onClick={() => onEdge({ style: s })}>
                {s === "solid" ? "Solid" : "Dashed"}
              </button>
            ))}
            <button type="button" className={chip(false)} onClick={onReverse}>
              ⇄ Reverse
            </button>
          </div>
        </div>
      )}

      {count > 1 && (
        <div className="flex flex-col gap-2">
          <span className={label}>{count} selected</span>
          <button type="button" onClick={onGroupSelection} className="btn-secondary min-h-[34px] py-1 text-xs">
            Group them (Ctrl+G)
          </button>
        </div>
      )}

      <button type="button" onClick={() => onDelete()} className="mt-3 w-full rounded-lg py-1.5 text-xs font-medium text-red-700 hover:bg-red-500/15">
        {group ? "Delete group (keep contents)" : "Delete"}
      </button>
    </div>
  );
}
