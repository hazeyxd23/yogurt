import { useEffect, useState } from "react";
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { getLeetcodeStats, getLeetcodeProblems, isCancel } from "../../services/api";
import Stat from "../common/Stat";
import LoadingState from "../common/LoadingState";
import ErrorMessage from "../common/ErrorMessage";

const COLORS = { Easy: "#22c55e", Medium: "#f59e0b", Hard: "#ef4444", Unknown: "#64748b" };

export default function LeetcodeStats({ refreshToken }) {
  const [stats, setStats] = useState(null);
  const [pieData, setPieData] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    async function load() {
      try {
        const [statsData, problems] = await Promise.all([getLeetcodeStats(signal), getLeetcodeProblems(signal)]);
        const counts = {};
        for (const p of problems) {
          const key = p.difficulty || "Unknown";
          counts[key] = (counts[key] || 0) + 1;
        }
        setPieData(Object.entries(counts).map(([name, value]) => ({ name, value })));
        setStats(statsData);
        setError(null);
      } catch (err) {
        if (!isCancel(err)) setError("Couldn't load LeetCode stats.");
      }
    }
    load();
    return () => controller.abort();
  }, [refreshToken]);

  if (error) return <div className="card"><ErrorMessage message={error} /></div>;
  if (!stats) return <div className="card"><LoadingState label="Loading LeetCode stats..." /></div>;

  return (
    <div className="card">
      <h3 className="mb-4">LeetCode Stats</h3>
      <div className="mb-6 grid grid-cols-3 gap-4">
        <Stat label="Total problems" value={stats.total_problems} accent="text-leetcode" />
        <Stat label="Solved" value={stats.solved_count} accent="text-leetcode" />
        <Stat label="Unsolved" value={stats.unsolved_count} accent="text-leetcode" />
      </div>
      {pieData.length > 0 ? (
        <ResponsiveContainer width="100%" height={240}>
          <PieChart margin={{ top: 16, right: 16, bottom: 4, left: 16 }}>
            <Pie data={pieData} dataKey="value" nameKey="name" outerRadius={76} label>
              {pieData.map((entry) => (
                <Cell key={entry.name} fill={COLORS[entry.name] || "#999"} stroke="#ffffff" />
              ))}
            </Pie>
            <Tooltip contentStyle={{ background: "#ffffff", border: "1px solid #c7c7cc", borderRadius: 8, color: "#1d1d1f" }} />
            <Legend wrapperStyle={{ fontSize: 12, color: "#94a3b8" }} />
          </PieChart>
        </ResponsiveContainer>
      ) : (
        <p className="text-sm text-surface-muted">No problems yet.</p>
      )}
    </div>
  );
}
