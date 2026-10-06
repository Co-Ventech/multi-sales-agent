/**
 * sheetsBiSync.js — Bidirectional Google Sheets sync
 *
 * importFromSheet(brand)  → reads Sheet rows → returns leads array for importPhase
 * syncStatusToSheet(brand) → reads MongoDB contacts → updates Email Status column in Sheet
 */

const { google } = require('googleapis');

function getAuth() {
  const credsJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!credsJson) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON not configured');
  const creds = JSON.parse(credsJson);
  return new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });
}

/**
 * Read contacts from Google Sheet and return as lead objects for importPhase.
 * Reads the Master sheet (or worksheetName configured on brand).
 * Returns array of snake_case lead objects.
 */
async function importFromSheet(brand, logger) {
  if (!brand.googleSheets?.spreadsheetId) {
    throw new Error('Google Sheets not configured for this brand');
  }

  const auth = getAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const spreadsheetId = brand.googleSheets.spreadsheetId;
  const sheetName = brand.googleSheets.worksheetName || 'Master';

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!A:AZ`
  });

  const rows = res.data.values || [];
  if (rows.length < 2) {
    if (logger) logger.info('Google Sheet has no data rows');
    return [];
  }

  // First row is headers
  const headers = rows[0].map(h => String(h).trim().toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
  );

  // Column index helpers
  const col = (name) => headers.indexOf(name);
  const get = (row, name) => {
    const i = col(name);
    return i >= 0 ? (row[i] || '').trim() : '';
  };

  // Map common header variants to standard names
  const headerMap = {
    'first_name': ['first_name', 'firstname', 'first'],
    'last_name':  ['last_name', 'lastname', 'last'],
    'full_name':  ['full_name', 'fullname', 'name'],
    'email':      ['email', 'email_address', 'work_email'],
    'job_title':  ['job_title', 'jobtitle', 'title', 'position'],
    'company_name': ['company_name', 'company', 'organization', 'organization_name'],
    'industry':   ['industry', 'sector'],
    'country':    ['country', 'headquarters_country'],
    'linkedin_url': ['linkedin_url', 'linkedin', 'profile_url'],
    'headline':   ['headline', 'linkedin_headline'],
    'seniority_level': ['seniority_level', 'seniority'],
    'functional_level': ['functional_level', 'function'],
    'company_description': ['company_description', 'about', 'description'],
    'company_size': ['company_size', 'employees', 'employee_count', 'headcount'],
    'email_status': ['email_status', 'status', 'emailstatus']
  };

  function getField(row, fieldName) {
    const variants = headerMap[fieldName] || [fieldName];
    for (const v of variants) {
      const i = headers.indexOf(v);
      if (i >= 0) return (row[i] || '').trim();
    }
    return '';
  }

  const leads = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const email = getField(row, 'email');
    if (!email || !email.includes('@')) continue;

    // Skip rows already sent/replied/bounced in the sheet
    const status = getField(row, 'email_status').toLowerCase();
    if (['sent', 'replied', 'bounced'].includes(status)) continue;

    leads.push({
      email,
      first_name:    getField(row, 'first_name'),
      last_name:     getField(row, 'last_name'),
      full_name:     getField(row, 'full_name'),
      job_title:     getField(row, 'job_title'),
      company_name:  getField(row, 'company_name'),
      industry:      getField(row, 'industry'),
      country:       getField(row, 'country'),
      linkedin_url:  getField(row, 'linkedin_url'),
      headline:      getField(row, 'headline'),
      seniority_level: getField(row, 'seniority_level'),
      functional_level: getField(row, 'functional_level'),
      company_description: getField(row, 'company_description'),
      company_size:  getField(row, 'company_size'),
    });
  }

  if (logger) logger.info(`Google Sheet: found ${leads.length} importable contacts (skipped already sent/replied/bounced)`);
  return leads;
}

/**
 * Sync contact statuses from MongoDB back to Google Sheet.
 * Finds the Email Status column (or adds it) and updates each row whose
 * email matches a contact in MongoDB.
 */
async function syncStatusToSheet(brand, contacts, logger) {
  if (!brand.googleSheets?.spreadsheetId) {
    return { updated: 0, error: 'Google Sheets not configured' };
  }

  const auth = getAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const spreadsheetId = brand.googleSheets.spreadsheetId;
  const sheetName = brand.googleSheets.worksheetName || 'Master';

  // Read entire sheet (A:AZ covers up to 52 columns, handles sheets with Status column beyond Z)
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!A:AZ`
  });

  const rows = res.data.values || [];
  if (rows.length < 2) return { updated: 0 };

  const headers = rows[0].map(h => String(h).trim().toLowerCase().replace(/\s+/g, '_'));

  // Find or determine Email Status column
  // Prefer plain "status" column (used by Dashboard formulas), fallback to "email_status"
  const plainStatusCol = headers.findIndex(h => h === 'status');
  const emailStatusNameCol = headers.findIndex(h => h === 'email_status' || h === 'emailstatus');
  let emailStatusCol = plainStatusCol >= 0 ? plainStatusCol : emailStatusNameCol;
  let emailCol = headers.findIndex(h => h === 'email' || h === 'email_address' || h === 'work_email');

  if (emailCol < 0) {
    if (logger) logger.warn('syncStatusToSheet: no email column found in sheet');
    return { updated: 0, error: 'No email column found' };
  }

  // If no Email Status column, add it after the last header
  if (emailStatusCol < 0) {
    emailStatusCol = headers.length;
    // Write header for new column
    const colLetter = colToLetter(emailStatusCol);
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetName}!${colLetter}1`,
      valueInputOption: 'RAW',
      requestBody: { values: [['Email Status']] }
    });
    if (logger) logger.info(`Added "Email Status" column at column ${colLetter}`);
  }

  // Build email→status map from MongoDB contacts
  const statusMap = new Map();
  for (const c of contacts) {
    if (c.email) statusMap.set(c.email.toLowerCase(), c.status || 'Pending');
  }

  // Build batch update data
  const updates = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const email = (row[emailCol] || '').toLowerCase().trim();
    if (!email || !statusMap.has(email)) continue;

    const newStatus = statusMap.get(email);
    const existingStatus = (row[emailStatusCol] || '').toLowerCase();

    // Only update if status changed
    if (existingStatus !== newStatus.toLowerCase()) {
      const colLetter = colToLetter(emailStatusCol);
      updates.push({
        range: `${sheetName}!${colLetter}${i + 1}`,
        values: [[newStatus]]
      });
    }
  }

  if (!updates.length) {
    if (logger) logger.info('syncStatusToSheet: all statuses already up to date');
    return { updated: 0 };
  }

  // Batch update in chunks of 50
  const CHUNK = 50;
  let updated = 0;
  for (let i = 0; i < updates.length; i += CHUNK) {
    const chunk = updates.slice(i, i + CHUNK);
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        valueInputOption: 'RAW',
        data: chunk
      }
    });
    updated += chunk.length;
    if (updates.length > CHUNK) await new Promise(r => setTimeout(r, 500));
  }

  if (logger) logger.info(`syncStatusToSheet: updated ${updated} rows`);
  return { updated };
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

module.exports = { importFromSheet, syncStatusToSheet };
