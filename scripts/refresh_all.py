"""One-command refresh orchestrator for EUPRICE.

Runs the full data-refresh pipeline end to end, with a hard quality gate so an
unattended (scheduled) run can never publish bad data:

    scrape  ->  audit (QUALITY GATE)  ->  localize images  ->  archive evidence
            ->  export web JSON  ->  git commit (+ push)

Prices that haven't moved are fine — every scrape appends a dated row to the
price history, so an unchanged price simply extends the time series (which is
itself evidence that a gap is structural, not a transient promo).

Quality gate
------------
After scraping we run scripts/audit_pack_quality.py. That script flags two kinds
of issue: informational TOKEN_MISS rows (localized product names that don't
contain the German seed tokens — expected with EAN-anchored matching) and FATAL
classes (EAN_DIFF, CATEGORY, MULTI, SIZE — a genuine wrong-product/wrong-size
match). If any FATAL class appears, the orchestrator aborts BEFORE the git
commit (unless --force), leaving the working tree for a human to inspect. This
is what makes unattended monthly runs safe.

Usage
-----
    python scripts/refresh_all.py                 # full pipeline, commit + push
    python scripts/refresh_all.py --no-push       # commit locally, don't push
    python scripts/refresh_all.py --no-archive    # skip the (slow) Wayback step
    python scripts/refresh_all.py --no-scrape     # re-audit/export/commit only
    python scripts/refresh_all.py --shops dm,mueller
    python scripts/refresh_all.py --force         # commit even if audit finds fatal flags
"""
from __future__ import annotations

import argparse
import datetime as dt
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PY = sys.executable
# Child processes must use UTF-8 on Windows (cp1252 chokes on product names).
ENV = {**os.environ, "PYTHONIOENCODING": "utf-8", "PYTHONUTF8": "1"}

# Audit flag classes that mean "wrong product/size" — these block a commit.
# TOKEN_MISS is informational (localized names lack German seed tokens) and is
# expected on every run, so it is explicitly NOT fatal.
FATAL_AUDIT_CLASSES = {"EAN_DIFF", "CATEGORY", "MULTI", "SIZE"}

# Paths the commit should include (data + generated web JSON + images + audit).
COMMIT_PATHS = ["data/products.csv", "audit_report.csv", "web/data", "web/public/images"]


def run(cmd: list[str], *, check: bool = True, capture: bool = False) -> subprocess.CompletedProcess:
    print(f"\n$ {' '.join(cmd)}", flush=True)
    return subprocess.run(
        cmd, cwd=ROOT, env=ENV, check=check,
        text=True, capture_output=capture,
    )


def step_scrape(shops: list[str]) -> None:
    for shop in shops:
        if shop == "mueller":
            # Müller is only reachable for DE/AT/CH; scope it so the run is fast.
            run([PY, "-m", "scraper.refresh", "run", "--shop", "mueller",
                 "--countries", "DE,AT,CH"])
        else:
            run([PY, "-m", "scraper.refresh", "run", "--shop", shop])


def step_audit_gate(force: bool) -> None:
    """Run the pack-quality audit; abort the whole run if a FATAL class appears."""
    proc = run([PY, "scripts/audit_pack_quality.py"], check=False, capture=True)
    out = (proc.stdout or "") + (proc.stderr or "")
    print(out)
    # Summary line looks like: "12 suspects flagged SIZE=2 / TOKEN_MISS=122"
    classes: dict[str, int] = {}
    m = re.search(r"suspects flagged\s+(.*)", out)
    if m:
        for part in re.findall(r"([A-Z_]+)=(\d+)", m.group(1)):
            classes[part[0]] = int(part[1])
    fatal = {c: n for c, n in classes.items() if c in FATAL_AUDIT_CLASSES and n > 0}
    if fatal:
        msg = ", ".join(f"{c}={n}" for c, n in sorted(fatal.items()))
        if force:
            print(f"!! Audit found FATAL flags ({msg}) — continuing anyway (--force).")
        else:
            print(f"\n!! QUALITY GATE FAILED: audit found fatal flags ({msg}).")
            print("   Aborting before commit. Inspect audit_report.csv and the working tree.")
            sys.exit(2)
    else:
        print(f"Quality gate OK — no fatal flags (informational: {classes or 'none'}).")


def step_finalize() -> None:
    run([PY, "scripts/localize_images.py"])


def step_archive() -> None:
    # Incremental + idempotent: skips URLs with a fresh snapshot, so re-runs are cheap.
    run([PY, "scripts/archive_evidence.py"], check=False)


def step_export() -> None:
    run([PY, "scripts/export_for_web.py"])


def git_has_changes() -> bool:
    proc = run(["git", "status", "--porcelain", *COMMIT_PATHS], check=False, capture=True)
    return bool((proc.stdout or "").strip())


def step_commit(push: bool) -> None:
    if not git_has_changes():
        print("\nNo data changes after refresh — nothing to commit.")
        return
    run(["git", "add", *COMMIT_PATHS])
    today = dt.date.today().isoformat()
    msg = (
        f"data(refresh): scheduled price refresh {today}\n\n"
        "Automated monthly refresh via scripts/refresh_all.py "
        "(passed pack-quality gate).\n\n"
        "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
    )
    run(["git", "commit", "-m", msg])
    if push:
        run(["git", "push", "origin", "HEAD"], check=False)
    else:
        print("Committed locally (--no-push).")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--shops", default="dm", help="Comma-separated shop codes (default: dm)")
    ap.add_argument("--no-scrape", action="store_true", help="Skip scraping (re-audit/export/commit only)")
    ap.add_argument("--no-archive", action="store_true", help="Skip the Wayback archive step")
    ap.add_argument("--no-push", action="store_true", help="Commit locally but do not push")
    ap.add_argument("--force", action="store_true", help="Commit even if the audit finds fatal flags")
    args = ap.parse_args(argv)

    shops = [s.strip() for s in args.shops.split(",") if s.strip()]
    started = dt.datetime.now()
    print(f"=== EUPRICE refresh started {started.isoformat(timespec='seconds')} "
          f"(shops={shops}) ===")

    if not args.no_scrape:
        step_scrape(shops)
    else:
        print("\n(skipping scrape — --no-scrape)")

    step_audit_gate(args.force)
    step_finalize()
    if not args.no_archive:
        step_archive()
    else:
        print("\n(skipping Wayback archive — --no-archive)")
    step_export()
    step_commit(push=not args.no_push)

    elapsed = dt.datetime.now() - started
    print(f"\n=== refresh done in {elapsed} ===")
    return 0


if __name__ == "__main__":
    sys.exit(main())
