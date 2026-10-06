/**
 * sheetsSync.js — Google Sheets integration (placeholder)
 * Syncs contacts/results to a Google Spreadsheet.
 */

const { google } = require('googleapis');

async function syncToSheet(brand, contacts) {
  if (!brand.googleSheets?.enabled || !brand.googleSheets?.spreadsheetId) {
    return { synced: 0, error: 'Google Sheets not configured' };
  }

  // Google Sheets auth requires service account credentials in env
  const credsJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!credsJson) {
    return { synced: 0, error: 'GOOGLE_SERVICE_ACCOUNT_JSON not configured' };
  }

  try {
    const creds = JSON.parse(credsJson);
    const auth = new google.auth.GoogleAuth({
      credentials: creds,
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });

    const sheets = google.sheets({ version: 'v4', auth });
    const spreadsheetId = brand.googleSheets.spreadsheetId;
    const worksheetName = brand.googleSheets.worksheetName || 'Master';

    const headers = [
      'Email', 'First Name', 'Last Name', 'Company', 'Job Title',
      'Industry', 'Country', 'Status', 'A/B Variant', 'Lead Score',
      'Date Sent', 'Date Replied', 'Date Bounced', 'Sent From', 'Notes'
    ];

    const rows = contacts.map(c => [
      c.email || '',
      c.firstName || '',
      c.lastName || '',
      c.companyName || '',
      c.jobTitle || '',
      c.industry || '',
      c.country || '',
      c.status || '',
      c.abVariant || '',
      c.leadScore || '',
      c.dateSent ? new Date(c.dateSent).toISOString() : '',
      c.dateReplied ? new Date(c.dateReplied).toISOString() : '',
      c.dateBounced ? new Date(c.dateBounced).toISOString() : '',
      c.sentFrom || '',
      c.notes || ''
    ]);

    // Check if sheet exists, if not create it
    const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
    const sheetExists = spreadsheet.data.sheets?.some(
      s => s.properties?.title === worksheetName
    );

    if (!sheetExists) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [{
            addSheet: { properties: { title: worksheetName } }
          }]
        }
      });
      // Write headers
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${worksheetName}!A1`,
        valueInputOption: 'RAW',
        requestBody: { values: [headers] }
      });
    }

    // Append rows
    if (rows.length > 0) {
      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: `${worksheetName}!A1`,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: rows }
      });
    }

    return { synced: rows.length, error: null };
  } catch (err) {
    return { synced: 0, error: err.message };
  }
}

module.exports = { syncToSheet };
