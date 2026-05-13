"""Stdlib-only sanity check: apply schema + migrations and report what's in the DB."""
import pathlib
import sqlite3

ROOT = pathlib.Path(__file__).resolve().parents[1]
DB = ROOT / "db" / "eu_prices.db"


def main() -> None:
    if DB.exists():
        DB.unlink()
    conn = sqlite3.connect(DB)
    conn.executescript((ROOT / "db" / "schema.sql").read_text(encoding="utf-8"))
    for mig in sorted((ROOT / "db" / "migrations").glob("*.sql")):
        conn.executescript(mig.read_text(encoding="utf-8"))
    conn.commit()

    tables = [r[0] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")]
    views = [r[0] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='view' ORDER BY name")]
    countries = conn.execute(
        "SELECT code, name, currency_code, vat_standard_rate FROM country ORDER BY code"
    ).fetchall()
    shops = conn.execute("SELECT code, name FROM shop").fetchall()
    shop_countries = conn.execute(
        """
        SELECT s.code, c.code, sc.base_url
        FROM shop_country sc
        JOIN shop s    ON s.id = sc.shop_id
        JOIN country c ON c.code = sc.country_code
        ORDER BY s.code, c.code
        """
    ).fetchall()

    print("Tables: ", tables)
    print("Views:  ", views)
    print(f"\n{len(countries)} countries:")
    for c in countries:
        print(f"  {c[0]}  {c[1]:<10} {c[2]}  VAT {c[3]*100:.1f}%")
    print(f"\n{len(shops)} shops:")
    for s in shops:
        print(f"  {s[0]:<10} {s[1]}")
    print(f"\n{len(shop_countries)} shop-country bindings:")
    for sc in shop_countries:
        print(f"  {sc[0]} / {sc[1]}  ->  {sc[2]}")

    print(f"\nDB OK at {DB}  ({DB.stat().st_size} bytes)")
    conn.close()


if __name__ == "__main__":
    main()
