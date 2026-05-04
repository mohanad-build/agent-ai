// scripts/setup-sheet.js
//
// One-time setup for an agent's Google Sheet.
// Writes the 19 column headers to row 1, freezes the row, bolds it,
// and auto-resizes columns. Run once per agent during onboarding.
//
// Usage: node scripts/setup-sheet.js <agentId>
// Example: node scripts/setup-sheet.js mo-test

require('dotenv').config();
const { google } = require('googleapis');
const { loadAgent } = require('../src/agentConfig');

const COLUMN_HEADERS = [
  'Lead ID',
  'Name',
  'Phone',
  'Source',
  'Date Added',
  'Original Message',
  'Status',
  'Follow Up Count',
  'Next Follow Up Day',
  'Last Follow Up Date',
  'Reserved',
  'Conversation History',
  'Pending Question',
  'Gmail Thread ID',
  'AI Enabled',
  'Last Action Timestamp',
  'Reminder Sent At',
  'Validation Status',
  'Operator Escalated At',
];

async function main() {
  const agentId = process.argv[2];
  if (!agentId) {
    console.error('Usage: node scripts/setup-sheet.js <agentId>');
    process.exit(1);
  }

  const agent = loadAgent(agentId);

  if (!agent.googleSheetId) {
    console.error(`Agent "${agentId}" has no googleSheetId set in their config.`);
    process.exit(1);
  }

  if (!agent.googleRefreshToken) {
    console.error(`Agent "${agentId}" has no googleRefreshToken. Run scripts/authorize.js first.`);
    process.exit(1);
  }

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  oauth2Client.setCredentials({ refresh_token: agent.googleRefreshToken });

  const sheets = google.sheets({ version: 'v4', auth: oauth2Client });

  console.log(`Setting up Sheet for agent: ${agent.agentId}`);
  console.log(`Sheet ID: ${agent.googleSheetId}`);

  const meta = await sheets.spreadsheets.get({
    spreadsheetId: agent.googleSheetId,
  });
  const firstSheet = meta.data.sheets[0];
  const internalSheetId = firstSheet.properties.sheetId;
  const tabName = firstSheet.properties.title;

  console.log(`Writing headers to tab: "${tabName}"`);

  await sheets.spreadsheets.values.update({
    spreadsheetId: agent.googleSheetId,
    range: `${tabName}!A1:S1`,
    valueInputOption: 'RAW',
    requestBody: {
      values: [COLUMN_HEADERS],
    },
  });

  console.log('Headers written.');

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: agent.googleSheetId,
    requestBody: {
      requests: [
        {
          updateSheetProperties: {
            properties: {
              sheetId: internalSheetId,
              gridProperties: { frozenRowCount: 1 },
            },
            fields: 'gridProperties.frozenRowCount',
          },
        },
        {
          repeatCell: {
            range: {
              sheetId: internalSheetId,
              startRowIndex: 0,
              endRowIndex: 1,
              startColumnIndex: 0,
              endColumnIndex: COLUMN_HEADERS.length,
            },
            cell: {
              userEnteredFormat: {
                textFormat: { bold: true },
              },
            },
            fields: 'userEnteredFormat.textFormat.bold',
          },
        },
        // Set fixed column widths so headers are always readable.
        // 180px comfortably fits the longest header ("Last Action Timestamp")
        // with padding, while keeping ~7 columns visible at once on a normal screen.
        // We use updateDimensionProperties (explicit width) instead of
        // autoResizeDimensions because auto-resize was unreliable immediately
        // after writing header values.
        {
          updateDimensionProperties: {
            range: {
              sheetId: internalSheetId,
              dimension: 'COLUMNS',
              startIndex: 0,
              endIndex: COLUMN_HEADERS.length,
            },
            properties: {
              pixelSize: 180,
            },
            fields: 'pixelSize',
          },
        },
      ],
    },
  });

  console.log('Formatting applied (frozen header, bold, fixed column widths).');
  console.log('');
  console.log('Done. View your Sheet at:');
  console.log(`  https://docs.google.com/spreadsheets/d/${agent.googleSheetId}/edit`);
}

main().catch((err) => {
  console.error('Setup failed:');
  console.error(err.message);
  if (err.response?.data?.error) {
    console.error('API error details:', JSON.stringify(err.response.data.error, null, 2));
  }
  process.exit(1);
});
