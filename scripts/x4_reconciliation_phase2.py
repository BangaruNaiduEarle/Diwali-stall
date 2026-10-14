#!/usr/bin/env py -3
"""Phase 2: implement Excel X4 for confident matches only; strip ref/discount globally."""
from __future__ import annotations

import csv
import json
import re
import shutil
import subprocess
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parents[1]
PRODUCTS_JS = ROOT / "src" / "data" / "products.js"
REPORTS_DIR = ROOT / "reports"

WORKBOOK_FILES = [
    ("CRACKERS_all.xlsx", "carckers_all"),
    ("CRACKERS_ajn.xlsx", "carckers_ajn"),
]

JS_TO_EXCEL_KEY = {
    "signal_bomb_(7_shots)": "signal_bomb(_7_shots)",
    "mega_star": "mega_star_12",
    "mottu_pattu": "mottu_patlu",
    "masti_colour_koti_r&gi_mega": "masti_colour_koti_r&g_mega",
    "vip_10_1_matches": "vip_10_in_1_matches",
    "ganga_jamuna": "ganga_jamuna",
    "peacock_gaint": "peacock_big",
}


def resolve_workbook_path(filename: str) -> Path:
    for candidate in (ROOT / filename, Path.home() / "Downloads" / filename):
        if candidate.is_file():
            return candidate
    raise FileNotFoundError(
        f"Missing {filename}. Place it in {ROOT} or {Path.home() / 'Downloads'}"
    )


def normalize_name(name: str) -> str:
    return re.sub(r"\s+", "_", name.strip())


def norm_key(name: str) -> str:
    return normalize_name(name).lower()


def excel_keys_for_js_name(name: str) -> list[str]:
    pk = norm_key(name)
    keys = [pk]
    if pk in JS_TO_EXCEL_KEY:
        keys.append(JS_TO_EXCEL_KEY[pk])
    mapped = JS_TO_EXCEL_KEY.get(pk)
    if mapped and mapped not in keys:
        keys.append(mapped)
    return list(dict.fromkeys(keys))


def load_excel_rows() -> list[dict]:
    """Load bill rows from both workbooks; dedupe by sheet+row (all first, then ajn)."""
    rows: list[dict] = []
    seen_sheet_row: set[tuple[str, int]] = set()
    for wb_file, wb_label in WORKBOOK_FILES:
        path = resolve_workbook_path(wb_file)
        wb = openpyxl.load_workbook(path, data_only=True)
        for sheet in wb.sheetnames:
            ws = wb[sheet]
            bill_no = ws.cell(1, 2).value
            bill_no = str(bill_no).strip() if bill_no is not None else sheet
            header_row = None
            for r in range(1, min(25, ws.max_row + 1)):
                if ws.cell(r, 3).value == "Particulars":
                    header_row = r
                    break
            if header_row is None:
                continue
            for r in range(header_row + 1, ws.max_row + 1):
                particulars = ws.cell(r, 3).value
                if particulars is None or not str(particulars).strip():
                    continue
                dedupe_key = (sheet, r)
                if dedupe_key in seen_sheet_row:
                    continue
                seen_sheet_row.add(dedupe_key)
                comp = ws.cell(r, 2).value
                rows.append(
                    {
                        "workbook": wb_label,
                        "workbook_file": wb_file,
                        "sheet": sheet,
                        "row": r,
                        "bill_number": bill_no,
                        "particulars": str(particulars).strip(),
                        "norm_key": norm_key(str(particulars).strip()),
                        "comp": str(comp).strip() if comp is not None else "",
                        "x4": ws.cell(r, 7).value,
                    }
                )
        wb.close()
    return rows


def load_products() -> list[dict]:
    result = subprocess.run(
        [
            "node",
            "--input-type=module",
            "-e",
            "import { products } from './src/data/products.js'; console.log(JSON.stringify(products));",
        ],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    )
    return json.loads(result.stdout)


def parse_x4(val):
    if val is None or val == "":
        return None
    try:
        n = float(val)
        if n != n:
            return None
        return int(n) if n == int(n) else n
    except (TypeError, ValueError):
        return None


def write_products_js(products: list[dict]) -> None:
    body = json.dumps(products, indent=2, ensure_ascii=False)
    content = (
        "/**\n"
        " * Customer-facing catalogue (161 products).\n"
        " * Generated from diwali_product_master_final.csv — do not add supplier/internal fields.\n"
        " */\n\n"
        f"export const products = {body}\n"
    )
    PRODUCTS_JS.write_text(content, encoding="utf-8")


