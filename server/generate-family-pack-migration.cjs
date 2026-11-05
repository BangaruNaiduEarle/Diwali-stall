const fs = require("node:fs");

const source = "family-packs-dev-export.sql";
const output = "family-packs-data-only.sql";
const sql = fs.readFileSync(source, "utf8");

function getRows(table) {
  const re = new RegExp(
    '^INSERT INTO "' + table + '"\\s+VALUES\\(([\\s\\S]*?)\\);',
    "gm"
  );
  const rows = [];
  let match;

  while ((match = re.exec(sql)) !== null) {
    const fields = [];
    let field = "";
    let quoted = false;

    for (let i = 0; i < match[1].length; i++) {
      const ch = match[1][i];

      if (ch === "'") {
        field += ch;
        if (quoted && match[1][i + 1] === "'") {
          field += match[1][++i];
        } else {
          quoted = !quoted;
        }
      } else if (ch === "," && !quoted) {
        fields.push(field.trim());
        field = "";
      } else {
        field += ch;
      }
    }

    fields.push(field.trim());
    rows.push(fields);
  }

  return rows;
}

const packs = getRows("family_packs");
const items = getRows("family_pack_items");
const images = getRows("family_pack_images");

if (packs.length !== 6 || items.length !== 77 || images.length !== 8) {
  throw new Error(
    `Unexpected counts: packs=${packs.length}, items=${items.length}, images=${images.length}.`
  );
}

const statements = [];

for (const r of packs) {
  if (r.length !== 11) throw new Error("Invalid family pack row");
  statements.push(
    `INSERT INTO family_packs (id, slug, name, short_description, selling_price_paise, pack_label, sort_order, active, archived, created_at, updated_at) VALUES (${r.join(", ")});`
  );
}

for (const r of items) {
  if (r.length !== 6) throw new Error("Invalid family pack item row");
  statements.push(
    `INSERT INTO family_pack_items (family_pack_id, product_id, quantity, unit_label, sort_order) VALUES (${r.slice(1).join(", ")});`
  );
}

for (const r of images) {
  if (r.length !== 6) throw new Error("Invalid family pack image row");
  statements.push(
    `INSERT INTO family_pack_images (family_pack_id, sort_order, url, is_cover, created_at) VALUES (${r.slice(1).join(", ")});`
  );
}

fs.writeFileSync(output, statements.join("\n") + "\n", "utf8");
console.log(`Created ${output}`);
console.log(`Packs: ${packs.length}, items: ${items.length}, images: ${images.length}`);
