import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from "recharts";
import { getAnalyticsSummary, getHeatmap, getTodaysTasks, getAnalyticsWeekly, isCancel } from "../services/api";
import TaskList from "../components/Tasks/TaskList";
import LoadingState from "../components/common/LoadingState";
import ErrorMessage from "../components/common/ErrorMessage";
import { GuitarIcon, BookIcon, CodeIcon, CheckSquareIcon, FlameIcon, CalendarIcon, NoteIcon } from "../components/common/icons";
import NoteEditor from "../components/Notes/NoteEditor";
import { useNotes } from "../context/NotesContext";

const HABIT_META = {
  guitar: { label: "Guitar Practice", icon: GuitarIcon, accent: "text-guitar" },
  reading: { label: "Book Reading", icon: BookIcon, accent: "text-reading" },
  leetcode: { label: "LeetCode", icon: CodeIcon, accent: "text-leetcode" },
  tasks: { label: "Tasks", icon: CheckSquareIcon, accent: "text-tasks" },
};

function useClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

/** The dashboard's own note - always here, also listed (and linkable) in Notes. */
function QuickNote() {
  const { dashboardNote, updateNote } = useNotes();
  if (!dashboardNote) return null;
  return (
    <div className="card">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="flex items-center gap-2">
          <NoteIcon className="h-5 w-5 text-indigo-700" />
          Quick Note
        </h3>
        <Link to={`/notes/${dashboardNote.id}`} className="text-xs text-surface-muted hover:text-ink">
          Open in Notes ↗
        </Link>
      </div>
      <div className="max-h-80 overflow-y-auto">
        <NoteEditor
          compact
          noteId={dashboardNote.id}
          value={dashboardNote.content}
          onChange={(content) => updateNote(dashboardNote.id, { content })}
          placeholder="Jot something down... - [ ] makes a tick marker, [[Note]] links a note"
        />
      </div>
    </div>
  );
}

function heatColor(total) {
  if (total <= 0) return "var(--heat-empty)";
  if (total < 15) return "#4ade8055";
  if (total < 30) return "#4ade8099";
  if (total < 60) return "#22c55e";
  return "#15803d";
}

export default function Dashboard() {
  const [summary, setSummary] = useState(null);
  const [heatmap, setHeatmap] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [weekly, setWeekly] = useState([]);
  const [error, setError] = useState(null);
  const now = useClock();
  const monthStr = now.toISOString().slice(0, 7);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    async function load() {
      try {
        const [summaryData, heatmapData, tasksData, weeklyData] = await Promise.all([
          getAnalyticsSummary(signal),
          getHeatmap(monthStr, signal),
          getTodaysTasks(signal),
          getAnalyticsWeekly(signal),
        ]);
        setSummary(summaryData);
        setHeatmap(heatmapData);
        setTasks(tasksData);
        setWeekly(
          weeklyData.map((d) => ({
            date: d.date.slice(5),
            guitar: d.guitar_minutes,
            reading: d.reading_minutes,
          }))
        );
        setError(null);
      } catch (err) {
        if (!isCancel(err)) setError("Couldn't load your dashboard. Is the backend running?");
      }
    }
    load();
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthStr]);

  const handleTaskChanged = async () => {
    try {
      setTasks(await getTodaysTasks());
    } catch (err) {
      console.error(err.message);
    }
  };

  if (error) return <ErrorMessage message={error} />;
  if (!summary) return <LoadingState label="Loading dashboard..." />;

  const hour = now.getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <div>
      <div className="mb-6 flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
        <div>
          <h1 className="text-ink">{greeting}</h1>
          <p className="text-sm text-surface-muted">
            {now.toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
          </p>
        </div>
        <div className="font-mono text-2xl font-bold text-ink">{now.toLocaleTimeString()}</div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left column */}
        <div className="flex flex-col gap-6">
          <div className="card">
            <h3 className="mb-4 flex items-center gap-2">
              <FlameIcon className="h-5 w-5 text-amber-400" />
              Streaks
            </h3>
            <div className="flex flex-col divide-y divide-surface-border">
              {summary.streaks.map((s) => {
                const meta = HABIT_META[s.habit_type];
                const Icon = meta?.icon;
                return (
                  <div key={s.habit_type} className="flex items-center justify-between py-2.5 first:pt-0 last:pb-0">
                    <span className="flex items-center gap-2 text-sm text-ink">
                      {Icon && <Icon className={`h-4 w-4 ${meta.accent}`} />}
                      {meta?.label ?? s.habit_type}
                    </span>
                    <span className="text-sm font-semibold text-ink">
                      {s.current_count}d <span className="font-normal text-surface-muted">(best {s.best_count}d)</span>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="card">
            <h3 className="mb-4 flex items-center gap-2">
              <CalendarIcon className="h-5 w-5 text-emerald-400" />
              Activity Heatmap
              <span className="ml-auto text-xs font-normal text-surface-muted">{monthStr}</span>
            </h3>
            <div className="grid grid-cols-7 gap-1.5">
              {heatmap.map((day) => (
                <div
                  key={day.date}
                  title={`${day.date}: ${day.total_activity} activity units`}
                  className="aspect-square rounded-md"
                  style={{ backgroundColor: heatColor(day.total_activity) }}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Center column */}
        <div className="flex flex-col gap-6">
          <TaskList tasks={tasks} onChanged={handleTaskChanged} />
          <QuickNote />
        </div>

        {/* Right column */}
        <div className="card">
          <h3 className="mb-4">This Week</h3>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={weekly}>
              <CartesianGrid strokeDasharray="3 3" stroke="#dcdce0" vertical={false} />
              <XAxis dataKey="date" stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
              <YAxis allowDecimals={false} stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} width={28} />
              <Tooltip contentStyle={{ background: "#ffffff", border: "1px solid #c7c7cc", borderRadius: 8, color: "#1d1d1f" }} />
              <Legend wrapperStyle={{ fontSize: 12, color: "#94a3b8" }} />
              <Bar dataKey="guitar" name="Guitar (min)" stackId="a" fill="#f97316" radius={[0, 0, 0, 0]} />
              <Bar dataKey="reading" name="Reading (min)" stackId="a" fill="#3b82f6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