def main() -> None:
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup_path = REPORTS_DIR / f"products.js.backup.{ts}"
    shutil.copy2(PRODUCTS_JS, backup_path)

    before = load_products()
    before_by_id = {p["id"]: p for p in before}
    before_prices = {p["id"]: p["price"] for p in before}
    before_images = {p["id"]: list(p.get("images") or []) for p in before}

    excel_rows = load_excel_rows()
    by_norm: dict[str, list[dict]] = defaultdict(list)
    for row in excel_rows:
        by_norm[row["norm_key"]].append(row)

    js_by_norm: dict[str, list[dict]] = defaultdict(list)
    for p in before:
        js_by_norm[norm_key(p["name"])].append(p)

    duplicate_js_ids: set[str] = set()
    for group in js_by_norm.values():
        if len(group) > 1:
            for p in group:
                duplicate_js_ids.add(p["id"])

    implemented = []
    pending = []
    new_products = []

    for p in before:
        pid = p["id"]
        out = dict(p)
        out.pop("referencePrice", None)
        out.pop("discount", None)

        keys = excel_keys_for_js_name(p["name"])
        candidates: list[dict] = []
        for k in keys:
            candidates.extend(by_norm.get(k, []))
        # dedupe by sheet+row
        seen = set()
        unique_candidates = []
        for c in candidates:
            key = (c["sheet"], c["row"])
            if key in seen:
                continue
            seen.add(key)
            unique_candidates.append(c)

        if pid in duplicate_js_ids:
            pending.append(
                {
                    "product_id": pid,
                    "product_name": p["name"],
                    "current_selling_price": p["price"],
                    "reason_skipped": "duplicate_javascript_product_name",
                    "possible_excel_matches": format_candidates(unique_candidates),
                }
            )
            new_products.append(out)
            continue

        if len(unique_candidates) == 0:
            pending.append(
                {
                    "product_id": pid,
                    "product_name": p["name"],
                    "current_selling_price": p["price"],
                    "reason_skipped": "no_excel_particulars_match",
                    "possible_excel_matches": "",
                }
            )
            new_products.append(out)
            continue

        if len(unique_candidates) > 1:
            pending.append(
                {
                    "product_id": pid,
                    "product_name": p["name"],
                    "current_selling_price": p["price"],
                    "reason_skipped": "ambiguous_excel_multiple_rows_same_name",
                    "possible_excel_matches": format_candidates(unique_candidates),
                }
            )
            new_products.append(out)
            continue

        row = unique_candidates[0]
        x4 = parse_x4(row["x4"])
        if x4 is None:
            pending.append(
                {
                    "product_id": pid,
                    "product_name": p["name"],
                    "current_selling_price": p["price"],
                    "reason_skipped": "missing_or_invalid_x4_in_excel",
                    "possible_excel_matches": format_candidates([row]),
                }
            )
            new_products.append(out)
            continue

        out["x4"] = x4
        out["price"] = before_prices[pid]
        implemented.append(
            {
                "product_id": pid,
                "product_name": p["name"],
                "company_comp": row["comp"],
                "matched_workbook": row["workbook_file"],
                "bill_number": row["bill_number"],
                "worksheet": row["sheet"],
                "excel_row_number": row["row"],
                "x4_value": x4,
            }
        )
        new_products.append(out)

    # Integrity checks
    price_lines = []
    price_ok = True
    for p in new_products:
        pid = p["id"]
        if p["price"] != before_prices[pid]:
            price_ok = False
            price_lines.append(f"MISMATCH {pid}: was {before_prices[pid]} now {p['price']}")
    if price_ok:
        price_lines.append(f"All {len(before)} product selling prices match pre-change backup.")
    price_lines.append(f"Backup compared: {backup_path.name}")

    image_changes = []
    for p in new_products:
        pid = p["id"]
        if list(p.get("images") or []) != before_images[pid]:
            image_changes.append(f"{pid}: images changed (unexpected)")

    write_products_js(new_products)

    write_csv(REPORTS_DIR / "x4_implemented.csv", implemented, list(implemented[0].keys()) if implemented else [])
    write_csv(
        REPORTS_DIR / "x4_pending_manual.csv",
        pending,
        ["product_id", "product_name", "current_selling_price", "reason_skipped", "possible_excel_matches"],
    )
    (REPORTS_DIR / "price_integrity_check.txt").write_text("\n".join(price_lines) + "\n", encoding="utf-8")

    after = load_products()
    ref_left = [p["id"] for p in after if "referencePrice" in p or "discount" in p]
    x4_count = sum(1 for p in after if "x4" in p)

    summary = f"""X4 reconciliation summary ({datetime.now(timezone.utc).isoformat()})

Total products: {len(after)}
X4 implemented (confident unique Excel match): {len(implemented)}
Skipped / pending manual: {len(pending)}
  - duplicate_javascript_product_name: {sum(1 for x in pending if x['reason_skipped']=='duplicate_javascript_product_name')}
  - no_excel_particulars_match: {sum(1 for x in pending if x['reason_skipped']=='no_excel_particulars_match')}
  - ambiguous_excel_multiple_rows_same_name: {sum(1 for x in pending if x['reason_skipped']=='ambiguous_excel_multiple_rows_same_name')}
  - missing_or_invalid_x4_in_excel: {sum(1 for x in pending if x['reason_skipped']=='missing_or_invalid_x4_in_excel')}

Products with x4 field in products.js: {x4_count}
referencePrice/discount remaining: {len(ref_left)} ids {ref_left[:10]}{'...' if len(ref_left)>10 else ''}
Price integrity: {'PASS' if price_ok else 'FAIL'}
Image paths unchanged: {'PASS' if not image_changes else 'FAIL — ' + '; '.join(image_changes[:5])}

Backup: {backup_path}
Reports: {REPORTS_DIR / 'x4_implemented.csv'}, {REPORTS_DIR / 'x4_pending_manual.csv'}
"""
    (REPORTS_DIR / "x4_reconciliation_summary.txt").write_text(summary, encoding="utf-8")
    print(summary)


def format_candidates(rows: list[dict]) -> str:
    parts = []
    for r in rows:
        parts.append(
            f"{r['workbook_file']}|{r['sheet']}|row{r['row']}|Comp={r['comp']}|X4={r['x4']}|Bill={r['bill_number']}"
        )
    return " || ".join(parts)


def write_csv(path: Path, rows: list[dict], fieldnames: list[str]) -> None:
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        w.writeheader()
        for row in rows:
            w.writerow({k: row.get(k, "") for k in fieldnames})


if __name__ == "__main__":
    main()
