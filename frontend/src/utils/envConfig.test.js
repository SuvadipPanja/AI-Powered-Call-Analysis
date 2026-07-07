describe('envConfig runtime resolution', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('uses REACT_APP_API_BASE_URL when set', async () => {
    process.env.REACT_APP_API_BASE_URL = 'http://api.example.com/';
    const config = (await import('./envConfig')).default;
    expect(config.apiBaseUrl).toBe('http://api.example.com');
  });

  it('falls back to window.location.origin when API env is empty', async () => {
    delete process.env.REACT_APP_API_BASE_URL;
    const config = (await import('./envConfig')).default;
    expect(config.apiBaseUrl).toBe(window.location.origin);
  });

  it('uses REACT_APP_WS_URL when set', async () => {
    process.env.REACT_APP_WS_URL = 'ws://ws.example.com/';
    const config = (await import('./envConfig')).default;
    expect(config.wsUrl).toBe('ws://ws.example.com');
  });

  it('falls back to hostname:8080 for websocket when WS env is empty', async () => {
    delete process.env.REACT_APP_WS_URL;
    const config = (await import('./envConfig')).default;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    expect(config.wsUrl).toBe(`${protocol}//${window.location.hostname}:8080`);
  });
});
