/**
 * Diagnostic: read headers from Master and Dashboard sheets,
 * show column positions and Dashboard formula column for "Email Status".
 */
require('dotenv').config();
const mongoose = require('mongoose');
const { google } = require('googleapis');
const Brand = require('../src/models/Brand');

const BRAND_SLUG = 'co-ventech';

async function main() {
  await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
  const brand = await Brand.findOne({ slug: BRAND_SLUG });
  if (!brand) { console.error('Brand not found'); process.exit(1); }

  const spreadsheetId = brand.googleSheets?.spreadsheetId;
  if (!spreadsheetId) { console.error('No spreadsheetId on brand'); process.exit(1); }

  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const auth = new google.auth.GoogleAuth({ credentials: creds, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  const sheets = google.sheets({ version: 'v4', auth });

  // 1. Read Master sheet headers
  console.log('\n=== MASTER SHEET HEADERS ===');
  const masterRes = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'Master!1:1' });
  const masterHeaders = (masterRes.data.values?.[0] || []);
  masterHeaders.forEach((h, i) => {
    const col = colToLetter(i);
    const flag = ['email_status', 'status', 'emailstatus', 'email status'].includes(h.toLowerCase().replace(/\s+/g, '_')) ? ' <-- STATUS COLUMN' : '';
    const emailFlag = ['email', 'email_address', 'work_email'].includes(h.toLowerCase().replace(/\s+/g, '_')) ? ' <-- EMAIL COLUMN' : '';
    if (flag || emailFlag || i < 5) {
      console.log(`  Col ${col} (index ${i}): "${h}"${flag}${emailFlag}`);
    }
  });
  console.log(`  Total columns: ${masterHeaders.length}`);

  // Find status column
  const statusIdx = masterHeaders.findIndex(h => {
    const norm = h.toLowerCase().replace(/\s+/g, '_');
    return ['email_status', 'status', 'emailstatus'].includes(norm);
  });
  if (statusIdx >= 0) {
    console.log(`\n  Email Status column: ${colToLetter(statusIdx)} (index ${statusIdx}, header="${masterHeaders[statusIdx]}")`);
    console.log(`  Dashboard COUNTIF should reference: Master!${colToLetter(statusIdx)}:${colToLetter(statusIdx)}`);
    console.log(`  Example formula for "Sent": =COUNTIF(Master!${colToLetter(statusIdx)}2:${colToLetter(statusIdx)}9999,"Sent")`);
  } else {
    console.log('\n  No Email Status column found in Master sheet!');
  }

  // 2. Try to read Dashboard sheet
  try {
    console.log('\n=== DASHBOARD SHEET (first 10 rows, cols A-D) ===');
    const dashRes = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'Dashboard!A1:D20' });
    const dashRows = dashRes.data.values || [];
    dashRows.forEach((row, i) => console.log(`  Row ${i+1}:`, row));
  } catch (e) {
    console.log('  No Dashboard sheet or cannot read it:', e.message);
  }

  // 3. Sample a few rows to see what statuses are there
  console.log('\n=== SAMPLE STATUS VALUES IN MASTER (rows 2-10) ===');
  if (statusIdx >= 0) {
    const sampleRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `Master!${colToLetter(statusIdx)}2:${colToLetter(statusIdx)}10`
    });
    const vals = sampleRes.data.values || [];
    vals.forEach((v, i) => console.log(`  Row ${i+2}: "${v[0] || '(empty)'}"`));
  }

  await mongoose.disconnect();
}

function colToLetter(index) {
  let letter = '';
  let n = index;
  while (n >= 0) {
    letter = String.fromCharCode((n % 26) + 65) + letter;
    n = Math.floor(n / 26) - 1;
  }
  return letter;
}

main().catch(e => { console.error(e); process.exit(1); });
