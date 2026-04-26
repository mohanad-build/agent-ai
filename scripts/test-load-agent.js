const { loadAgent } = require('../src/agentConfig');

const agent = loadAgent('mo-test');

console.log('agentName:        ', agent.agentName);
console.log('brokerage:        ', agent.brokerage);
console.log('gmailAddress:     ', agent.gmailAddress);
console.log('refreshToken:     ', agent.googleRefreshToken ? 'yes' : 'no');
console.log('✅ agentConfig.loadAgent works');
