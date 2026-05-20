import { ImageResponse } from "next/og";
import { listLatest } from "@/lib/db";
import { buildUniversalBasket } from "@/lib/findings";

// Dynamic OG card for the /basket page. Renders the universal basket
// headline so that sharing the basket URL on X/LinkedIn previews with
// the cumulative wage-time number, not just the site default.

export const runtime = "nodejs";
export const alt =
  "EUPRICE basket — the same daily essentials cost wildly different worktime across the EU";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  let basketSize = 0;
  let cheapestMin = 0;
  let cheapestCty = "";
  let dearestMin = 0;
  let dearestCty = "";
  let ratio = 0;
  let cheapestEur = 0;
  let dearestEur = 0;
  let countriesN = 0;
  try {
    const rows = await listLatest();
    const universal = buildUniversalBasket(rows);
    if (universal) {
      basketSize = universal.basket_size;
      countriesN = universal.countries.length;
      if (universal.cheapest_minutes && universal.dearest_minutes && universal.minutes_ratio) {
        cheapestMin = universal.cheapest_minutes.total_minutes;
        cheapestCty = universal.cheapest_minutes.country_code;
        dearestMin = universal.dearest_minutes.total_minutes;
        dearestCty = universal.dearest_minutes.country_code;
        ratio = universal.minutes_ratio;
      }
      if (universal.cheapest_eur && universal.dearest_eur) {
        cheapestEur = universal.cheapest_eur.total_eur;
        dearestEur = universal.dearest_eur.total_eur;
      }
    }
  } catch {
    // fall through with zeros
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
            The basket aggregate
          </div>
        </div>

        {/* headline */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 36, flex: 1 }}>
          <div
            style={{
              fontSize: 56,
              fontWeight: 800,
              color: "white",
              lineHeight: 1.05,
              letterSpacing: -1,
              maxWidth: 1060,
            }}
          >
            A basket of identical SKUs.
          </div>
          <div
            style={{
              fontSize: 56,
              fontWeight: 800,
              color: "#a5b4fc",
              lineHeight: 1.05,
              letterSpacing: -1,
              maxWidth: 1060,
            }}
          >
            Wildly different worktime.
          </div>
        </div>

        {/* finding card */}
        {ratio > 0 ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 14,
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
              {`Universal basket · ${basketSize} products · ${countriesN} EU countries`}
            </div>
            <div
              style={{
                fontSize: 36,
                color: "white",
                fontWeight: 700,
                lineHeight: 1.2,
                letterSpacing: -0.5,
                display: "flex",
                flexWrap: "wrap",
                gap: 10,
              }}
            >
              <span style={{ color: "#86efac" }}>
                {cheapestMin.toFixed(0)} min in {cheapestCty}
              </span>
              <span style={{ color: "#94a3b8" }}>vs</span>
              <span style={{ color: "#fca5a5" }}>
                {dearestMin.toFixed(0)} min in {dearestCty}
              </span>
              <span style={{ color: "#94a3b8" }}>—</span>
              <span style={{ color: "#a5b4fc" }}>{ratio.toFixed(1)}× the labor time</span>
            </div>
            <div
              style={{
                fontSize: 18,
                color: "#94a3b8",
                display: "flex",
                gap: 14,
              }}
            >
              <span>
                €{cheapestEur.toFixed(2)} → €{dearestEur.toFixed(2)}
              </span>
              <span>·</span>
              <span>Identity-verified EAN-13 + DM internal SKU id</span>
              <span>·</span>
              <span>Same retailer everywhere</span>
            </div>
          </div>
        ) : (
          <div
            style={{
              fontSize: 22,
              color: "#cbd5e1",
              fontStyle: "italic",
              padding: "20px 0",
            }}
          >
            Cross-EU basket cost (loading…)
          </div>
        )}
      </div>
    ),
    { ...size },
  );
}
