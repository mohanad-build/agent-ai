require('dotenv').config();
const fs = require('fs');
const path = require('path');
const gmail = require('../src/gmail');

(async () => {
  const agentId = process.argv[2] || 'mo-test';
  const configPath = path.join(__dirname, '..', 'agents', `${agentId}.json`);
  const agentConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));

  const emails = await gmail.fetchUnreadInboxEmails(agentConfig);
  console.log(`Agent: ${agentId} (${agentConfig.gmailAddress})`);
  console.log(`Total unread fetched: ${emails.length}`);
  console.log('---');
  emails.forEach((e, i) => {
    console.log(`${i + 1}. From: ${e.from}`);
    console.log(`   Subject: ${e.subject}`);
    console.log(`   Labels: ${(e.labelIds || []).join(', ')}`);
    console.log('');
  });
})().catch(err => { console.error('ERR:', err.message); process.exit(1); });
