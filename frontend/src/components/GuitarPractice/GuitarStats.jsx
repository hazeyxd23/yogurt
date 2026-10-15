import { useEffect, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { getGuitarStats, getStreaks, getAnalyticsWeekly, isCancel } from "../../services/api";
import Stat from "../common/Stat";
import LoadingState from "../common/LoadingState";
import ErrorMessage from "../common/ErrorMessage";
import { FlameIcon } from "../common/icons";

export default function GuitarStats({ refreshToken }) {
  const [stats, setStats] = useState(null);
  const [streak, setStreak] = useState(null);
  const [weekly, setWeekly] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    async function load() {
      try {
        const [statsData, streaksData, weeklyData] = await Promise.all([
          getGuitarStats(signal),
          getStreaks(signal),
          getAnalyticsWeekly(signal),
        ]);
        setStats(statsData);
        setStreak(streaksData.find((s) => s.habit_type === "guitar") || null);
        setWeekly(weeklyData.map((d) => ({ date: d.date.slice(5), minutes: d.guitar_minutes })));
        setError(null);
      } catch (err) {
        if (!isCancel(err)) setError("Couldn't load guitar stats.");
      }
    }
    load();
    return () => controller.abort();
  }, [refreshToken]);

  if (error) return <div className="card"><ErrorMessage message={error} /></div>;
  if (!stats) return <div className="card"><LoadingState label="Loading guitar stats..." /></div>;

  const weekMinutes = weekly.reduce((sum, d) => sum + d.minutes, 0);

  return (
    <div className="card">
      <h3 className="mb-4 flex items-center gap-2">
        <FlameIcon className="h-5 w-5 text-guitar" />
        Guitar Stats
      </h3>
      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Minutes this week" value={weekMinutes} accent="text-guitar" />
        <Stat label="Sessions" value={stats.sessions_count} accent="text-guitar" />
        <Stat label="Current streak" value={`${streak?.current_count ?? 0}d`} accent="text-guitar" />
        <Stat label="Best streak" value={`${streak?.best_count ?? 0}d`} accent="text-guitar" />
      </div>

      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={weekly}>
          <CartesianGrid strokeDasharray="3 3" stroke="#dcdce0" vertical={false} />
          <XAxis dataKey="date" stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
          <YAxis allowDecimals={false} stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} width={28} />
          <Tooltip contentStyle={{ background: "#ffffff", border: "1px solid #c7c7cc", borderRadius: 8, color: "#1d1d1f" }} />
          <Bar dataKey="minutes" name="Guitar minutes" fill="#f97316" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
