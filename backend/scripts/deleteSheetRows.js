/**
 * deleteSheetRows.js — Delete the first N data rows from Google Sheet tabs.
 * Usage: node scripts/deleteSheetRows.js [n]
 *   n - number of rows to delete from top (default: 55)
 * Deletes from both Master and Monthly_April_2026 sheets.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const { google } = require('googleapis');
const mongoose = require('mongoose');
const Brand = require('../src/models/Brand');

const N = parseInt(process.argv[2] || '55', 10);
const BRAND_SLUG = 'co-ventech';

async function getSheetId(sheets, spreadsheetId, sheetName) {
  const res = await sheets.spreadsheets.get({ spreadsheetId });
  const sheet = res.data.sheets.find(s => s.properties.title === sheetName);
  return sheet ? sheet.properties.sheetId : null;
}

async function deleteFirstNRows(sheets, spreadsheetId, sheetName, n) {
  const sheetId = await getSheetId(sheets, spreadsheetId, sheetName);
  if (sheetId === null) {
    console.log(`  Sheet "${sheetName}" not found — skipping`);
    return 0;
  }

  // Check how many rows exist
  const data = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!A:A`
  });
  const totalRows = (data.data.values || []).length;
  const dataRows = totalRows - 1; // minus header row

  if (dataRows <= 0) {
    console.log(`  Sheet "${sheetName}": no data rows — skipping`);
    return 0;
  }

  const rowsToDelete = Math.min(n, dataRows);
  console.log(`  Sheet "${sheetName}": ${dataRows} data rows, deleting first ${rowsToDelete}...`);

  // Delete rows 1 to rowsToDelete (0-indexed: startIndex=1, endIndex=1+rowsToDelete)
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{
        deleteDimension: {
          range: {
            sheetId,
            dimension: 'ROWS',
            startIndex: 1,          // row index 1 = first data row (after header)
            endIndex: 1 + rowsToDelete
          }
        }
      }]
    }
  });

  console.log(`  ✅ Deleted ${rowsToDelete} rows from "${sheetName}"`);
  return rowsToDelete;
}

async function main() {
  await mongoose.connect(process.env.MONGO_URI);

  const brand = await Brand.findOne({ slug: BRAND_SLUG });
  if (!brand) { console.error(`Brand not found: ${BRAND_SLUG}`); process.exit(1); }

  const spreadsheetId = brand.googleSheets?.spreadsheetId;
  if (!spreadsheetId) { console.error('No spreadsheetId on brand'); process.exit(1); }

  console.log(`Spreadsheet: ${spreadsheetId}`);
  console.log(`Deleting first ${N} data rows from each sheet...\n`);

  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });
  const sheets = google.sheets({ version: 'v4', auth });

  await deleteFirstNRows(sheets, spreadsheetId, 'Master', N);
  await deleteFirstNRows(sheets, spreadsheetId, 'Monthly_April_2026', N);

  console.log('\nDone.');
  await mongoose.disconnect();
}

main().catch(err => { console.error(err); process.exit(1); });
