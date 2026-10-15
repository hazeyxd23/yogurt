import { updateTask } from "../../services/api";
import { useToast } from "../../context/ToastContext";

const PRIORITY_STYLES = {
  1: { label: "High", className: "bg-red-50 text-red-700 border-red-300" },
  2: { label: "Medium", className: "bg-amber-50 text-amber-800 border-amber-300" },
  3: { label: "Low", className: "bg-slate-50 text-slate-600 border-slate-300" },
};

/** First meaningful line of a task's note, without markdown markers. */
function notePreview(text) {
  return (text || "")
    .split("\n")
    .map((line) => line.replace(/^\s*([-*+]\s+(\[[ xX]\]\s+)?|#{1,3}\s+|>\s?)/, "").trim())
    .find(Boolean);
}

export default function TaskList({ tasks, onChanged }) {
  const { showToast } = useToast();

  const handleToggle = async (task) => {
    try {
      await updateTask(task.id, { completed: !task.completed });
      onChanged?.();
    } catch (err) {
      showToast("Couldn't update the task", "error");
    }
  };

  return (
    <div className="card">
      <h3 className="mb-4">Today's Tasks</h3>
      {tasks.length === 0 && <p className="text-sm text-surface-muted">No tasks for today.</p>}
      <div className="flex flex-col divide-y divide-surface-border">
        {tasks.map((t) => {
          const priority = PRIORITY_STYLES[t.priority] || PRIORITY_STYLES[2];
          return (
            <div key={t.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
              <input
                type="checkbox"
                checked={t.completed}
                onChange={() => handleToggle(t)}
                className="h-5 w-5 shrink-0 rounded border-surface-border bg-surface accent-tasks"
              />
              <div className="min-w-0 flex-1">
                <div className={`truncate text-sm ${t.completed ? "text-surface-muted line-through" : "text-ink"}`}>
                  {t.title}
                </div>
                {notePreview(t.description) && <div className="truncate text-xs text-surface-muted">{notePreview(t.description)}</div>}
              </div>
              {t.scheduled_time && (
                <span className="shrink-0 text-xs text-surface-muted">
                  {new Date(t.scheduled_time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
              )}
              <span className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium ${priority.className}`}>
                {priority.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
