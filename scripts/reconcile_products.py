#!/usr/bin/env py -3
"""
Reconcile CRACKERS_ajn.xlsx, CRACKERS_all.xlsx, webp images, and products.js.
Run from repo root: py -3 scripts/reconcile_products.py [--apply]
"""
from __future__ import annotations

import argparse
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
IMAGE_DIR = ROOT / "public" / "images" / "products" / "images-mobile-webp"
IMAGE_URL_PREFIX = "/images/products/images-mobile-webp"
PRODUCTS_JS = ROOT / "src" / "data" / "products.js"
REPORTS_DIR = ROOT / "reports"
WORKBOOKS = [
    ("CRACKERS_ajn.xlsx", "carckers_ajn"),
    ("CRACKERS_all.xlsx", "carckers_all"),
]

# products.js name (match_key) -> Excel Particulars match_key
JS_TO_EXCEL_KEY = {
    "signal_bomb_(7_shots)": "signal_bomb(_7_shots)",
    "mega_star": "mega_star_12",
    "mottu_pattu": "mottu_patlu",
    "masti_colour_koti_r&gi_mega": "masti_colour_koti_r&g_mega",
    "vip_10_1_matches": "vip_10_in_1_matches",
    "ganga_jamuna": "ganga_jamuna",
    "peacock_gaint": "peacock_big",
}

BIJILI_IMAGE_BY_PRICE = {
    ("1k_bijili", 540): "1K_BIJILI_May.webp",
    ("1k_bijili", 800): "1K_BIJILI_Dragon.webp",
    ("2k_bijili", 1080): "2K_BIJILI_May.webp",
    ("5k_bijili", 2700): "5K_BIJILI_May.webp",
    ("5k_bijili", 4000): "5K_BIJILI_Dragon.webp",
    ("10k_bijili", 5400): "10K_BIJILI_May.webp",
    ("10k_bijili", 8000): "10K_BIJILI_Dragon.webp",
}

VARIANT_SUFFIX_RE = re.compile(r"_(?:\d+|DETAIL|detail|FRONT|front|IN|LB|BACK|back)$", re.I)


def normalize_product_name(name: str) -> str:
    return re.sub(r"\s+", "_", name.strip())


def match_key(name: str) -> str:
    return normalize_product_name(name).lower()


def loose_key(name: str) -> str:
    return re.sub(r"[^a-z0-9]", "", name.lower())


def load_excel_rows(workbook_file: str, workbook_label: str) -> list[dict]:
    path = ROOT / workbook_file
    wb = openpyxl.load_workbook(path, data_only=True)
    rows: list[dict] = []
    for sheet in wb.sheetnames:
        ws = wb[sheet]
        header_row = None
        for r in range(1, min(25, ws.max_row + 1)):
            if ws.cell(r, 3).value == "Particulars":
                header_row = r
                break
        if header_row is None:
            continue
        for r in range(header_row + 1, ws.max_row + 1):
            name = ws.cell(r, 3).value
            if name is None or not str(name).strip():
                continue
            particulars = str(name).strip()
            x4 = ws.cell(r, 7).value
            rate = ws.cell(r, 6).value
            rows.append(
                {
                    "workbook": workbook_label,
                    "workbook_file": workbook_file,
                    "sheet": sheet,
                    "row": r,
                    "name": particulars,
                    "normalized": normalize_product_name(particulars),
                    "match_key": match_key(particulars),
                    "loose_key": loose_key(particulars),
                    "x4": x4,
                    "rate": rate,
                }
            )
    wb.close()
    return rows


def load_products_js() -> list[dict]:
    code = """
    import { products } from './src/data/products.js';
    console.log(JSON.stringify(products));
    """
    result = subprocess.run(
        ["node", "--input-type=module", "-e", code],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    )
    return json.loads(result.stdout)


def inventory_images() -> tuple[list[str], dict[str, list[str]], dict[str, list[str]]]:
    files = sorted(f.name for f in IMAGE_DIR.glob("*.webp") if f.is_file())
    by_match_key: dict[str, list[str]] = defaultdict(list)
    by_loose: dict[str, list[str]] = defaultdict(list)
    for fn in files:
        base = fn[:-5]
        by_match_key[match_key(base.replace("_", " "))].append(fn)
        by_loose[loose_key(base)].append(fn)
    for groups in (by_match_key, by_loose):
        for k in list(groups.keys()):
            groups[k] = sorted(set(groups[k]))
    return files, by_match_key, by_loose


