import fs from 'fs';
import path from 'path';

const inp = path.resolve(process.cwd(), 'public', 'enugu_participants_export.csv');
const out = path.resolve(process.cwd(), 'public', 'enugu_participants_export_plain.csv');
if (!fs.existsSync(inp)) {
    console.error('Input CSV not found:', inp);
    process.exit(1);
}
const rows = fs.readFileSync(inp, 'utf8').split(/\r?\n/).filter(Boolean);
if (rows.length === 0) {
    console.error('Input CSV empty');
    process.exit(1);
}
const header = rows[0].replace(/\"/g, '');
const outRows = rows.slice(1).map(l => l.replace(/\"/g, ''));
fs.writeFileSync(out, [header, ...outRows].join('\n'), 'utf8');
console.log('Wrote', out, 'rows:', outRows.length);
