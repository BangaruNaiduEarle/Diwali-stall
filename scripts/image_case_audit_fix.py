#!/usr/bin/env py -3
"""Case-sensitive product image URL audit and unambiguous fixes."""
from __future__ import annotations

import csv
import json
import re
import shutil
import subprocess
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PRODUCTS_JS = ROOT / "src" / "data" / "products.js"
IMG_DIR = ROOT / "public" / "images" / "products" / "images-mobile-webp"
REPORTS = ROOT / "reports"
PREFIX = "/images/products/images-mobile-webp/"


def load_products() -> list[dict]:
    code = """
    import { products } from './src/data/products.js';
    console.log(JSON.stringify(products));
    """
    r = subprocess.run(
        ["node", "--input-type=module", "-e", code],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    )
    return json.loads(r.stdout)


def write_products_js(products: list[dict]) -> None:
    body = json.dumps(products, indent=2, ensure_ascii=False)
    header = PRODUCTS_JS.read_text(encoding="utf-8").split("export const products")[0]
    if "export const products" not in PRODUCTS_JS.read_text(encoding="utf-8"):
        header = (
            "/**\n"
            " * Customer-facing catalogue (161 products).\n"
            " * Generated from diwali_product_master_final.csv — do not add supplier/internal fields.\n"
            " */\n\n"
        )
    else:
        header = PRODUCTS_JS.read_text(encoding="utf-8").split("export const products =")[0]
    PRODUCTS_JS.write_text(f"{header}export const products = {body}\n", encoding="utf-8")


def scan_actual_files() -> dict[str, str]:
    """Map lowercase basename -> list of exact names (detect case collisions)."""
    exact: list[str] = []
    for entry in IMG_DIR.iterdir():
        if entry.is_file():
            exact.append(entry.name)
    by_lower: dict[str, list[str]] = defaultdict(list)
    for name in exact:
        by_lower[name.lower()].append(name)
    return {"exact_set": set(exact), "by_lower": dict(by_lower), "all": sorted(exact)}


def extract_basename(url: str) -> tuple[str, str, str]:
    """Returns (full_url_normalized, basename, issue_prefix)."""
    u = url.strip().replace("\\", "/")
    if u.startswith("http://") or u.startswith("https://"):
        return u, Path(u).name, "external_url"
    if not u.startswith("/"):
        u = "/" + u
    if not u.startswith(PREFIX.rstrip("/")) and "/images-mobile-webp/" not in u:
        if u.startswith("/images/products/"):
            return u, Path(u).name, "path_outside_webp_dir"
        return u, Path(u).name, "unexpected_path"
    return u, Path(u).name, "ok"


def resolve_correction(basename: str, files: dict) -> tuple[str | None, str, str]:
    """
    Returns (correct_basename_or_none, issue_type, status).
    status: exact_match | fixed_case | missing | ambiguous_case | wrong_extension
    """
    exact_set = files["exact_set"]
    by_lower = files["by_lower"]

    if basename in exact_set:
        return basename, "none", "exact_match"

    lower = basename.lower()
    candidates = by_lower.get(lower, [])

    if not candidates:
        # try extension swap to .webp if referenced wrong ext
        stem = Path(basename).stem
        webp_candidates = by_lower.get(f"{stem}.webp".lower(), [])
        if len(webp_candidates) == 1:
            return webp_candidates[0], "extension_mismatch", "proposed_fix"
        if len(webp_candidates) > 1:
            return None, "extension_ambiguous", "manual_review"
        return None, "missing_file", "unresolved"

    if len(candidates) == 1:
        if candidates[0] != basename:
            return candidates[0], "case_mismatch", "proposed_fix"
        return candidates[0], "none", "exact_match"

    return None, "ambiguous_case_collision", "manual_review"


def audit_products(products: list[dict], files: dict) -> list[dict]:
    rows = []
    seen_urls: dict[str, list[str]] = defaultdict(list)

    for p in products:
        pid = p["id"]
        name = p.get("name", "")
        urls: list[str] = []
        for u in p.get("images") or []:
            if u:
                urls.append(str(u).strip())
        if p.get("image"):
            urls.append(str(p["image"]).strip())

        if not urls:
            rows.append(
                {
                    "product_id": pid,
                    "product_name": name,
                    "original_url": "",
                    "actual_filename": "",
                    "issue_type": "no_image_reference",
                    "proposed_correction": "",
                    "status": "info",
                }
            )
            continue

        for url in urls:
            seen_urls[url].append(pid)
            full, basename, path_issue = extract_basename(url)
            if path_issue == "external_url":
                rows.append(
                    {
                        "product_id": pid,
                        "product_name": name,
                        "original_url": url,
                        "actual_filename": "",
                        "issue_type": "external_url",
                        "proposed_correction": "",
                        "status": "skipped",
                    }
                )
                continue
            if path_issue in ("path_outside_webp_dir", "unexpected_path"):
                rows.append(
                    {
                        "product_id": pid,
                        "product_name": name,
                        "original_url": url,
                        "actual_filename": "",
                        "issue_type": path_issue,
                        "proposed_correction": "",
                        "status": "manual_review",
                    }
                )
                continue

            corrected_base, issue, status = resolve_correction(basename, files)
            proposed = ""
            actual_fn = corrected_base or ""
            if status == "proposed_fix" and corrected_base:
                proposed = PREFIX + corrected_base
                actual_fn = corrected_base

            if basename in files["exact_set"] and status == "exact_match":
                actual_fn = basename

            rows.append(
                {
                    "product_id": pid,
                    "product_name": name,
                    "original_url": url,
                    "actual_filename": actual_fn,
                    "issue_type": issue if issue != "none" else "exact_match",
                    "proposed_correction": proposed,
                    "status": "fixed" if status == "proposed_fix" else status,
                }
            )

    for url, pids in seen_urls.items():
        if len(pids) > 1 and url:
            for row in rows:
                if row["original_url"] == url and row["issue_type"] == "exact_match":
                    row["issue_type"] = "duplicate_reference_across_products"
                    row["status"] = "info"

    return rows


