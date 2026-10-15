import { useState } from "react";
import { createLeetcodeProblem } from "../../services/api";
import { useToast } from "../../context/ToastContext";
import Spinner from "../common/Spinner";
import ErrorMessage from "../common/ErrorMessage";

const DIFFICULTIES = ["Easy", "Medium", "Hard"];

export default function ProblemForm({ onAdded }) {
  const [name, setName] = useState("");
  const [difficulty, setDifficulty] = useState("Easy");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const { showToast } = useToast();

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const created = await createLeetcodeProblem(name.trim(), difficulty, note.trim() || null);
      showToast(`Added "${name.trim()}" to your list`);
      setName("");
      setNote("");
      onAdded?.(created);
    } catch (err) {
      setError("Couldn't add the problem. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="card">
      <h3 className="mb-4">Add Problem</h3>
      <div className="mb-3 flex flex-col gap-2 sm:flex-row">
        <input
          placeholder="Problem name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          className="input sm:flex-1"
        />
        <select value={difficulty} onChange={(e) => setDifficulty(e.target.value)} className="input sm:w-36">
          {DIFFICULTIES.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </div>
      <textarea
        placeholder="Notes (optional)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        className="input mb-3 resize-none"
      />
      <button type="submit" disabled={saving} className="btn bg-leetcode text-white hover:bg-leetcode-dark focus:ring-leetcode w-full sm:w-auto">
        {saving && <Spinner className="h-4 w-4" />}
        {saving ? "Adding..." : "Add Problem"}
      </button>
      {error && (
        <div className="mt-3">
          <ErrorMessage message={error} />
        </div>
      )}
    </form>
  );
}
