import { ImageResponse } from "next/og";
import { listLatest, listProducts } from "@/lib/db";

// Route segment config — Next.js renders this at request time and serves
// the bytes as the site's default Open Graph image.
export const runtime = "nodejs";
export const alt =
  "EUPRICE — Same product. Different price. Different worktime.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  let productsN = 0;
  let countriesN = 0;
  let rowsN = 0;
  try {
    const [products, rows] = await Promise.all([listProducts(), listLatest()]);
    productsN = products.length;
    rowsN = rows.length;
    countriesN = new Set(rows.map((r) => r.country_code)).size;
  } catch {
    // fall through with zeros — image still renders
  }

  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          justifyContent: "space-between",
          backgroundColor: "#0f172a",
          backgroundImage:
            "radial-gradient(circle at 80% 20%, #312e81 0%, transparent 50%), radial-gradient(circle at 10% 90%, #4338ca 0%, transparent 40%)",
          padding: "70px 80px",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        {/* top — brand */}
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: 14,
              backgroundColor: "#4f46e5",
              color: "white",
              fontSize: 38,
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
              fontSize: 36,
              fontWeight: 700,
              color: "white",
              letterSpacing: -0.5,
            }}
          >
            <span>EU</span>
            <span style={{ color: "#a5b4fc" }}>PRICE</span>
          </div>
        </div>

        {/* center — headline */}
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div
            style={{
              fontSize: 72,
              fontWeight: 800,
              color: "white",
              lineHeight: 1.05,
              letterSpacing: -1.5,
              maxWidth: 1000,
            }}
          >
            Same product.
          </div>
          <div
            style={{
              fontSize: 72,
              fontWeight: 800,
              color: "#fda4af",
              lineHeight: 1.05,
              letterSpacing: -1.5,
              maxWidth: 1000,
            }}
          >
            Different price.
          </div>
          <div
            style={{
              fontSize: 72,
              fontWeight: 800,
              color: "#a5b4fc",
              lineHeight: 1.05,
              letterSpacing: -1.5,
              maxWidth: 1000,
            }}
          >
            Different worktime.
          </div>
        </div>

        {/* bottom — stats line */}
        <div
          style={{
            display: "flex",
            gap: 36,
            color: "#cbd5e1",
            fontSize: 28,
            letterSpacing: -0.2,
          }}
        >
          <div style={{ display: "flex", gap: 10 }}>
            <span style={{ color: "white", fontWeight: 700 }}>{productsN}</span>
            <span>cross-EU products</span>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <span style={{ color: "white", fontWeight: 700 }}>{countriesN}</span>
            <span>countries</span>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <span style={{ color: "white", fontWeight: 700 }}>{rowsN}</span>
            <span>verified observations</span>
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
