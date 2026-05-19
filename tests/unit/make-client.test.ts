import { describe, expect, it } from 'vitest';
import {
  type AdPlatformEnv,
  type MakeClientInput,
  makeAdPlatformClient,
} from '../../workers/publisher-agent/src/clients/make-client';

const baseEnv: AdPlatformEnv = {
  GOOGLE_ADS_BASE_URL: 'https://google-mock.example',
  GOOGLE_ADS_OAUTH_URL: 'https://oauth-mock.example',
  META_ADS_BASE_URL: 'https://meta-mock.example',
  GOOGLE_ADS_DEVELOPER_TOKEN: 'dev-token',
  GOOGLE_ADS_LOGIN_CUSTOMER_ID: '1111111111',
  GOOGLE_OAUTH_CLIENT_ID: 'cid',
  GOOGLE_OAUTH_CLIENT_SECRET: 'secret',
  META_API_VERSION: 'v21.0',
};

describe('makeAdPlatformClient', () => {
  it('returns a real client (never sim) for google_ads', () => {
    const input: MakeClientInput = {
      provider: 'google_ads',
      credentials: { refreshToken: 'rt', customerId: '1234567890' },
      env: baseEnv,
    };
    const client = makeAdPlatformClient(input);
    expect(client.runtime).toBe('real');
  });

  it('returns a real client for meta', () => {
    const input: MakeClientInput = {
      provider: 'meta',
      credentials: { accessToken: 'at', adAccountId: '9876543210' },
      env: baseEnv,
    };
    const client = makeAdPlatformClient(input);
    expect(client.runtime).toBe('real');
  });

  it('accepts empty credentials for mock-target deploys', () => {
    // Mock workers don't validate, so empty refresh/access tokens are
    // a legitimate sandbox configuration.
    const input: MakeClientInput = {
      provider: 'google_ads',
      credentials: {},
      env: baseEnv,
    };
    expect(() => makeAdPlatformClient(input)).not.toThrow();
  });

  it('defaults META_API_VERSION when omitted', () => {
    const env = { ...baseEnv };
    delete (env as Partial<AdPlatformEnv>).META_API_VERSION;
    const input: MakeClientInput = {
      provider: 'meta',
      credentials: { accessToken: 'at', adAccountId: '999' },
      env,
    };
    // Construction must succeed without explicit META_API_VERSION.
    const client = makeAdPlatformClient(input);
    expect(client.runtime).toBe('real');
  });
});
