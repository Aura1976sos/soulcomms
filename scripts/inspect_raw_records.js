import XLSX from 'xlsx';
import path from 'path';
import fs from 'fs';

const filePath = path.resolve(process.cwd(), 'public', 'The Gathering on 100 - Enugu-event-report (2).xlsx');
if (!fs.existsSync(filePath)) { console.error('workbook not found', filePath); process.exit(1); }
const wb = XLSX.readFile(filePath);
const sheetName = wb.SheetNames.find(s => s.toLowerCase().includes('raw')) || wb.SheetNames[wb.SheetNames.length - 1];
console.log('Using sheet:', sheetName);
const sheet = wb.Sheets[sheetName];
const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
console.log('Row count:', rows.length);
for (let i = 0; i < Math.min(10, rows.length); i++) {
    console.log(i + 1, rows[i]);
}
