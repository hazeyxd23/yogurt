import { useEffect, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { getReadingStats, getReadingSessions, isCancel } from "../../services/api";
import Stat from "../common/Stat";
import LoadingState from "../common/LoadingState";
import ErrorMessage from "../common/ErrorMessage";

function last7Days() {
  const days = [];
  for (let i = 6; i >= 0; i -= 1) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

function buildPagesByDay(sessions) {
  const days = last7Days();
  const totals = Object.fromEntries(days.map((d) => [d, 0]));
  for (const s of sessions) {
    if (totals[s.session_date] !== undefined) {
      totals[s.session_date] += s.pages_read || 0;
    }
  }
  return days.map((d) => ({ date: d.slice(5), pages: totals[d] }));
}

export default function ReadingStats({ refreshToken }) {
  const [stats, setStats] = useState(null);
  const [chartData, setChartData] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    async function load() {
      try {
        const [statsData, sessions] = await Promise.all([getReadingStats(signal), getReadingSessions(signal)]);
        setStats(statsData);
        setChartData(buildPagesByDay(sessions));
        setError(null);
      } catch (err) {
        if (!isCancel(err)) setError("Couldn't load reading stats.");
      }
    }
    load();
    return () => controller.abort();
  }, [refreshToken]);

  if (error) return <div className="card"><ErrorMessage message={error} /></div>;
  if (!stats) return <div className="card"><LoadingState label="Loading reading stats..." /></div>;

  return (
    <div className="card">
      <h3 className="mb-4">Reading Stats</h3>
      <div className="mb-6 grid grid-cols-3 gap-4">
        <Stat label="Total pages" value={stats.total_pages} accent="text-reading" />
        <Stat label="Books completed" value={stats.books_completed} accent="text-reading" />
        <Stat label="Avg pages/day" value={stats.avg_pages_per_day.toFixed(1)} accent="text-reading" />
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke="#dcdce0" vertical={false} />
          <XAxis dataKey="date" stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
          <YAxis allowDecimals={false} stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} width={28} />
          <Tooltip contentStyle={{ background: "#ffffff", border: "1px solid #c7c7cc", borderRadius: 8, color: "#1d1d1f" }} />
          <Bar dataKey="pages" name="Pages read" fill="#3b82f6" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