def parse_x4(val) -> tuple[float | None, str]:
    if val is None or val == "":
        return None, "missing_x4"
    try:
        num = float(val)
        return num, "ok"
    except (TypeError, ValueError):
        return None, "invalid_x4"


def dedupe_excel_rows(rows: list[dict]) -> list[dict]:
    """Prefer carckers_all; drop duplicate ajn mirror rows."""
    all_rows = [r for r in rows if r["workbook"] == "carckers_all"]
    pool = all_rows or rows
    seen = set()
    out = []
    for r in pool:
        key = (r["sheet"], r["row"], r["match_key"])
        if key in seen:
            continue
        seen.add(key)
        out.append(r)
    return out


def pick_excel_row(candidates: list[dict], product: dict) -> tuple[dict | None, str]:
    if not candidates:
        return None, "no_excel_match"
    candidates = dedupe_excel_rows(candidates)

    bill_49 = [r for r in candidates if "20261049" in r["sheet"]]
    pool = bill_49 or candidates

    if len(pool) == 1:
        return pool[0], "ok"

    price = product.get("price")
    if price is not None:
        by_price = [r for r in pool if parse_x4(r["x4"])[0] == float(price)]
        if len(by_price) == 1:
            return by_price[0], "ok_x4_equals_selling_price"

    ref = product.get("referencePrice")
    if ref is not None:
        by_ref = [r for r in pool if parse_x4(r["x4"])[0] == float(ref)]
        if len(by_ref) == 1:
            return by_ref[0], "ok_x4_equals_referencePrice"

    x4_vals = {parse_x4(r["x4"])[0] for r in pool}
    x4_vals.discard(None)
    if len(x4_vals) == 1:
        return pool[0], "ok_consistent_x4"

    return None, "conflicting_excel_rows"


def excel_keys_for_product(product_name: str) -> list[str]:
    pk = match_key(product_name)
    keys = [JS_TO_EXCEL_KEY.get(pk, pk)]
    if pk not in keys:
        keys.insert(0, pk)
    return list(dict.fromkeys(keys))


def find_image_candidates(product: dict, image_files: list[str], by_match_key, by_loose) -> list[str]:
    name = product["name"]
    pk = match_key(name)
    candidates: set[str] = set()

    if "bijili" in pk:
        fn = BIJILI_IMAGE_BY_PRICE.get((pk, product.get("price")))
        if fn and fn in image_files:
            return [fn]
        return []

    for key in excel_keys_for_product(name):
        candidates.update(by_match_key.get(key, []))

    candidates.update(by_match_key.get(pk, []))
    candidates.update(by_loose.get(loose_key(name), []))

    shot_match = re.search(r"(\d+)\s*shots?", name, re.I)
    if shot_match:
        fn = f"leo-{shot_match.group(1)}-shots.webp"
        if fn in image_files:
            candidates.add(fn)

    if pk == "gb_wonderfull_40_items":
        for fn in image_files:
            if fn.upper().startswith("GB-WONDERFULL-40-ITEMS"):
                candidates.add(fn)

    expected = f"{normalize_product_name(name)}.webp"
    if expected in image_files:
        candidates.add(expected)

    prefix = normalize_product_name(name) + "_"
    prefix_upper = prefix.upper()
    for fn in image_files:
        stem = fn[:-5]
        if stem.upper().startswith(prefix_upper) or fn.upper().startswith(prefix_upper):
            candidates.add(fn)

    # SIGNAL BOMB image filename uses parenthesis
    if "signal_bomb" in pk:
        for fn in image_files:
            if loose_key(fn).startswith("signalbomb7"):
                candidates.add(fn)

    if pk == "vip_10_1_matches":
        for fn in image_files:
            if "VIP_10_IN_1" in fn.upper():
                candidates.add(fn)

    if "masti_colour_koti" in pk:
        for fn in image_files:
            if "MASTI_COLOUR_KOTI" in fn.upper():
                candidates.add(fn)

    return sorted(candidates)


def is_variant_family(filenames: list[str], expected_normalized: str) -> bool:
    if len(filenames) <= 1:
        return True
    upper = [f.upper() for f in filenames]
    if all("GB-WONDERFULL-40-ITEMS" in f for f in upper):
        return True
    stem = match_key(expected_normalized.replace("_", " "))
    bases = {match_key(VARIANT_SUFFIX_RE.sub("", f[:-5]).replace("_", " ")) for f in filenames}
    return len(bases) == 1 and stem in bases


