'use strict';

const http = require('http');

jest.mock('twilio', () => ({ validateRequest: jest.fn() }));
jest.mock('../src/agentConfig', () => ({ findAgentByPhone: jest.fn().mockReturnValue(null) }));

const twilio = require('twilio');
const actualTwilio = jest.requireActual('twilio');
const { createApp } = require('../src/webhook');

const TEST_AUTH_TOKEN = 'test_auth_token_fixed';
const WRONG_AUTH_TOKEN = 'wrong_auth_token';

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

function postSignedSms(port, { params, signature, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const payload = new URLSearchParams(params).toString();
    const reqHeaders = {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(payload),
      ...headers,
    };
    if (signature !== undefined) {
      reqHeaders['X-Twilio-Signature'] = signature;
    }

    const req = http.request(
      {
        method: 'POST',
        host: '127.0.0.1',
        port,
        path: '/sms-incoming',
        headers: reqHeaders,
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
    app = createApp();
    server = await startServer(app);
    port = server.address().port;
  });

  afterEach(async () => {
    await stopServer(server);
    delete process.env.PUBLIC_APP_URL;
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

  describe('real signature validation (no environment bypass)', () => {
    let warnSpy;

    beforeEach(() => {
      // Delegate the mocked twilio.validateRequest to the real library
      // implementation, so these tests exercise actual HMAC validation
      // rather than a jest.fn() return value.
      twilio.validateRequest.mockImplementation(actualTwilio.validateRequest);
      process.env.TWILIO_AUTH_TOKEN = TEST_AUTH_TOKEN;
      process.env.PUBLIC_APP_URL = 'https://app.getklosed.ca';
      warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
      delete process.env.TWILIO_AUTH_TOKEN;
      warnSpy.mockRestore();
    });

    function sign(params) {
      return actualTwilio.getExpectedTwilioSignature(
        TEST_AUTH_TOKEN,
        'https://app.getklosed.ca/sms-incoming',
        params
      );
    }

    it('a correctly signed request is accepted', async () => {
      const params = { Body: 'hello', From: '+15550000000', MessageSid: 'SM-real-sig-1' };
      const res = await postSignedSms(port, { params, signature: sign(params) });

      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('<Response');
      expect(warnSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('webhook: signature validation failed')
      );
    });

    it('a correctly signed request is accepted even with a localhost Host header (the old escape hatch)', async () => {
      const params = { Body: 'hello', From: '+15550000000', MessageSid: 'SM-real-sig-2' };
      const res = await postSignedSms(port, {
        params,
        signature: sign(params),
        headers: { Host: 'localhost' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('<Response');
    });

    it('a correctly signed request is accepted even with an ngrok Host header (the old escape hatch)', async () => {
      const params = { Body: 'hello', From: '+15550000000', MessageSid: 'SM-real-sig-3' };
      const res = await postSignedSms(port, {
        params,
        signature: sign(params),
        headers: { Host: 'abc123.ngrok.io' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('<Response');
    });

    it('a request signed with the wrong auth token gets a 403 and logs the rejection', async () => {
      const params = { Body: 'hello', From: '+15550000000', MessageSid: 'SM-real-sig-4' };
      const wrongSignature = actualTwilio.getExpectedTwilioSignature(
        WRONG_AUTH_TOKEN,
        'https://app.getklosed.ca/sms-incoming',
        params
      );

      const res = await postSignedSms(port, { params, signature: wrongSignature });

      expect(res.statusCode).toBe(403);
      expect(res.body).toBe('Forbidden');
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('webhook: signature validation failed')
      );
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('from=+15550000000')
      );
    });

    it('a request with no signature header gets a 403 and logs the rejection', async () => {
      const params = { Body: 'hello', From: '+15550000000', MessageSid: 'SM-real-sig-5' };

      const res = await postSignedSms(port, { params });

      expect(res.statusCode).toBe(403);
      expect(res.body).toBe('Forbidden');
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('webhook: signature validation failed')
      );
    });
  });
});
