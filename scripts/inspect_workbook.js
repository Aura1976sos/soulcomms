const XLSX = require('xlsx');
const path = 'public/The Gathering on 100 - Enugu-event-report (2).xlsx';
const wb = XLSX.readFile(path);
console.log('sheets', wb.SheetNames);
for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '', blankrows: false, raw: false });
    console.log('\nSHEET', name, 'rows', rows.length);
    if (rows.length) {
        console.log(JSON.stringify(rows.slice(0, 4), null, 2));
    }
}
