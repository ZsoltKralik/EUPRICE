"use client";
import { useMemo, useState } from "react";
import { ComposableMap, Geographies, Geography } from "react-simple-maps";
import { scaleSequential } from "d3-scale";
import { interpolateBlues } from "d3-scale-chromatic";
import { numericToAlpha2 } from "@/lib/country-codes";

export type CountryDatum = {
  country_code: string;
  country_name: string;
  value: number;          // metric to color by
  display: string;        // pre-formatted label
  subtitle?: string;
};

type Props = {
  data: CountryDatum[];
  scaleMin?: number;
  scaleMax?: number;
  selectedCode?: string;
  onSelect?: (code: string | null) => void;
};

const TOPO_URL = "/world-110m.json";

export default function EuropeMap({ data, scaleMin, scaleMax, selectedCode, onSelect }: Props) {
  const byCode = useMemo(() => {
    const m = new Map<string, CountryDatum>();
    for (const d of data) m.set(d.country_code, d);
    return m;
  }, [data]);

  const values = data.map((d) => d.value);
  const min = scaleMin ?? (values.length ? Math.min(...values) : 0);
  const max = scaleMax ?? (values.length ? Math.max(...values) : 1);
  const color = useMemo(() => {
    // Slight headroom so the lightest tracked country isn't pure white.
    const lo = min - (max - min) * 0.15;
    return scaleSequential([lo, max], interpolateBlues);
  }, [min, max]);

  const [hover, setHover] = useState<{ x: number; y: number; datum: CountryDatum } | null>(null);

  return (
    <div className="relative">
      <ComposableMap
        projection="geoMercator"
        projectionConfig={{ center: [15, 52], scale: 600 }}
        width={780}
        height={520}
        style={{ width: "100%", height: "auto", background: "#fff" }}
      >
        <Geographies geography={TOPO_URL}>
          {({ geographies }) =>
            geographies.map((geo) => {
              const a2 = numericToAlpha2(geo.id as string | number | null | undefined);
              const datum = a2 ? byCode.get(a2) : undefined;
              const isSelected = a2 && selectedCode === a2;
              const fill = datum ? (color(datum.value) as string) : "#f1f5f9"; // slate-100
              return (
                <Geography
                  key={geo.rsmKey}
                  geography={geo}
                  fill={fill}
                  stroke={isSelected ? "#1e293b" : "#cbd5e1"} // slate-800 / slate-300
                  strokeWidth={isSelected ? 1.5 : 0.5}
                  style={{
                    default: { outline: "none" },
                    hover: {
                      outline: "none",
                      filter: datum ? "brightness(0.92)" : undefined,
                      cursor: datum ? "pointer" : "default",
                    },
                    pressed: { outline: "none" },
                  }}
                  onMouseEnter={(e) => {
                    if (datum) setHover({ x: e.clientX, y: e.clientY, datum });
                  }}
                  onMouseMove={(e) => {
                    if (datum) setHover({ x: e.clientX, y: e.clientY, datum });
                  }}
                  onMouseLeave={() => setHover(null)}
                  onClick={() => {
                    if (a2 && datum && onSelect) onSelect(a2 === selectedCode ? null : a2);
                  }}
                />
              );
            })
          }
        </Geographies>
      </ComposableMap>

      {hover && (
        <div
          className="pointer-events-none fixed z-50 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-lift"
          style={{ left: hover.x + 14, top: hover.y + 14 }}
        >
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
            {hover.datum.country_code}
          </div>
          <div className="text-sm font-semibold text-slate-900">{hover.datum.country_name}</div>
          <div className="mt-0.5 font-mono text-base font-semibold tabular-nums text-indigo-700">
            {hover.datum.display}
          </div>
          {hover.datum.subtitle && (
            <div className="mt-0.5 text-xs text-rose-600">{hover.datum.subtitle}</div>
          )}
        </div>
      )}

      <Legend min={min} max={max} interpolator={color} />
    </div>
  );
}

function Legend({
  min,
  max,
  interpolator,
}: {
  min: number;
  max: number;
  interpolator: (v: number) => string;
}) {
  const steps = 6;
  const stops = Array.from({ length: steps }, (_, i) => min + (i / (steps - 1)) * (max - min));
  return (
    <div className="absolute bottom-3 left-3 rounded-lg border border-slate-200 bg-white/95 px-3 py-2 text-xs backdrop-blur">
      <div className="flex items-center gap-1">
        {stops.map((v, i) => (
          <div
            key={i}
            className="h-3 w-7 rounded-sm"
            style={{ background: interpolator(v) }}
            title={v.toFixed(2)}
          />
        ))}
      </div>
      <div className="mt-1 flex justify-between font-mono tabular-nums text-slate-500">
        <span>{min.toFixed(min < 10 ? 2 : 0)}</span>
        <span>{max.toFixed(max < 10 ? 2 : 0)}</span>
      </div>
    </div>
  );
}
