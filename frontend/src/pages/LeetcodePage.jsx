import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import ProblemForm from "../components/Leetcode/ProblemForm";
import LeetcodeStats from "../components/Leetcode/LeetcodeStats";
import NoteEditor from "../components/Notes/NoteEditor";
import { getLeetcodeProblems, isCancel, updateLeetcodeProblem } from "../services/api";
import { useNotes } from "../context/NotesContext";
import LoadingState from "../components/common/LoadingState";
import ErrorMessage from "../components/common/ErrorMessage";

const TASK_LINE = /^\s*[-*+] \[([ xX])\](?: (.*))?$/;

/** "Two Sum #easy" / "[[Two Sum]]" -> "two sum" for matching note lines to tracked problems. */
function problemKey(text) {
  return (text || "")
    .replace(/\[\[([^\]|]+)(\|[^\]]+)?\]\]/g, "$1")
    .replace(/(^|\s)#[A-Za-z][\w-]*/g, " ")
    .replace(/[*_~=`]/g, "")
    .trim()
    .toLowerCase();
}

function tickedProblems(content) {
  const ticked = new Map();
  for (const line of (content || "").split("\n")) {
    const m = line.match(TASK_LINE);
    if (m) ticked.set(problemKey(m[2]), m[1] !== " ");
  }
  return ticked;
}

function appendLines(content, lines) {
  const base = (content || "").replace(/\n+$/, "");
  return `${base ? `${base}\n` : ""}${lines.join("\n")}\n`;
}

export default function LeetcodePage() {
  const { notes, updateNote, ensureSystemNote } = useNotes();
  const [noteId, setNoteId] = useState(null);
  const [problems, setProblems] = useState([]);
  const [error, setError] = useState(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const syncTimer = useRef(null);

  const note = notes.find((n) => n.id === noteId) || null;

  useEffect(() => {
    let alive = true;
    ensureSystemNote("leetcode").then((n) => {
      if (!alive) return;
      if (n) setNoteId(n.id);
      else setError("Couldn't load your problems note. Is the backend running?");
    });
    return () => {
      alive = false;
    };
  }, [ensureSystemNote]);

  const loadProblems = useCallback(async (signal) => {
    try {
      setProblems(await getLeetcodeProblems(signal));
    } catch (err) {
      if (!isCancel(err)) setError("Couldn't load your problems. Is the backend running?");
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    loadProblems(controller.signal);
    return () => controller.abort();
  }, [loadProblems, refreshToken]);

  // Ticking a problem in the note marks it solved (and unticking un-solves it), so the
  // stats, streaks and heatmap keep working off the tracked problems.
  useEffect(() => {
    if (!note) return undefined;
    clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(async () => {
      const ticked = tickedProblems(note.content);
      const changes = problems.filter((p) => {
        const key = problemKey(p.question_name);
        return ticked.has(key) && ticked.get(key) !== p.solved;
      });
      if (!changes.length) return;
      const today = new Date().toISOString().slice(0, 10);
      await Promise.allSettled(
        changes.map((p) => updateLeetcodeProblem(p.id, { solved: !p.solved, solved_date: !p.solved ? today : null }))
      );
      setRefreshToken((t) => t + 1);
    }, 500);
    return () => clearTimeout(syncTimer.current);
  }, [note?.content, problems]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleAdded = (problem) => {
    if (!note || !problem) return;
    const tag = problem.difficulty ? ` #${problem.difficulty.toLowerCase()}` : "";
    const lines = [`- [ ] ${problem.question_name}${tag}`];
    if (problem.key_note) lines.push(`  - ${problem.key_note}`);
    updateNote(note.id, { content: appendLines(note.content, lines) }, { immediate: true });
    setRefreshToken((t) => t + 1);
  };

  const solved = problems.filter((p) => p.solved).length;

  return (
    <div>
      {error && (
        <div className="mb-6">
          <ErrorMessage message={error} />
        </div>
      )}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-6">
          <ProblemForm onAdded={handleAdded} />
          <div className="card">
            <div className="mb-3 flex items-baseline justify-between">
              <h3>Problems</h3>
              <span className="text-xs text-surface-muted">
                {solved}/{problems.length} solved
                {note && (
                  <>
                    {" · "}
                    <Link to={`/notes/${note.id}`} className="hover:text-ink">
                      Open in Notes ↗
                    </Link>
                  </>
                )}
              </span>
            </div>
            {note ? (
              <NoteEditor
                noteId={note.id}
                value={note.content}
                onChange={(content) => updateNote(note.id, { content })}
                placeholder="Your problems list - tick a problem when it's solved"
                className="min-h-[200px]"
              />
            ) : (
              <LoadingState label="Opening your problems note..." />
            )}
          </div>
        </div>
        <LeetcodeStats refreshToken={refreshToken} />
      </div>
    </div>
  );
}
