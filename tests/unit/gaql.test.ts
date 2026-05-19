import { describe, expect, it } from 'vitest';
import { parseGaql } from '../../workers/google-ads-mock/src/gaql';

describe('parseGaql — budget lookup', () => {
  it('parses the canonical budget query', () => {
    const result = parseGaql(
      'SELECT campaign.campaign_budget FROM campaign WHERE campaign.id = 2001',
    );
    expect(result).toEqual({ kind: 'budget', campaignId: '2001' });
  });

  it('tolerates whitespace + newlines', () => {
    const result = parseGaql(`
      SELECT  campaign.campaign_budget
      FROM    campaign
      WHERE   campaign.id  =  9876543210
    `);
    expect(result).toEqual({ kind: 'budget', campaignId: '9876543210' });
  });

  it('is case-insensitive on keywords', () => {
    const result = parseGaql(
      'select campaign.campaign_budget from campaign where campaign.id = 42',
    );
    expect(result).toEqual({ kind: 'budget', campaignId: '42' });
  });
});

describe('parseGaql — metrics fetch', () => {
  it('parses the canonical metrics query', () => {
    const result = parseGaql(
      `SELECT metrics.impressions, metrics.clicks, metrics.conversions, metrics.cost_micros
       FROM ad_group_ad
       WHERE ad_group_ad.ad.id = 5001
         AND segments.date BETWEEN '2026-05-17' AND '2026-05-19'`,
    );
    expect(result).toEqual({
      kind: 'metrics',
      adId: '5001',
      dateFrom: '2026-05-17',
      dateTo: '2026-05-19',
    });
  });

  it('returns the ad id only — no adGroupId prefix', () => {
    // The real client splits `<agId>~<adId>` before issuing the query, so the
    // parser should always see a plain numeric.
    const result = parseGaql(
      `SELECT metrics.impressions FROM ad_group_ad
       WHERE ad_group_ad.ad.id = 12345
         AND segments.date BETWEEN '2026-05-01' AND '2026-05-02'`,
    );
    expect(result).toMatchObject({ kind: 'metrics', adId: '12345' });
  });
});

describe('parseGaql — unsupported', () => {
  it('refuses an unknown query', () => {
    expect(parseGaql('SELECT * FROM customer')).toEqual({ kind: 'unsupported' });
  });

  it('refuses metrics query without date range', () => {
    expect(
      parseGaql('SELECT metrics.impressions FROM ad_group_ad WHERE ad_group_ad.ad.id = 1'),
    ).toEqual({ kind: 'unsupported' });
  });

  it('refuses budget query with non-numeric id', () => {
    expect(
      parseGaql("SELECT campaign.campaign_budget FROM campaign WHERE campaign.id = 'abc'"),
    ).toEqual({ kind: 'unsupported' });
  });

  it('refuses empty input', () => {
    expect(parseGaql('')).toEqual({ kind: 'unsupported' });
  });
});
