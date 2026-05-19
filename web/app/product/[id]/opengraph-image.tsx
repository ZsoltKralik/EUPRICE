import { ImageResponse } from "next/og";
import { getProductLatest, displayName } from "@/lib/db";
import { buildFindings } from "@/lib/findings";

// Dynamic per-product Open Graph card. When a journalist shares
// /product/4 on X/LinkedIn, the rendered preview shows the wage-time
// headline + product identification.
export const runtime = "nodejs";
export const alt = "EUPRICE — Cross-EU price observation";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image({
  params,
}: {
  params: { id: string };
}) {
  const productId = Number(params.id);
  let producer = "";
  let name = "";
  let sizeLine = "";
  let dearestMinutes = 0;
  let dearestCountry = "";
  let cheapestMinutes = 0;
  let cheapestCountry = "";
  let ratio = 0;
  let dearestEur = 0;
  let cheapestEur = 0;
  let countriesN = 0;
  let imageUrl: string | null = null;
  try {
    const rows = await getProductLatest(productId);
    if (rows.length > 0) {
      const sample = rows[0];
      producer = sample.producer;
      name = displayName(sample);
      sizeLine =
        sample.size_value && sample.size_unit
          ? `${sample.size_value} ${sample.size_unit}`
          : "";
      imageUrl = sample.image_url;
      const finding = buildFindings(rows)[0];
      if (finding) {
        countriesN = finding.countries_observed;
        cheapestEur = finding.cheapest_eur.price_eur;
        dearestEur = finding.dearest_eur.price_eur;
        if (finding.cheapest_minutes && finding.dearest_minutes) {
          cheapestMinutes = finding.cheapest_minutes.minutes;
          cheapestCountry = finding.cheapest_minutes.country_code;
          dearestMinutes = finding.dearest_minutes.minutes;
          dearestCountry = finding.dearest_minutes.country_code;
          ratio = finding.minutes_ratio ?? 0;
        }
      }
    }
  } catch {
    // fall through to a generic image with empty stats
  }

  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          backgroundColor: "#0f172a",
          backgroundImage:
            "radial-gradient(circle at 80% 20%, #312e81 0%, transparent 50%), radial-gradient(circle at 10% 90%, #4338ca 0%, transparent 40%)",
          padding: "60px 70px",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        {/* brand strip */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div
              style={{
                width: 54,
                height: 54,
                borderRadius: 12,
                backgroundColor: "#4f46e5",
                color: "white",
                fontSize: 30,
                fontWeight: 800,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              €
            </div>
            <div
              style={{
                display: "flex",
                fontSize: 30,
                fontWeight: 700,
                color: "white",
                letterSpacing: -0.4,
              }}
            >
              <span>EU</span>
              <span style={{ color: "#a5b4fc" }}>PRICE</span>
            </div>
          </div>
          <div
            style={{
              padding: "8px 18px",
              borderRadius: 999,
              backgroundColor: "#4f46e5",
              color: "white",
              fontSize: 18,
              fontWeight: 700,
              letterSpacing: 1,
              textTransform: "uppercase",
            }}
          >
            Cross-EU observation
          </div>
        </div>

        {/* product identification */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 32,
            marginTop: 44,
            flex: 1,
          }}
        >
          {imageUrl && (
            <div
              style={{
                width: 180,
                height: 180,
                borderRadius: 18,
                backgroundColor: "white",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: 14,
                flexShrink: 0,
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imageUrl.startsWith("/") ? `http://localhost:3000${imageUrl}` : imageUrl}
                alt=""
                width={150}
                height={150}
                style={{ objectFit: "contain" }}
              />
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div
              style={{
                fontSize: 22,
                color: "#a5b4fc",
                fontWeight: 600,
                letterSpacing: 0.5,
                textTransform: "uppercase",
              }}
            >
              {producer}
            </div>
            <div
              style={{
                fontSize: 48,
                fontWeight: 800,
                color: "white",
                lineHeight: 1.1,
                letterSpacing: -1,
                maxWidth: 820,
              }}
            >
              {name}
            </div>
            {sizeLine && (
              <div style={{ fontSize: 24, color: "#cbd5e1" }}>{sizeLine}</div>
            )}
          </div>
        </div>

        {/* headline — the wage-time gap */}
        {ratio > 0 ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 12,
              padding: "26px 30px",
              borderRadius: 20,
              backgroundColor: "rgba(15, 23, 42, 0.6)",
              border: "1px solid #4338ca",
            }}
          >
            <div
              style={{
                fontSize: 18,
                color: "#a5b4fc",
                fontWeight: 700,
                letterSpacing: 1.5,
                textTransform: "uppercase",
              }}
            >
              The wage-time gap
            </div>
            <div
              style={{
                fontSize: 38,
                color: "white",
                fontWeight: 700,
                lineHeight: 1.2,
                letterSpacing: -0.5,
                display: "flex",
                flexWrap: "wrap",
                gap: 10,
              }}
            >
              <span style={{ color: "#fca5a5" }}>
                {dearestMinutes.toFixed(0)} min in {dearestCountry}
              </span>
              <span style={{ color: "#94a3b8" }}>vs</span>
              <span style={{ color: "#86efac" }}>
                {cheapestMinutes.toFixed(0)} min in {cheapestCountry}
              </span>
              <span style={{ color: "#94a3b8" }}>—</span>
              <span style={{ color: "#a5b4fc" }}>
                {ratio.toFixed(1)}× the labor time
              </span>
            </div>
            <div
              style={{
                fontSize: 18,
                color: "#94a3b8",
                marginTop: 4,
                display: "flex",
                gap: 14,
              }}
            >
              <span>
                €{cheapestEur.toFixed(2)} → €{dearestEur.toFixed(2)}
              </span>
              <span>·</span>
              <span>{countriesN} EU countries</span>
              <span>·</span>
              <span>Identity-verified EAN-13</span>
            </div>
          </div>
        ) : (
          <div
            style={{
              fontSize: 26,
              color: "#cbd5e1",
              fontStyle: "italic",
              padding: "24px 0",
            }}
          >
            Cross-EU price observations
          </div>
        )}
      </div>
    ),
    { ...size },
  );
}
