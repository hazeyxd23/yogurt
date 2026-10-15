import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  createNote as apiCreateNote,
  deleteNote as apiDeleteNote,
  getDashboardNote,
  getNotes,
  getSystemNote,
  isCancel,
  updateNote as apiUpdateNote,
  updateNoteKeepalive,
} from "../services/api";
import { useToast } from "./ToastContext";

const NotesContext = createContext(null);

const SAVE_DELAY_MS = 700;

/**
 * One shared store for every note on screen (Notes page, floating notes, dashboard),
 * so an edit in one place shows up everywhere immediately. Edits apply locally right
 * away and are saved per note after a short pause; title changes trigger a refetch
 * because the backend rewrites [[links]] in other notes.
 */
export function NotesProvider({ children }) {
  const [notes, setNotes] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const pending = useRef(new Map()); // id -> { changes, timer }
  const { showToast } = useToast();

  const applyPending = (list) =>
    list.map((n) => (pending.current.has(n.id) ? { ...n, ...pending.current.get(n.id).changes } : n));

  const refresh = useCallback(async (signal) => {
    try {
      const list = await getNotes(signal);
      setNotes(applyPending(list));
      setLoaded(true);
      setError(null);
    } catch (err) {
      if (!isCancel(err)) setError("Couldn't load notes. Is the backend running?");
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    // Make sure the dashboard note exists before listing everything.
    getDashboardNote(controller.signal)
      .catch(() => null)
      .then(() => refresh(controller.signal));
    return () => controller.abort();
  }, [refresh]);

  const flush = useCallback(
    async (id) => {
      const entry = pending.current.get(id);
      if (!entry) return;
      pending.current.delete(id);
      clearTimeout(entry.timer);
      setSaving(true);
      try {
        const saved = await apiUpdateNote(id, entry.changes);
        setNotes((prev) => prev.map((n) => (n.id === id ? { ...n, updated_at: saved.updated_at } : n)));
        if ("title" in entry.changes) await refresh();
      } catch {
        showToast("Couldn't save your note", "error");
      } finally {
        setSaving(pending.current.size > 0);
      }
    },
    [refresh, showToast]
  );

  // Save anything still pending if the tab is closed mid-edit.
  useEffect(() => {
    const onUnload = () => {
      for (const [id, entry] of pending.current) updateNoteKeepalive(id, entry.changes);
    };
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, []);

  const updateNote = useCallback(
    (id, changes, { immediate = false } = {}) => {
      setNotes((prev) => prev.map((n) => (n.id === id ? { ...n, ...changes } : n)));
      const existing = pending.current.get(id);
      if (existing) clearTimeout(existing.timer);
      const entry = { changes: { ...existing?.changes, ...changes } };
      entry.timer = setTimeout(() => flush(id), immediate ? 0 : SAVE_DELAY_MS);
      pending.current.set(id, entry);
      setSaving(true);
    },
    [flush]
  );

  const createNote = useCallback(
    async (data) => {
      try {
        const note = await apiCreateNote(data);
        setNotes((prev) => [note, ...prev]);
        return note;
      } catch {
        showToast("Couldn't create the note", "error");
        return null;
      }
    },
    [showToast]
  );

  const deleteNote = useCallback(
    async (id) => {
      const entry = pending.current.get(id);
      if (entry) {
        clearTimeout(entry.timer);
        pending.current.delete(id);
      }
      try {
        await apiDeleteNote(id);
        setNotes((prev) => prev.filter((n) => n.id !== id));
        return true;
      } catch {
        showToast("Couldn't delete the note", "error");
        return false;
      }
    },
    [showToast]
  );

  /** Fetch (creating if needed) an app-owned note and make sure it's in the store. */
  const ensureSystemNote = useCallback(async (key) => {
    try {
      const note = await getSystemNote(key);
      setNotes((prev) => (prev.some((n) => n.id === note.id) ? prev : [note, ...prev]));
      return note;
    } catch {
      return null;
    }
  }, []);

  const findByTitle = useCallback(
    (title) => {
      const wanted = title.trim().toLowerCase();
      return notes.find((n) => n.title.trim().toLowerCase() === wanted) || null;
    },
    [notes]
  );

  /** Resolve a [[link]] target, creating the note if it doesn't exist yet (like Obsidian). */
  const openOrCreateByTitle = useCallback(
    async (title) => findByTitle(title) || (await createNote({ title: title.trim() || "Untitled" })),
    [findByTitle, createNote]
  );

  const value = useMemo(
    () => ({
      notes,
      loaded,
      error,
      saving,
      refresh,
      updateNote,
      createNote,
      deleteNote,
      findByTitle,
      openOrCreateByTitle,
      ensureSystemNote,
      dashboardNote: notes.find((n) => n.is_dashboard) || null,
    }),
    [notes, loaded, error, saving, refresh, updateNote, createNote, deleteNote, findByTitle, openOrCreateByTitle, ensureSystemNote]
  );

  return <NotesContext.Provider value={value}>{children}</NotesContext.Provider>;
}

export function useNotes() {
  const ctx = useContext(NotesContext);
  if (!ctx) throw new Error("useNotes must be used within a NotesProvider");
  return ctx;
}
