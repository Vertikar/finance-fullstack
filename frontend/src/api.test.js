import { api } from './api';

const mockFetch = jest.fn();
global.fetch = mockFetch;

const localStorageMock = (() => {
  let store = {};
  return {
    getItem:    jest.fn((key)        => store[key] ?? null),
    setItem:    jest.fn((key, value) => { store[key] = String(value); }),
    removeItem: jest.fn((key)        => { delete store[key]; }),
    clear:      jest.fn(()           => { store = {}; }),
  };
})();
Object.defineProperty(window, 'localStorage', { value: localStorageMock });

const jsonResponse = (data, status = 200) =>
  Promise.resolve({
    ok:     status >= 200 && status < 300,
    status,
    json:   () => Promise.resolve(data),
  });

beforeEach(() => {
  jest.clearAllMocks();
  localStorageMock.clear();
});

describe('api.login', () => {
  test('sends POST to /api/auth/login with credentials', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ token: 'tok123', user: { id: '1' } }));
    const result = await api.login('user@example.com', 'secret');
    expect(mockFetch).toHaveBeenCalledWith('/api/auth/login', expect.objectContaining({ method: 'POST' }));
    expect(result.token).toBe('tok123');
  });

  test('throws on non-ok response', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ error: 'invalid credentials' }, 401));
    await expect(api.login('bad@example.com', 'wrong')).rejects.toThrow('invalid credentials');
  });
});

describe('api.register', () => {
  test('sends POST to /api/auth/register', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ token: 'tok456', user: { id: '2' } }, 201));
    const result = await api.register('new@example.com', 'password123');
    expect(mockFetch).toHaveBeenCalledWith('/api/auth/register', expect.objectContaining({ method: 'POST' }));
    expect(result.token).toBe('tok456');
  });
});

describe('api.getEntries', () => {
  // GET requests don't set a method in the options object — test the URL instead
  test('calls the /api/entries endpoint', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse([]));
    await api.getEntries();
    expect(mockFetch).toHaveBeenCalledWith('/api/entries', expect.any(Object));
  });

  test('does not send a POST method for GET requests', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse([]));
    await api.getEntries();
    const [, opts] = mockFetch.mock.calls[0];
    // GET requests leave method unset (undefined), never 'POST'/'PUT'/'DELETE'
    expect(opts.method).not.toBe('POST');
    expect(opts.method).not.toBe('PUT');
    expect(opts.method).not.toBe('DELETE');
  });

  test('includes Authorization header when token is stored', async () => {
    localStorageMock.getItem.mockReturnValueOnce('my-token');
    mockFetch.mockReturnValueOnce(jsonResponse([]));
    await api.getEntries();
    const [, opts] = mockFetch.mock.calls[0];
    expect(opts.headers['Authorization']).toBe('Bearer my-token');
  });

  test('omits Authorization header when no token stored', async () => {
    localStorageMock.getItem.mockReturnValueOnce(null);
    mockFetch.mockReturnValueOnce(jsonResponse([]));
    await api.getEntries();
    const [, opts] = mockFetch.mock.calls[0];
    expect(opts.headers['Authorization']).toBeUndefined();
  });

  test('returns parsed entry array', async () => {
    const entries = [{ id: '1', name: 'Rent', amount: 1800 }];
    mockFetch.mockReturnValueOnce(jsonResponse(entries));
    expect(await api.getEntries()).toEqual(entries);
  });
});

describe('api.createEntry', () => {
  test('sends POST with entry body', async () => {
    const entry = { name: 'Netflix', amount: 18, type: 'expense' };
    mockFetch.mockReturnValueOnce(jsonResponse({ ...entry, id: 'new1' }, 201));
    const result = await api.createEntry(entry);
    expect(mockFetch).toHaveBeenCalledWith('/api/entries', expect.objectContaining({
      method: 'POST',
      body:   JSON.stringify(entry),
    }));
    expect(result.id).toBe('new1');
  });
});

describe('api.updateEntry', () => {
  test('sends PUT to /api/entries/:id', async () => {
    const entry = { name: 'Rent Updated', amount: 2000 };
    mockFetch.mockReturnValueOnce(jsonResponse({ ...entry, id: 'abc' }));
    await api.updateEntry('abc', entry);
    expect(mockFetch).toHaveBeenCalledWith('/api/entries/abc', expect.objectContaining({ method: 'PUT' }));
  });
});

describe('api.deleteEntry', () => {
  test('sends DELETE to /api/entries/:id and returns null', async () => {
    mockFetch.mockReturnValueOnce(
      Promise.resolve({ ok: true, status: 204, json: () => Promise.resolve(null) })
    );
    const result = await api.deleteEntry('abc');
    expect(mockFetch).toHaveBeenCalledWith('/api/entries/abc', expect.objectContaining({ method: 'DELETE' }));
    expect(result).toBeNull();
  });
});
