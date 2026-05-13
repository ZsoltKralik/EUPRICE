"use client";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

type Datum = { country: string; incl: number; ex_vat: number | null };

export default function PriceBarChart({ data }: { data: Datum[] }) {
  const sorted = [...data].sort((a, b) => a.incl - b.incl);
  return (
    <div style={{ width: "100%", height: 340 }}>
      <ResponsiveContainer>
        <BarChart data={sorted}>
          <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
          <XAxis dataKey="country" />
          <YAxis tickFormatter={(v) => `€${v}`} />
          <Tooltip formatter={(v: number) => `€${v.toFixed(2)}`} />
          <Legend />
          <Bar dataKey="incl" name="Shelf (incl. VAT)" fill="#2563eb" />
          <Bar dataKey="ex_vat" name="Ex-VAT" fill="#94a3b8" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
