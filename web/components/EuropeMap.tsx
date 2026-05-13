"use client";
import { useMemo, useState } from "react";
import { ComposableMap, Geographies, Geography } from "react-simple-maps";
import { scaleSequential } from "d3-scale";
import { interpolateBlues } from "d3-scale-chromatic";
import { numericToAlpha2 } from "@/lib/country-codes";

export type CountryDatum = {
  country_code: string;
  country_name: string;
  value: number;          // the metric we're coloring by
  display: string;        // pre-formatted label (e.g. "€3.39" or "22.6 min")
  subtitle?: string;      // optional second line in tooltip
};

type Props = {
  data: CountryDatum[];
  /** Highest possible value for scaling (defaults to max of data). */
  scaleMax?: number;
  /** Lowest possible value for scaling. */
  scaleMin?: number;
  /** Caller-controlled selected country (alpha-2), optional. */
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
  const color = useMemo(
    () => scaleSequential([min, max], interpolateBlues),
    [min, max],
  );

  const [hover, setHover] = useState<{ x: number; y: number; datum: CountryDatum } | null>(null);

  return (
    <div className="relative">
      <ComposableMap
        projection="geoMercator"
        projectionConfig={{ center: [15, 52], scale: 600 }}
        width={780}
        height={520}
        style={{ width: "100%", height: "auto" }}
      >
        <Geographies geography={TOPO_URL}>
          {({ geographies }) =>
            geographies.map((geo) => {
              const a2 = numericToAlpha2(geo.id as string | number | null | undefined);
              const datum = a2 ? byCode.get(a2) : undefined;
              const isSelected = a2 && selectedCode === a2;
              const fill = datum
                ? (color(datum.value) as string)
                : "#f1f5f9"; // slate-100 for non-tracked
              return (
                <Geography
                  key={geo.rsmKey}
                  geography={geo}
                  fill={fill}
                  stroke={isSelected ? "#0f172a" : "#cbd5e1"}
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
          className="pointer-events-none fixed z-50 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm shadow-lg dark:border-gray-700 dark:bg-gray-900"
          style={{ left: hover.x + 14, top: hover.y + 14 }}
        >
          <div className="font-semibold">{hover.datum.country_name}</div>
          <div className="font-mono tabular-nums text-blue-700 dark:text-blue-300">
            {hover.datum.display}
          </div>
          {hover.datum.subtitle && (
            <div className="text-xs text-gray-500 mt-0.5">{hover.datum.subtitle}</div>
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
    <div className="absolute bottom-2 left-2 rounded bg-white/90 dark:bg-gray-900/80 backdrop-blur px-3 py-2 text-xs">
      <div className="flex items-center gap-1">
        {stops.map((v, i) => (
          <div
            key={i}
            className="h-3 w-7"
            style={{ background: interpolator(v) }}
            title={v.toFixed(2)}
          />
        ))}
      </div>
      <div className="mt-1 flex justify-between font-mono tabular-nums text-gray-500">
        <span>{min.toFixed(min < 10 ? 2 : 0)}</span>
        <span>{max.toFixed(max < 10 ? 2 : 0)}</span>
      </div>
    </div>
  );
}
