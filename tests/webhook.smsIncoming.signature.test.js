'use strict';

const http = require('http');

jest.mock('twilio', () => ({ validateRequest: jest.fn() }));
jest.mock('../src/agentConfig', () => ({ findAgentByPhone: jest.fn().mockReturnValue(null) }));

const twilio = require('twilio');
const { createApp } = require('../src/webhook');

function startServer(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

function stopServer(server) {
  return new Promise((resolve) => server.close(resolve));
}

function postSms(port, { body = 'hello', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const payload = new URLSearchParams({
      Body: body,
      From: '+15550000000',
      MessageSid: 'SM' + Math.random().toString(36).slice(2),
    }).toString();

    const req = http.request(
      {
        method: 'POST',
        host: '127.0.0.1',
        port,
        path: '/sms-incoming',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(payload),
          'X-Twilio-Signature': 'sig-from-twilio',
          ...headers,
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
      }
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

describe('/sms-incoming signature validation URL', () => {
  let app;
  let server;
  let port;

  beforeEach(async () => {
    jest.clearAllMocks();
    delete process.env.PUBLIC_APP_URL;
    delete process.env.WEBHOOK_SKIP_SIGNATURE_CHECK;
    app = createApp();
    server = await startServer(app);
    port = server.address().port;
  });

  afterEach(async () => {
    await stopServer(server);
    delete process.env.PUBLIC_APP_URL;
    delete process.env.WEBHOOK_SKIP_SIGNATURE_CHECK;
  });

  it('PUBLIC_APP_URL set: validateRequest is called with PUBLIC_APP_URL + originalUrl regardless of req.protocol', async () => {
    process.env.PUBLIC_APP_URL = 'https://app.getklosed.ca';
    twilio.validateRequest.mockReturnValue(true);

    await postSms(port, { headers: { 'X-Forwarded-Proto': 'http', Host: 'app.getklosed.ca' } });

    expect(twilio.validateRequest).toHaveBeenCalledTimes(1);
    const urlArg = twilio.validateRequest.mock.calls[0][2];
    expect(urlArg).toBe('https://app.getklosed.ca/sms-incoming');
  });

  it('PUBLIC_APP_URL NOT set: validateRequest is called with the req-reconstructed url (unchanged legacy behavior)', async () => {
    twilio.validateRequest.mockReturnValue(true);

    await postSms(port, { headers: { Host: 'app.getklosed.ca' } });

    expect(twilio.validateRequest).toHaveBeenCalledTimes(1);
    const urlArg = twilio.validateRequest.mock.calls[0][2];
    expect(urlArg).toBe('http://app.getklosed.ca/sms-incoming');
  });

  it('a request that fails validation still returns 403', async () => {
    process.env.PUBLIC_APP_URL = 'https://app.getklosed.ca';
    twilio.validateRequest.mockReturnValue(false);

    const res = await postSms(port);

    expect(res.statusCode).toBe(403);
    expect(res.body).toBe('Forbidden');
  });

  it('a request that passes validation proceeds to the handler (200, TwiML)', async () => {
    process.env.PUBLIC_APP_URL = 'https://app.getklosed.ca';
    twilio.validateRequest.mockReturnValue(true);

    const res = await postSms(port);

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('<Response');
  });

  it('WEBHOOK_SKIP_SIGNATURE_CHECK + isLocalOrDev host still bypasses validation (unchanged)', async () => {
    process.env.PUBLIC_APP_URL = 'https://app.getklosed.ca';
    process.env.WEBHOOK_SKIP_SIGNATURE_CHECK = 'true';

    const res = await postSms(port, { headers: { Host: 'localhost' } });

    expect(twilio.validateRequest).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
  });
});