def apply_fixes(products: list[dict], audit_rows: list[dict]) -> tuple[list[dict], int]:
    fix_map: dict[str, str] = {}
    for row in audit_rows:
        if row["status"] == "proposed_fix" or (
            row["status"] == "fixed" and row.get("proposed_correction")
        ):
            orig = row["original_url"]
            prop = row["proposed_correction"]
            if orig and prop and orig != prop:
                fix_map[orig] = prop

    # also handle status renamed to fixed after apply
    for row in audit_rows:
        if row["proposed_correction"] and row["original_url"] in fix_map:
            continue
        if row["proposed_correction"] and row["original_url"] != row["proposed_correction"]:
            if row["issue_type"] in ("case_mismatch", "extension_mismatch"):
                fix_map[row["original_url"]] = row["proposed_correction"]

    if not fix_map:
        return products, 0

    out = []
    fixed_count = 0
    for p in products:
        q = dict(p)
        if q.get("images"):
            new_imgs = []
            for u in q["images"]:
                nu = fix_map.get(u, u)
                if nu != u:
                    fixed_count += 1
                new_imgs.append(nu)
            q["images"] = new_imgs
        if q.get("image") and q["image"] in fix_map:
            q["image"] = fix_map[q["image"]]
            fixed_count += 1
        out.append(q)
    return out, fixed_count


def compare_non_image_fields(before: list[dict], after: list[dict]) -> list[str]:
    errors = []
    if len(before) != len(after):
        errors.append(f"product count changed {len(before)} -> {len(after)}")
        return errors
    skip = {"images", "image"}
    for a, b in zip(before, after, strict=True):
        if a.get("id") != b.get("id"):
            errors.append(f"id order mismatch at {a.get('id')} vs {b.get('id')}")
        for k, v in a.items():
            if k in skip:
                continue
            if b.get(k) != v:
                errors.append(f"{a['id']} field {k} changed")
    return errors


def summarize(rows: list[dict], fixed_refs: int, post_exact: int) -> str:
    total = len([r for r in rows if r["original_url"]])
    exact = sum(1 for r in rows if r["issue_type"] == "exact_match")
    case_mm = sum(1 for r in rows if r["issue_type"] == "case_mismatch")
    ext_mm = sum(1 for r in rows if r["issue_type"] == "extension_mismatch")
    missing = sum(1 for r in rows if r["issue_type"] == "missing_file")
    path_issues = sum(
        1
        for r in rows
        if r["issue_type"] in ("path_outside_webp_dir", "unexpected_path", "external_url")
    )
    unresolved = sum(
        1
        for r in rows
        if r["status"] in ("unresolved", "manual_review", "manual_review")
        or r["issue_type"] in ("ambiguous_case_collision", "extension_ambiguous")
    )
    no_img = sum(1 for r in rows if r["issue_type"] == "no_image_reference")

    return f"""Image case audit summary ({datetime.now(timezone.utc).isoformat()})

Total image URL references audited: {total}
Products with no image reference: {no_img}
Exact matches (case-sensitive): {exact}
Case mismatches (correctable): {case_mm}
Extension mismatches (correctable): {ext_mm}
Missing files (no matching basename): {missing}
Path / external URL issues: {path_issues}
Fixed references applied: {fixed_refs}
Unresolved / manual review: {unresolved}
Post-fix exact matches (re-audit): {post_exact}

Reports:
- {REPORTS / 'image_case_audit.csv'}
- {REPORTS / 'image_case_audit_summary.txt'}
"""


def main() -> None:
    REPORTS.mkdir(parents=True, exist_ok=True)
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup = REPORTS / f"products.js.backup.image_case.{ts}"
    shutil.copy2(PRODUCTS_JS, backup)

    files = scan_actual_files()
    before = load_products()
    before_json = json.dumps(before, ensure_ascii=False)

    rows = audit_products(before, files)
    products_fixed, fixed_count = apply_fixes(before, rows)

    # Mark applied fixes in rows
    for row in rows:
        if row["proposed_correction"] and row["original_url"] != row["proposed_correction"]:
            if row["issue_type"] in ("case_mismatch", "extension_mismatch"):
                row["status"] = "fixed"

    if fixed_count > 0:
        write_products_js(products_fixed)
        after = load_products()
    else:
        after = before

    integrity = compare_non_image_fields(before, after)
    if json.dumps(after, ensure_ascii=False) != before_json and not fixed_count:
        integrity.append("products changed without recorded image fixes")

    # Re-audit after fixes
    post_rows = audit_products(after, files)
    post_exact = sum(1 for r in post_rows if r["issue_type"] == "exact_match" and r["original_url"])

    fieldnames = [
        "product_id",
        "product_name",
        "original_url",
        "actual_filename",
        "issue_type",
        "proposed_correction",
        "status",
    ]
    with (REPORTS / "image_case_audit.csv").open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        w.writerows(rows)

    summary = summarize(rows, fixed_count, post_exact)
    summary += f"\nBackup: {backup}\n"
    summary += f"Non-image integrity: {'PASS' if not integrity else 'FAIL — ' + '; '.join(integrity[:10])}\n"
    (REPORTS / "image_case_audit_summary.txt").write_text(summary, encoding="utf-8")
    print(summary)


if __name__ == "__main__":
    main()
