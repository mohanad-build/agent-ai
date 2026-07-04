'use strict';

const { filterDashboardIds, NON_DASHBOARD_IDS } = require('../src/routes/dashboard');

describe('filterDashboardIds', () => {
  it('excludes welcome-sender from a mixed list', () => {
    expect(filterDashboardIds(['assistant', 'mo-test', 'welcome-sender'])).toEqual(['assistant', 'mo-test']);
  });

  it('returns empty array when only welcome-sender is present', () => {
    expect(filterDashboardIds(['welcome-sender'])).toEqual([]);
  });

  it('is a no-op when nothing needs excluding', () => {
    expect(filterDashboardIds(['assistant', 'mo-test'])).toEqual(['assistant', 'mo-test']);
  });
});

describe('NON_DASHBOARD_IDS', () => {
  it('contains welcome-sender', () => {
    expect(NON_DASHBOARD_IDS.has('welcome-sender')).toBe(true);
  });
});
