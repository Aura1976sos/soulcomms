import fs from "fs";
import path from "path";
import XLSX from "xlsx";

const filePath = path.resolve(process.cwd(), "public", "The Gathering on 100 - Enugu-event-report (2).xlsx");
if (!fs.existsSync(filePath)) {
    console.error("Excel file not found:", filePath);
    process.exit(1);
}

const workbook = XLSX.readFile(filePath);
const sheetnames = workbook.SheetNames.map(s => s.toLowerCase());

function pickSheet(names) {
    for (const n of names) {
        const found = workbook.SheetNames.find(s => s.toLowerCase().includes(n));
        if (found) return workbook.Sheets[found];
    }
    return workbook.Sheets[workbook.SheetNames[0]];
}

const participantsSheet = pickSheet(["raw records", "raw", "check-in log", "check-in", "registr", "attend"]);
const rows = XLSX.utils.sheet_to_json(participantsSheet, { header: 1 });

if (!rows || rows.length <= 1) {
    console.error("No participant rows found");
    process.exit(1);
}

const startCode = Number(process.argv[2] ?? process.env.START_CODE ?? 10001);
if (!Number.isInteger(startCode) || startCode < 1) {
    console.error("Invalid START_CODE. Pass a positive integer as argv or set START_CODE.");
    process.exit(1);
}

const header = rows[0].map(h => String(h || "").toLowerCase());
const nameIdx = header.findIndex(h => /(participant|name|full\s*name|fullname)/.test(h));
// Fallback: try columns that look like fullname or first/last
const fnameIdx = header.findIndex(h => /first/.test(h));
const lnameIdx = header.findIndex(h => /last/.test(h));
const phoneIdx = header.findIndex(h => /phone|tel|mobile|qr/.test(h));
const codeIdx = header.findIndex(h => /code|id/.test(h));

const dataRows = rows.slice(1);
const out = [];
let counter = startCode;
for (const r of dataRows) {
    let name = "";
    if (nameIdx >= 0) name = String(r[nameIdx] || "").trim();
    if (!name && fnameIdx >= 0) {
        name = `${String(r[fnameIdx] || "").trim()} ${String(r[lnameIdx] || "").trim()}`.trim();
    }
    if (!name) {
        if (r[0] && String(r[0]).trim()) {
            name = String(r[0]).trim();
        } else {
            name = String(r[codeIdx] || r[phoneIdx] || "").trim();
        }
    }
    if (!name) continue;
    const phone = phoneIdx >= 0 ? String(r[phoneIdx] || "").trim() : "";
    const code = String(counter).padStart(4, '0');
    out.push([code, name, phone]);
    counter++;
}

const outFileName = `enugu_participants_export_${String(startCode).padStart(4, '0')}.csv`;
const outPath = path.resolve(process.cwd(), "public", outFileName);
fs.writeFileSync(outPath, ["Code,Name,Phone", ...out.map(r => `${JSON.stringify(r[0])},${JSON.stringify(r[1])},${JSON.stringify(r[2])}`)].join("\n"), "utf8");
console.log(`Wrote CSV to: ${outPath} rows: ${out.length} starting code: ${startCode}`);