def pick_primary_and_additional(filenames: list[str], expected_normalized: str) -> tuple[str | None, list[str], str]:
    if not filenames:
        return None, [], "no_files"

    expected_key = match_key(expected_normalized.replace("_", " "))
    exact = [f for f in filenames if match_key(f[:-5]) == expected_key]
    pool = exact if exact else filenames

    def sort_key(fn: str):
        base = fn[:-5]
        if match_key(base) == expected_key:
            rank = 0
        elif base.upper().endswith(".WEBP"):
            rank = 4
        elif re.search(r"-1$", base, re.I):
            rank = 1
        elif re.search(r"_1$", base, re.I):
            rank = 1
        elif re.search(r"\.webp$", fn, re.I) and base.endswith("_2"):
            rank = 2
        elif re.search(r"_DETAIL$", base, re.I):
            rank = 5
        elif re.search(r"_front$", base, re.I):
            rank = 3
        else:
            rank = 4
        return (rank, base.lower())

    pool = sorted(set(pool), key=sort_key)
    primary = pool[0]
    additional = [f for f in pool if f != primary]

    if is_variant_family(filenames, expected_normalized):
        return primary, additional, "confident"
    if exact:
        return primary, additional, "confident"
    return primary, additional, "ambiguous_group"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="Apply safe updates to products.js")
    args = parser.parse_args()

    REPORTS_DIR.mkdir(parents=True, exist_ok=True)

    excel_rows: list[dict] = []
    for wb_file, wb_label in WORKBOOKS:
        excel_rows.extend(load_excel_rows(wb_file, wb_label))

    products = load_products_js()
    image_files, by_match_key, by_loose = inventory_images()

    excel_by_key: dict[str, list[dict]] = defaultdict(list)
    for row in excel_rows:
        excel_by_key[row["match_key"]].append(row)

    mapping_rows = []
    manual_review = []
    missing_images = []
    updated_products: dict[str, dict] = {}
    matched_image_files: set[str] = set()

    for product in products:
        excel_candidates: list[dict] = []
        for ek in excel_keys_for_product(product["name"]):
            excel_candidates.extend(excel_by_key.get(ek, []))

        excel_row, excel_note = pick_excel_row(excel_candidates, product)

        img_candidates = find_image_candidates(product, image_files, by_match_key, by_loose)
        primary, additional, img_status = pick_primary_and_additional(
            img_candidates, normalize_product_name(product["name"])
        )

        x4_val = None
        x4_note = excel_note
        if excel_row:
            x4_val, x4_parse = parse_x4(excel_row["x4"])
            if x4_parse != "ok":
                x4_note = x4_parse
                manual_review.append(
                    {
                        "issue": x4_parse,
                        "product_id": product["id"],
                        "product_name": product["name"],
                        "workbook": excel_row["workbook"],
                        "sheet": excel_row["sheet"],
                        "row": excel_row["row"],
                        "notes": f"X4 raw={excel_row['x4']!r}",
                    }
                )
            elif excel_note.startswith("ok"):
                x4_note = excel_note
        elif excel_note == "no_excel_match":
            manual_review.append(
                {
                    "issue": "js_product_not_in_excel",
                    "product_id": product["id"],
                    "product_name": product["name"],
                    "workbook": "",
                    "sheet": "",
                    "row": "",
                    "notes": "No Excel row with matching Particulars name",
                }
            )
        elif excel_note == "conflicting_excel_rows":
            manual_review.append(
                {
                    "issue": "duplicate_excel_name",
                    "product_id": product["id"],
                    "product_name": product["name"],
                    "workbook": "",
                    "sheet": "",
                    "row": "",
                    "notes": "Could not pick a single authoritative Excel row for X4",
                }
            )

        if not primary:
            match_status = "no_image"
            missing_images.append(
                {
                    "workbook": excel_row["workbook"] if excel_row else "",
                    "sheet": excel_row["sheet"] if excel_row else "",
                    "excel_row": excel_row["row"] if excel_row else "",
                    "original_name": excel_row["name"] if excel_row else product["name"],
                    "normalized_name": normalize_product_name(product["name"]),
                    "expected_image": f"{normalize_product_name(product['name'])}.webp",
                    "product_id": product["id"],
                    "notes": "No confident image match",
                }
            )
        elif img_status == "ambiguous_group":
            match_status = "ambiguous_image"
            manual_review.append(
                {
                    "issue": "ambiguous_image_group",
                    "product_id": product["id"],
                    "product_name": product["name"],
                    "workbook": "",
                    "sheet": "",
                    "row": "",
                    "notes": f"Candidates: {', '.join(img_candidates)}; picked {primary}",
                }
            )
        else:
            match_status = "matched"
            matched_image_files.add(primary)
            matched_image_files.update(additional)

        excel_ok = excel_row is not None and excel_note.startswith("ok")
        can_update = match_status == "matched" and excel_ok and primary is not None

        impl_status = "skipped"
        if can_update and not args.apply:
            impl_status = "ready_to_update"
        elif can_update and args.apply:
            impl_status = "updated"
        elif match_status != "matched":
            impl_status = "skipped_no_image"
        elif not excel_ok:
            impl_status = "skipped_excel"

        if can_update and args.apply:
            new_images = [f"{IMAGE_URL_PREFIX}/{primary}"] + [
                f"{IMAGE_URL_PREFIX}/{a}" for a in additional
            ]
            for img_url in new_images:
                rel = img_url.replace("/images/products/", "public/images/products/").replace("/", "\\")
                disk = ROOT / rel.replace("\\", "/").replace("public/", "public/")
                if not (ROOT / "public" / "images" / "products" / "images-mobile-webp" / Path(img_url).name).exists():
                    manual_review.append(
                        {
                            "issue": "missing_image_file",
                            "product_id": product["id"],
                            "product_name": product["name"],
                            "workbook": "",
                            "sheet": "",
                            "row": "",
                            "notes": f"File not found for {img_url}",
                        }
                    )
                    impl_status = "skipped_missing_file"
                    can_update = False
                    break

            if can_update:
                updated_products[product["id"]] = {
                    "images": new_images,
                    "x4_verified": x4_val,
                }

        mapping_rows.append(
            {
                "source_workbook": excel_row["workbook"] if excel_row else "",
                "source_sheet": excel_row["sheet"] if excel_row else "",
                "excel_row_number": excel_row["row"] if excel_row else "",
                "original_excel_product_name": excel_row["name"] if excel_row else "",
                "normalized_product_name": normalize_product_name(product["name"]),
                "x4_value": x4_val if x4_val is not None else "",
                "existing_product_id": product["id"],
                "existing_selling_price": product["price"],
                "primary_matched_image": primary or "",
                "additional_matched_images": ";".join(additional),
                "match_status": match_status,
                "implementation_status": impl_status,
                "notes": f"{excel_note}; {img_status}",
            }
        )

    js_keys = {match_key(p["name"]) for p in products}
    for row in dedupe_excel_rows(excel_rows):
        keys = {row["match_key"]}
        for js_k, ex_k in JS_TO_EXCEL_KEY.items():
            if ex_k == row["match_key"]:
                keys.add(js_k)
        if not keys.intersection(js_keys):
            manual_review.append(
                {
                    "issue": "excel_not_in_js",
                    "product_id": "",
                    "product_name": row["name"],
                    "workbook": row["workbook"],
                    "sheet": row["sheet"],
                    "row": row["row"],
                    "notes": "Excel product has no products.js match",
                }
            )

    for row in dedupe_excel_rows(excel_rows):
        pk = row["match_key"]
        imgs = by_match_key.get(pk, [])
        if not imgs:
            missing_images.append(
                {
                    "workbook": row["workbook"],
                    "sheet": row["sheet"],
                    "excel_row": row["row"],
                    "original_name": row["name"],
                    "normalized_name": row["normalized"],
                    "expected_image": f"{row['normalized']}.webp",
                    "product_id": "",
                    "notes": "Excel row — no image file matched by name",
                }
            )

    products_by_key: dict[str, list] = defaultdict(list)
    for p in products:
        products_by_key[match_key(p["name"])].append(p)
    for pk, plist in products_by_key.items():
        if len(plist) > 1:
            manual_review.append(
                {
                    "issue": "duplicate_js_name",
                    "product_id": ",".join(p["id"] for p in plist),
                    "product_name": plist[0]["name"],
                    "workbook": "",
                    "sheet": "",
                    "row": "",
                    "notes": f"{len(plist)} products.js entries share this name",
                }
            )

    unmatched_images = [f for f in image_files if f not in matched_image_files]

    backup_path = None
    if args.apply and updated_products:
        ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        backup_path = ROOT / "reports" / f"products.js.backup.{ts}"
        shutil.copy2(PRODUCTS_JS, backup_path)
        baseline_path = ROOT / "reports" / f"products.js.baseline.{ts}.json"
        baseline_path.write_text(json.dumps(products, indent=2), encoding="utf-8")

        new_products = []
        for p in products:
            upd = updated_products.get(p["id"])
            if not upd:
                new_products.append(p)
                continue
            np = {k: v for k, v in p.items() if k not in ("referencePrice", "discount")}
            np["images"] = upd["images"]
            if np["price"] != p["price"]:
                raise RuntimeError(f"Price changed for {p['id']}")
            new_products.append(np)

        write_products_js(new_products, PRODUCTS_JS)

    write_csv(REPORTS_DIR / "product_image_mapping.csv", mapping_rows, list(mapping_rows[0].keys()) if mapping_rows else [])
    write_csv(
        REPORTS_DIR / "missing_images.csv",
        dedupe_dicts(missing_images),
        ["workbook", "sheet", "excel_row", "original_name", "normalized_name", "expected_image", "product_id", "notes"],
    )
    write_csv(
        REPORTS_DIR / "unmatched_images.csv",
        [{"filename": f} for f in unmatched_images],
        ["filename"],
    )
    write_csv(
        REPORTS_DIR / "manual_review.csv",
        manual_review,
        ["issue", "product_id", "product_name", "workbook", "sheet", "row", "notes"],
    )

    ajn_unique = len({r["match_key"] for r in excel_rows if r["workbook"] == "carckers_ajn"})
    all_unique = len({r["match_key"] for r in excel_rows if r["workbook"] == "carckers_all"})
    union_unique = len({r["match_key"] for r in excel_rows})

    updated_count = sum(1 for r in mapping_rows if r["implementation_status"] == "updated")
    ready_count = sum(1 for r in mapping_rows if r["implementation_status"] == "ready_to_update")
    skipped = sum(1 for r in mapping_rows if r["implementation_status"].startswith("skipped"))
    matched = sum(1 for r in mapping_rows if r["match_status"] == "matched")
    no_image = sum(1 for r in mapping_rows if r["match_status"] == "no_image")
    ambiguous = sum(1 for r in mapping_rows if r["match_status"] == "ambiguous_image")
    x4_mapped = sum(1 for r in mapping_rows if str(r["x4_value"]) != "" and r["notes"].startswith("ok"))
    with_additional = sum(1 for r in mapping_rows if r["additional_matched_images"])

    base_names = {VARIANT_SUFFIX_RE.sub("", f[:-5]) for f in image_files}

    summary = f"""Implementation summary ({datetime.now(timezone.utc).isoformat()})
Source workbooks: CRACKERS_ajn.xlsx (carckers_ajn), CRACKERS_all.xlsx (carckers_all)
Image directory: {IMAGE_DIR}

Total unique product records in carckers_ajn: {ajn_unique}
Total unique product records in carckers_all: {all_unique}
Total unique products across both sheets (union): {union_unique}
Total Excel data rows (both workbooks, all sheets): {len(excel_rows)}

Total images discovered: {len(image_files)}
Total unique image base names (variant suffixes stripped): {len(base_names)}

Total existing products.js products: {len(products)}
Total products.js rows with confident image match: {matched}
Total products.js rows without image: {no_image}
Total ambiguous image matches: {ambiguous}

Total products updated successfully: {updated_count}
Total products ready_to_update (dry-run): {ready_count}
Total products skipped: {skipped}

Total primary images assigned (matched rows): {matched}
Total products with additional images: {with_additional}
Total X4 values mapped to an Excel row: {x4_mapped}
Total manual_review.csv rows: {len(manual_review)}
Total unmatched image files: {len(unmatched_images)}

Backup file: {backup_path or '(none — run with --apply to update products.js)'}
Reports: {REPORTS_DIR}
"""
    (REPORTS_DIR / "implementation_summary.txt").write_text(summary, encoding="utf-8")
    print(summary)


def dedupe_dicts(items: list[dict]) -> list[dict]:
    seen = set()
    out = []
    for d in items:
        key = tuple(sorted((k, str(v)) for k, v in d.items()))
        if key in seen:
            continue
        seen.add(key)
        out.append(d)
    return out


def write_csv(path: Path, rows: list[dict], fieldnames: list[str]) -> None:
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        w.writeheader()
        for row in rows:
            w.writerow({k: row.get(k, "") for k in fieldnames})


def write_products_js(products: list[dict], path: Path) -> None:
    body = json.dumps(products, indent=2, ensure_ascii=False)
    content = (
        "/**\n"
        " * Customer-facing catalogue (161 products).\n"
        " * Generated from diwali_product_master_final.csv — do not add supplier/internal fields.\n"
        " */\n\n"
        f"export const products = {body}\n"
    )
    path.write_text(content, encoding="utf-8")


if __name__ == "__main__":
    main()
