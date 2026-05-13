"use client";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type Datum = { country: string; minutes: number };

export default function MinutesOfWorkChart({ data }: { data: Datum[] }) {
  const sorted = [...data].sort((a, b) => a.minutes - b.minutes);
  return (
    <div style={{ width: "100%", height: 320 }}>
      <ResponsiveContainer>
        <BarChart data={sorted}>
          <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
          <XAxis dataKey="country" />
          <YAxis tickFormatter={(v) => `${v}m`} />
          <Tooltip formatter={(v: number) => `${v.toFixed(1)} min`} />
          <Bar dataKey="minutes" name="Minutes of median-wage work" fill="#dc2626" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
