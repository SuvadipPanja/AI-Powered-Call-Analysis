import { apiUrl, parseApiJson, parseReportResponse } from './apiHelpers';

jest.mock('./envConfig', () => ({
  __esModule: true,
  default: { apiBaseUrl: 'http://test-api.local' },
}));

describe('apiHelpers', () => {
  describe('apiUrl', () => {
    it('joins base URL with path', () => {
      expect(apiUrl('/api/health')).toBe('http://test-api.local/api/health');
      expect(apiUrl('api/health')).toBe('http://test-api.local/api/health');
    });
  });

  describe('parseApiJson', () => {
    it('throws on non-OK responses', async () => {
      const response = { ok: false, status: 500, headers: { get: () => 'application/json' } };
      await expect(parseApiJson(response, 'Health')).rejects.toThrow('Health: HTTP 500');
    });

    it('throws when response is not JSON', async () => {
      const response = { ok: true, status: 200, headers: { get: () => 'text/html' } };
      await expect(parseApiJson(response)).rejects.toThrow('response is not JSON');
    });

    it('returns parsed JSON on success', async () => {
      const response = {
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => ({ success: true }),
      };
      await expect(parseApiJson(response)).resolves.toEqual({ success: true });
    });
  });

  describe('parseReportResponse', () => {
    it('returns null on failure without throwing', async () => {
      const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const response = {
        ok: false,
        status: 404,
        text: async () => 'not found',
      };
      await expect(parseReportResponse(response, 'Report')).resolves.toBeNull();
      spy.mockRestore();
    });
  });
});
