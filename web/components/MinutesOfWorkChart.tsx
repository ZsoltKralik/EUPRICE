"use client";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { scaleSequential } from "d3-scale";
import { interpolateBlues } from "d3-scale-chromatic";

type Datum = { country: string; minutes: number };

export default function MinutesOfWorkChart({ data }: { data: Datum[] }) {
  const sorted = [...data].sort((a, b) => a.minutes - b.minutes);
  const min = Math.min(...sorted.map((d) => d.minutes));
  const max = Math.max(...sorted.map((d) => d.minutes));
  // Slight headroom so the lightest bar isn't pure white.
  const color = scaleSequential([min - (max - min) * 0.2, max], interpolateBlues);
  return (
    <div style={{ width: "100%", height: 320 }}>
      <ResponsiveContainer>
        <BarChart data={sorted} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
          <XAxis dataKey="country" stroke="#64748b" tick={{ fontSize: 12 }} />
          <YAxis stroke="#64748b" tick={{ fontSize: 12 }} tickFormatter={(v) => `${v}m`} />
          <Tooltip
            contentStyle={{
              background: "#fff",
              border: "1px solid #e2e8f0",
              borderRadius: 8,
              fontSize: 12,
            }}
            formatter={(v: number) => `${v.toFixed(1)} min of work`}
          />
          <Bar dataKey="minutes" name="Minutes of median-wage work" radius={[6, 6, 0, 0]}>
            {sorted.map((d) => (
              <Cell key={d.country} fill={color(d.minutes) as string} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
