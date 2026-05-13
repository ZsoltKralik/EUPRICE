"use client";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type Row = { parsed_at: string; series: string; price_eur: number };

export default function PriceHistoryChart({ history }: { history: Row[] }) {
  const dateSet = new Set<string>();
  const seriesSet = new Set<string>();
  const buckets: Record<string, Record<string, number>> = {};
  for (const r of history) {
    const date = r.parsed_at.split("T")[0];
    dateSet.add(date);
    seriesSet.add(r.series);
    buckets[date] ??= {};
    buckets[date][r.series] = r.price_eur;
  }
  const dates = [...dateSet].sort();
  const series = [...seriesSet].sort();
  const data = dates.map((d) => ({ date: d, ...buckets[d] }));
  const palette = [
    "#2563eb", "#dc2626", "#16a34a", "#ca8a04", "#7c3aed",
    "#0891b2", "#db2777", "#ea580c", "#475569", "#0d9488",
  ];

  return (
    <div style={{ width: "100%", height: 320 }}>
      <ResponsiveContainer>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
          <XAxis dataKey="date" />
          <YAxis tickFormatter={(v) => `€${v}`} />
          <Tooltip formatter={(v: number) => `€${v.toFixed(2)}`} />
          <Legend />
          {series.map((s, i) => (
            <Line key={s} type="monotone" dataKey={s} stroke={palette[i % palette.length]} dot={false} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
