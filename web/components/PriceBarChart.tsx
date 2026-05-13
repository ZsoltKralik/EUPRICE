"use client";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

type Datum = { country: string; incl: number; ex_vat: number | null };

export default function PriceBarChart({ data }: { data: Datum[] }) {
  const sorted = [...data].sort((a, b) => a.incl - b.incl);
  return (
    <div style={{ width: "100%", height: 340 }}>
      <ResponsiveContainer>
        <BarChart data={sorted} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
          <XAxis dataKey="country" stroke="#64748b" tick={{ fontSize: 12 }} />
          <YAxis stroke="#64748b" tick={{ fontSize: 12 }} tickFormatter={(v) => `€${v}`} />
          <Tooltip
            contentStyle={{
              background: "#fff",
              border: "1px solid #e2e8f0",
              borderRadius: 8,
              fontSize: 12,
            }}
            formatter={(v: number) => `€${v.toFixed(2)}`}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="incl" name="Shelf (incl. VAT)" fill="#4f46e5" radius={[6, 6, 0, 0]} />
          <Bar dataKey="ex_vat" name="Ex-VAT" fill="#cbd5e1" radius={[6, 6, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
