#!/usr/bin/env py -3
"""Phase 1: duplicate inventory + proposed company-based renames (read-only)."""
from __future__ import annotations

import csv
import json
import re
import subprocess
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "reports" / "duplicate_audit"
IMAGE_DIR = ROOT / "public" / "images" / "products" / "images-mobile-webp"
WORKBOOKS = [
    ("CRACKERS_ajn.xlsx", "carckers_ajn"),
    ("CRACKERS_all.xlsx", "carckers_all"),
]

VARIANT_SUFFIX_RE = re.compile(
    r"(_(?:\d+|DETAIL|detail|FRONT|front|IN|LB|BACK|back|May|Dragon))$",
    re.I,
)


def normalize_name(name: str) -> str:
    return re.sub(r"\s+", "_", name.strip())


def norm_key(name: str) -> str:
    return normalize_name(name).lower()


def loose_key(name: str) -> str:
    return re.sub(r"[^a-z0-9]", "", name.lower())


def sanitize_comp(comp: str) -> str:
    s = (comp or "").strip()
    s = re.sub(r"\s+", "_", s)
    s = re.sub(r"[^A-Za-z0-9_\-&]", "", s)
    return s.upper() if s else "UNKNOWN"


def load_excel() -> list[dict]:
    rows: list[dict] = []
    for wb_file, wb_label in WORKBOOKS:
        path = ROOT / wb_file
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
                comp = ws.cell(r, 2).value
                rate = ws.cell(r, 6).value
                x4 = ws.cell(r, 7).value
                name = str(particulars).strip()
                rows.append(
                    {
                        "workbook": wb_label,
                        "workbook_file": wb_file,
                        "sheet": sheet,
                        "row": r,
                        "bill_number": bill_no,
                        "particulars": name,
                        "normalized": normalize_name(name),
                        "norm_key": norm_key(name),
                        "comp": str(comp).strip() if comp is not None else "",
                        "comp_suffix": sanitize_comp(str(comp) if comp is not None else ""),
                        "rate": rate,
                        "x4": x4,
                        "record_id": f"{wb_label}|{sheet}|{r}",
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


def strip_photo_suffix(base: str) -> str:
    prev = None
    cur = base
    while cur != prev:
        prev = cur
        cur = VARIANT_SUFFIX_RE.sub("", cur)
        cur = re.sub(r"_(\d+)$", "", cur)
    return cur


def image_base_group(filename: str) -> str:
    return norm_key(strip_photo_suffix(filename[:-5]).replace("_", " "))


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    excel_rows = load_excel()
    products = load_products()
    image_files = sorted(p.name for p in IMAGE_DIR.glob("*.webp"))

    # Catalogue view: prefer carckers_all (one row per sheet+row, not ajn mirror)
    all_only = [r for r in excel_rows if r["workbook"] == "carckers_all"]
    by_norm_all: dict[str, list[dict]] = defaultdict(list)
    for row in all_only:
        by_norm_all[row["norm_key"]].append(row)

    by_norm_union: dict[str, list[dict]] = defaultdict(list)
    for row in excel_rows:
        by_norm_union[row["norm_key"]].append(row)

    dg_counter = 0
    norm_to_dg: dict[str, str] = {}
    for key, group in sorted(by_norm_all.items()):
        if len(group) > 1:
            dg_counter += 1
            norm_to_dg[key] = f"EXDG{dg_counter:04d}"

    by_norm = by_norm_all  # primary for matching

    excel_dup_rows_out = []
    for row in excel_rows:
        key = row["norm_key"]
        dg = norm_to_dg.get(key, "")
        group_all = by_norm_all.get(key, [row])
        union = by_norm_union.get(key, [row])
        dup_type = "unique"
        if len(group_all) > 1:
            comps = {g["comp"] for g in group_all if g["comp"]}
            rates = {g["rate"] for g in group_all}
            x4s = {g["x4"] for g in group_all}
            sheets = {g["sheet"] for g in group_all}
            if len(comps) > 1:
                dup_type = "same_name_different_comp"
            elif len(rates) > 1 or len(x4s) > 1:
                dup_type = "same_name_same_comp_different_rate_or_x4"
            elif len(sheets) > 1:
                dup_type = "same_name_across_bills"
            else:
                dup_type = "exact_duplicate_rows"
        elif len(union) > 1 and len({g["workbook"] for g in union}) > 1:
            dup_type = "ajn_all_mirror_only"
        group = group_all
        others = [g["record_id"] for g in group if g["record_id"] != row["record_id"]]
        excel_dup_rows_out.append(
            {
                "workbook": row["workbook"],
                "worksheet": row["sheet"],
                "excel_row_number": row["row"],
                "bill_number": row["bill_number"],
                "original_particulars": row["particulars"],
                "normalized_product_name": row["normalized"],
                "comp": row["comp"],
                "rate": row["rate"],
                "x4": row["x4"],
                "duplicate_group_id": dg,
                "duplicate_type": dup_type,
                "other_matching_excel_rows": ";".join(others),
                "confidence_review_status": "manual_review" if dg else "ok",
            }
        )

    # --- JS duplicate groups by norm_key ---
    js_by_norm: dict[str, list[dict]] = defaultdict(list)
    for p in products:
        js_by_norm[norm_key(p["name"])].append(p)

    jdg_counter = 0
    js_norm_to_jdg: dict[str, str] = {}
    for key, group in js_by_norm.items():
        if len(group) > 1:
            jdg_counter += 1
            js_norm_to_jdg[key] = f"JSDG{jdg_counter:04d}"

    js_dup_out = []
    for key, group in js_by_norm.items():
        if len(group) <= 1:
            continue
        jdg = js_norm_to_jdg[key]
        prices = {p["price"] for p in group}
        images = {tuple(p.get("images") or []) for p in group}
        excel_candidates = by_norm.get(key, [])
        comps = sorted({c["comp"] for c in excel_candidates if c["comp"]})
        conflicts = []
        if len(prices) > 1:
            conflicts.append("different_selling_prices")
        if len(images) > 1:
            conflicts.append("different_image_paths")
        if len(excel_candidates) > 1:
            conflicts.append("multiple_excel_rows")
        if not excel_candidates:
            conflicts.append("no_excel_name_match")
        action = "map_each_js_id_to_excel_row_by_price_x4_comp"
        if not excel_candidates:
            action = "manual_excel_name_alias_required"
        elif len(group) > len({(c["comp"], c["x4"]) for c in excel_candidates}):
            action = "manual_review_insufficient_distinct_excel_variants"

        for p in group:
            cand_rows = []
            for c in excel_candidates:
                match = ""
                if c["x4"] is not None and float(c["x4"]) == float(p["price"]):
                    match = "x4_equals_selling_price"
                cand_rows.append(f"{c['workbook']}|{c['sheet']}|{c['row']}|{c['comp']}|{c['x4']}|{match}")
            js_dup_out.append(
                {
                    "duplicate_group_id": jdg,
                    "product_id": p["id"],
                    "product_name": p["name"],
                    "selling_price": p["price"],
                    "existing_image_paths": ";".join(p.get("images") or []),
                    "candidate_excel_rows": " || ".join(cand_rows),
                    "candidate_company_names": ";".join(comps),
                    "conflict_description": ";".join(conflicts),
                    "recommended_next_action": action,
                }
            )

    # --- Image audit ---
    images_by_base: dict[str, list[str]] = defaultdict(list)
    for fn in image_files:
        images_by_base[image_base_group(fn)].append(fn)

    # Map image stem to js products (loose)
    js_by_loose: dict[str, list[dict]] = defaultdict(list)
    for p in products:
        js_by_loose[loose_key(p["name"])].append(p)

    image_audit_out = []
    for fn in image_files:
        base = fn[:-5]
        grp = image_base_group(fn)
        excel_matches = by_norm.get(grp, [])
        if not excel_matches:
            # try loose from base
            lk = loose_key(base.replace("_", " "))
            for k, rows in by_norm.items():
                if loose_key(k) == lk:
                    excel_matches = rows
                    break
        js_ids = []
        for p in products:
            imgs = p.get("images") or []
            if any(fn in img or base in img for img in imgs):
                js_ids.append(p["id"])
        if not js_ids and excel_matches:
            js_ids = [p["id"] for p in js_by_norm.get(grp, [])]

        related = images_by_base.get(grp, [fn])
        suffix_note = ""
        if re.search(r"_(\d+|DETAIL|FRONT|May|Dragon)", base, re.I):
            suffix_note = "variant_or_extra_photo_suffix"

        dup_cat = "single_file"
        if len(related) > 1:
            dup_cat = "multi_photo_same_product_group"
        if len(excel_matches) > 1:
            dup_cat = "excel_name_duplicate_mapping"
        if len(js_ids) > 1:
            dup_cat = "multiple_js_ids_same_image_or_name"
        if not excel_matches:
            dup_cat = "no_excel_name_match"

        conf = "high"
        if (
            len(excel_matches) > 1
            or len(js_ids) > 1
            or dup_cat in ("excel_name_duplicate_mapping", "multiple_js_ids_same_image_or_name", "no_excel_name_match")
        ):
            conf = "review"

        image_audit_out.append(
            {
                "current_filename": fn,
                "normalized_base_name": grp,
                "matching_excel_product_names": ";".join(sorted({r["particulars"] for r in excel_matches})),
                "candidate_company_names": ";".join(sorted({r["comp"] for r in excel_matches if r["comp"]})),
                "matching_javascript_product_ids": ";".join(js_ids),
                "number_of_related_image_files": len(related),
                "duplicate_category": dup_cat,
                "confidence": conf,
                "review_notes": suffix_note,
            }
        )

    # --- Proposed renames (ambiguous only) ---
    def propose_name(current: str, excel_row: dict | None, extra: str = "") -> str:
        stem = current[:-5]
        comp = sanitize_comp(excel_row["comp"]) if excel_row else "UNKNOWN"
        if re.search(r"_(May|Dragon)$", stem, re.I):
            # insert comp before May/Dragon
            m = re.match(r"^(.*)_(May|Dragon)$", stem, re.I)
            if m:
                return f"{m.group(1)}_{comp}_{m.group(2)}.webp"
        if extra:
            return f"{stem}_{comp}_{extra}.webp"
        return f"{stem}_{comp}.webp"

    proposed = []
    proposed_names: set[str] = set()
    collision_rows = []

    ambiguous_files = [
        ia
        for ia in image_audit_out
        if ia["confidence"] == "review"
    ]

    for ia in ambiguous_files:
        fn = ia["current_filename"]
        grp = ia["normalized_base_name"]
        excel_matches = by_norm.get(grp, [])

        # Pick candidate rows: match js price to x4 when single js id
        js_ids = [x for x in ia["matching_javascript_product_ids"].split(";") if x]
        candidate_rows = excel_matches[:]
        if len(js_ids) == 1:
            p = next(x for x in products if x["id"] == js_ids[0])
            by_price = [r for r in excel_matches if r["x4"] is not None and float(r["x4"]) == float(p["price"])]
            if len(by_price) == 1:
                candidate_rows = by_price

        if len(candidate_rows) == 1:
            row = candidate_rows[0]
            new_name = propose_name(fn, row)
            reason = "single_resolved_excel_row_after_price_or_comp_rules"
            extra = ""
        elif len(candidate_rows) > 1:
            # multiple comps - one proposal per comp row that could own this file
            for row in candidate_rows:
                bill = re.sub(r"[^0-9]", "", str(row["bill_number"]))[-6:] or "BILL"
                new_name = propose_name(fn, row, extra=f"B{bill}")
                reason = f"duplicate_name_multiple_excel_rows_comp={row['comp']}"
                collision = new_name in proposed_names or new_name == fn
                if collision:
                    collision_rows.append((fn, new_name))
                proposed.append(
                    {
                        "current_image_filename": fn,
                        "proposed_new_filename": new_name,
                        "original_product_name": row["particulars"],
                        "excel_comp_value": row["comp"],
                        "source_workbook": row["workbook"],
                        "source_sheet": row["sheet"],
                        "excel_row_number": row["row"],
                        "matching_javascript_product_ids": ia["matching_javascript_product_ids"],
                        "reason_for_proposed_rename": reason,
                        "collision_check": "COLLISION" if collision else "ok",
                        "approval_status": "pending_review",
                    }
                )
                proposed_names.add(new_name)
            continue
        else:
            row = None
            new_name = propose_name(fn, None)
            reason = "no_excel_match_comp_unknown"
            extra = ""

        collision = new_name in proposed_names or (new_name == fn and row is None)
        if collision:
            collision_rows.append((fn, new_name))
        proposed.append(
            {
                "current_image_filename": fn,
                "proposed_new_filename": new_name,
                "original_product_name": row["particulars"] if row else "",
                "excel_comp_value": row["comp"] if row else "",
                "source_workbook": row["workbook"] if row else "",
                "source_sheet": row["sheet"] if row else "",
                "excel_row_number": row["row"] if row else "",
                "matching_javascript_product_ids": ia["matching_javascript_product_ids"],
                "reason_for_proposed_rename": reason,
                "collision_check": "COLLISION" if collision else "ok",
                "approval_status": "pending_review",
            }
        )
        proposed_names.add(new_name)

    # Also propose for known shared images without comp suffix (GC_BIG_10p, GC_SPECIAL, etc.)
    priority_stems = {"gc_big_10p", "gc_special", "gc_deluxe", "fp_special", "fp_ashoka", "ganga_jamuna", "4_twinkling"}
    for fn in image_files:
        if norm_key(strip_photo_suffix(fn[:-5])) in priority_stems or norm_key(fn[:-5].replace("_", " ")) in priority_stems:
            if any(p["current_image_filename"] == fn for p in proposed):
                continue
            grp = image_base_group(fn)
            for row in by_norm.get(grp, []):
                new_name = propose_name(fn, row, extra=f"R{row['row']}")
                if any(p["proposed_new_filename"] == new_name for p in proposed):
                    continue
                proposed.append(
                    {
                        "current_image_filename": fn,
                        "proposed_new_filename": new_name,
                        "original_product_name": row["particulars"],
                        "excel_comp_value": row["comp"],
                        "source_workbook": row["workbook"],
                        "source_sheet": row["sheet"],
                        "excel_row_number": row["row"],
                        "matching_javascript_product_ids": ";".join(
                            p["id"] for p in js_by_norm.get(grp, [])
                        ),
                        "reason_for_proposed_rename": "priority_duplicate_product_shared_image",
                        "collision_check": "ok",
                        "approval_status": "pending_review",
                    }
                )

    write_csv(OUT / "excel_duplicate_products.csv", excel_dup_rows_out, list(excel_dup_rows_out[0].keys()))
    write_csv(OUT / "javascript_duplicate_products.csv", js_dup_out, list(js_dup_out[0].keys()) if js_dup_out else [])
    write_csv(OUT / "image_duplicate_audit.csv", image_audit_out, list(image_audit_out[0].keys()))
    write_csv(
        OUT / "proposed_image_renames.csv",
        proposed,
        list(proposed[0].keys()) if proposed else [
            "current_image_filename",
            "proposed_new_filename",
            "original_product_name",
            "excel_comp_value",
            "source_workbook",
            "source_sheet",
            "excel_row_number",
            "matching_javascript_product_ids",
            "reason_for_proposed_rename",
            "collision_check",
            "approval_status",
        ],
    )

    ajn = [r for r in excel_rows if r["workbook"] == "carckers_ajn"]
    all_r = [r for r in excel_rows if r["workbook"] == "carckers_all"]
    exact_groups = len(norm_to_dg)
    affected_excel = sum(len(by_norm_all[k]) for k in norm_to_dg)
    cross_wb = sum(1 for k, g in by_norm_union.items() if len({x["workbook"] for x in g}) > 1)
    mirror_only = sum(1 for k, g in by_norm_all.items() if len(g) == 1 and len(by_norm_union.get(k, [])) > 1)
    js_groups = len(js_norm_to_jdg)
    js_affected = sum(len(js_by_norm[k]) for k in js_norm_to_jdg)
    price_var_groups = sum(
        1 for k, g in js_by_norm.items() if len(g) > 1 and len({p["price"] for p in g}) > 1
    )
    img_groups = sum(1 for v in images_by_base.values() if len(v) > 1)
    ambiguous_imgs = sum(1 for ia in image_audit_out if ia["confidence"] == "review")
    prop_collisions = sum(1 for p in proposed if p["collision_check"] == "COLLISION")
    unresolved = sum(1 for p in proposed if p["excel_comp_value"] == "" or p["reason_for_proposed_rename"].startswith("no_excel"))

    summary = f"""Duplicate audit summary ({datetime.now(timezone.utc).isoformat()})
READ-ONLY Phase 1 — no files renamed, products.js unchanged.

Excel CRACKERS_ajn.xlsx rows examined: {len(ajn)}
Excel CRACKERS_all.xlsx rows examined: {len(all_r)}
Total Excel product rows (both): {len(excel_rows)}

Unique normalized names (ajn): {len({r['norm_key'] for r in ajn})}
Unique normalized names (all): {len({r['norm_key'] for r in all_r})}
Unique normalized names (union): {len(by_norm)}

Duplicate name groups within carckers_all (same Particulars, >1 row): {exact_groups}
Excel records in those groups (all workbook only): {affected_excel}
Product names mirrored in ajn+all (expected pairs): {mirror_only}
Union keys appearing in both workbooks: {cross_wb}

JavaScript duplicate name groups: {js_groups}
JavaScript products in duplicate groups: {js_affected}
JS duplicate groups with different selling prices: {price_var_groups}

Image files total: {len(image_files)}
Image base-name groups with multiple files: {img_groups}
Images flagged review confidence: {ambiguous_imgs}

Proposed rename rows (proposed_image_renames.csv): {len(proposed)}
Proposed rename collisions flagged: {prop_collisions}
Unresolved / missing comp mappings in proposals: {unresolved}

Reports directory: {OUT}
"""
    (OUT / "duplicate_audit_summary.txt").write_text(summary, encoding="utf-8")
    print(summary)


def write_csv(path: Path, rows: list[dict], fieldnames: list[str]) -> None:
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        w.writeheader()
        for row in rows:
            w.writerow({k: row.get(k, "") for k in fieldnames})


if __name__ == "__main__":
    main()
