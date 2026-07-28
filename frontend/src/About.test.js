import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import About, { formatBuildTime } from './About';

const mockFetch = jest.fn();
global.fetch = mockFetch;

const jsonResponse = (data, status = 200) =>
  Promise.resolve({
    ok:     status >= 200 && status < 300,
    status,
    json:   () => Promise.resolve(data),
  });

const API_BUILD = {
  version:    'v1.2.3',
  commit:     'f280cb6',
  build_time: '2026-07-27T02:14:09Z',
  go_version: 'go1.22.5',
};

// About reads process.env.REACT_APP_* through getWebBuildInfo() at render time,
// so stubbing the env before render is enough — no module reloading, which would
// hand the component a second React instance and break hooks.
function stubWebBuild({ version = 'v1.2.3', commit = 'f280cb6', buildTime = '2026-07-27T02:14:09Z' } = {}) {
  process.env.REACT_APP_VERSION    = version;
  process.env.REACT_APP_COMMIT     = commit;
  process.env.REACT_APP_BUILD_TIME = buildTime;
  return About;
}

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

beforeEach(() => {
  jest.clearAllMocks();
});

// ── Frontend build info ─────────────────────────────────────────────────────
describe('About — frontend build info', () => {
  test('renders the version and commit inlined at build time', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse(API_BUILD));
    const About = stubWebBuild({ version: 'v9.9.9', commit: 'abc1234' });

    render(<About T={undefined} onClose={jest.fn()} />);

    expect(screen.getByText('v9.9.9')).toBeInTheDocument();
    expect(screen.getByText('abc1234')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('go1.22.5')).toBeInTheDocument());
  });

  test('falls back to dev/unknown when the env vars are absent', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse(API_BUILD));
    const About = stubWebBuild({ version: '', commit: '', buildTime: '' });

    render(<About onClose={jest.fn()} />);

    expect(screen.getByText('dev')).toBeInTheDocument();
    expect(screen.getByText('unknown')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('go1.22.5')).toBeInTheDocument());
  });
});

// ── API build info ──────────────────────────────────────────────────────────
describe('About — API build info', () => {
  test('renders the API version once the fetch resolves', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ ...API_BUILD, version: 'v1.5.0' }));
    const About = stubWebBuild({ version: 'v1.5.0', commit: 'f280cb6' });

    render(<About onClose={jest.fn()} />);

    await waitFor(() => expect(screen.getByText('go1.22.5')).toBeInTheDocument());
    // Both groups now read v1.5.0 — one from process.env, one from the response.
    expect(screen.getAllByText('v1.5.0')).toHaveLength(2);
  });

  test('calls GET /api/version on mount', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse(API_BUILD));
    const About = stubWebBuild();

    render(<About onClose={jest.fn()} />);

    await waitFor(() => expect(mockFetch).toHaveBeenCalledWith('/api/version', expect.any(Object)));
    await waitFor(() => expect(screen.getByText('go1.22.5')).toBeInTheDocument());
  });

  // The case that matters most: one failed fetch must not blank the dialog.
  test('a failed fetch still renders the frontend block and marks the API unavailable', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ error: 'boom' }, 500));
    const About = stubWebBuild({ version: 'v9.9.9', commit: 'abc1234' });

    render(<About onClose={jest.fn()} />);

    await waitFor(() => expect(screen.getAllByText('unavailable').length).toBeGreaterThan(0));
    expect(screen.getByText('v9.9.9')).toBeInTheDocument();
    expect(screen.getByText('abc1234')).toBeInTheDocument();
  });

  test('a rejected fetch is handled the same way', async () => {
    mockFetch.mockRejectedValueOnce(new Error('network down'));
    const About = stubWebBuild({ version: 'v9.9.9', commit: 'abc1234' });

    render(<About onClose={jest.fn()} />);

    await waitFor(() => expect(screen.getAllByText('unavailable').length).toBeGreaterThan(0));
    expect(screen.getByText('v9.9.9')).toBeInTheDocument();
  });
});

// ── Mismatch hint ───────────────────────────────────────────────────────────
describe('About — build mismatch hint', () => {
  test('appears when the web and API commits differ', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ ...API_BUILD, commit: 'deadbee' }));
    const About = stubWebBuild({ commit: 'abc1234' });

    render(<About onClose={jest.fn()} />);

    await waitFor(() =>
      expect(screen.getByText(/different builds/i)).toBeInTheDocument()
    );
  });

  test('is absent when the commits match', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ ...API_BUILD, commit: 'abc1234' }));
    const About = stubWebBuild({ commit: 'abc1234' });

    render(<About onClose={jest.fn()} />);

    await waitFor(() => expect(screen.getByText('go1.22.5')).toBeInTheDocument());
    expect(screen.queryByText(/different builds/i)).not.toBeInTheDocument();
  });

  // Two unlabelled builds are not evidence of a mismatch.
  test('is absent when either commit is unidentified', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ ...API_BUILD, commit: 'unknown' }));
    const About = stubWebBuild({ commit: 'abc1234' });

    render(<About onClose={jest.fn()} />);

    await waitFor(() => expect(screen.getByText('go1.22.5')).toBeInTheDocument());
    expect(screen.queryByText(/different builds/i)).not.toBeInTheDocument();
  });

  test('is absent while the API fetch is still in flight', () => {
    mockFetch.mockReturnValueOnce(new Promise(() => {}));  // never settles
    const About = stubWebBuild({ commit: 'abc1234' });

    render(<About onClose={jest.fn()} />);

    expect(screen.queryByText(/different builds/i)).not.toBeInTheDocument();
  });
});

// ── Dismissal ───────────────────────────────────────────────────────────────
describe('About — dismissal', () => {
  test('Escape calls onClose', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse(API_BUILD));
    const About = stubWebBuild();
    const onClose = jest.fn();

    render(<About onClose={onClose} />);
    fireEvent.keyDown(window, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByText('go1.22.5')).toBeInTheDocument());
  });

  test('a key other than Escape does not close it', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse(API_BUILD));
    const About = stubWebBuild();
    const onClose = jest.fn();

    render(<About onClose={onClose} />);
    fireEvent.keyDown(window, { key: 'Enter' });

    expect(onClose).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByText('go1.22.5')).toBeInTheDocument());
  });

  test('a backdrop click calls onClose', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse(API_BUILD));
    const About = stubWebBuild();
    const onClose = jest.fn();

    render(<About onClose={onClose} />);
    fireEvent.click(screen.getByTestId('about-overlay'));

    expect(onClose).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByText('go1.22.5')).toBeInTheDocument());
  });

  test('a click inside the card does not close it', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse(API_BUILD));
    const About = stubWebBuild();
    const onClose = jest.fn();

    render(<About onClose={onClose} />);
    fireEvent.click(screen.getByRole('dialog'));

    expect(onClose).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByText('go1.22.5')).toBeInTheDocument());
  });

  test('the Close button calls onClose', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse(API_BUILD));
    const About = stubWebBuild();
    const onClose = jest.fn();

    render(<About onClose={onClose} />);
    fireEvent.click(screen.getByText('Close'));

    expect(onClose).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByText('go1.22.5')).toBeInTheDocument());
  });
});

// ── Copy button ─────────────────────────────────────────────────────────────
//
// The button must be present regardless of clipboard support. navigator.clipboard
// only exists in a secure context, so on a plain-HTTP LAN address — how the app
// is normally opened on a phone — it is undefined and the legacy path is the
// only one that works.
describe('About — copy button', () => {
  afterEach(() => {
    delete navigator.clipboard;
    delete document.execCommand;
  });

  const assertFullReport = (block) => {
    expect(block).toContain('v9.9.9');      // frontend version
    expect(block).toContain('abc1234');     // frontend commit
    expect(block).toContain('v1.2.3');      // API version
    expect(block).toContain('f280cb6');     // API commit
    expect(block).toContain('go1.22.5');    // API Go version
  };

  async function renderLoaded() {
    mockFetch.mockReturnValueOnce(jsonResponse(API_BUILD));
    const About = stubWebBuild({ version: 'v9.9.9', commit: 'abc1234' });
    render(<About onClose={jest.fn()} />);
    await waitFor(() => expect(screen.getByText('go1.22.5')).toBeInTheDocument());
  }

  test('is rendered even when navigator.clipboard is unavailable', async () => {
    await renderLoaded();
    expect(screen.getByText('Copy')).toBeInTheDocument();
  });

  test('copies all build fields via navigator.clipboard when available', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText }, configurable: true,
    });

    await renderLoaded();
    fireEvent.click(screen.getByText('Copy'));

    // Await the confirmation so the state update that follows the clipboard
    // promise lands inside act() rather than after the test finishes.
    await waitFor(() => expect(screen.getByText('Copied')).toBeInTheDocument());

    expect(writeText).toHaveBeenCalledTimes(1);
    assertFullReport(writeText.mock.calls[0][0]);
  });

  // The plain-HTTP case the user hit: no navigator.clipboard at all.
  test('falls back to execCommand when navigator.clipboard is absent', async () => {
    let copied = '';
    document.execCommand = jest.fn(() => {
      copied = document.activeElement.value;
      return true;
    });

    await renderLoaded();
    fireEvent.click(screen.getByText('Copy'));

    await waitFor(() => expect(screen.getByText('Copied')).toBeInTheDocument());
    expect(document.execCommand).toHaveBeenCalledWith('copy');
    assertFullReport(copied);
  });

  test('falls back to execCommand when clipboard.writeText rejects', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: jest.fn().mockRejectedValue(new Error('denied')) },
      configurable: true,
    });
    document.execCommand = jest.fn(() => true);

    await renderLoaded();
    fireEvent.click(screen.getByText('Copy'));

    await waitFor(() => expect(screen.getByText('Copied')).toBeInTheDocument());
    expect(document.execCommand).toHaveBeenCalledWith('copy');
  });

  // Last resort — show the text so it can be selected by hand.
  test('reveals a selectable textarea when every copy path fails', async () => {
    document.execCommand = jest.fn(() => false);

    await renderLoaded();
    expect(screen.queryByLabelText('Build info for copying')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Copy'));

    const box = await screen.findByLabelText('Build info for copying');
    assertFullReport(box.value);
    expect(box).toHaveAttribute('readonly');
    expect(screen.getByText(/select the text above/i)).toBeInTheDocument();
  });

  test('does not claim success when the copy failed', async () => {
    document.execCommand = jest.fn(() => false);

    await renderLoaded();
    fireEvent.click(screen.getByText('Copy'));

    await screen.findByLabelText('Build info for copying');
    expect(screen.queryByText('Copied')).not.toBeInTheDocument();
  });
});

// ── formatBuildTime ─────────────────────────────────────────────────────────
describe('formatBuildTime', () => {
  test('renders an em dash for an empty value', () => {
    expect(formatBuildTime('')).toBe('—');
  });

  test('passes an unparseable value through unchanged', () => {
    expect(formatBuildTime('not-a-date')).toBe('not-a-date');
  });

  test('formats a valid ISO timestamp', () => {
    const out = formatBuildTime('2026-07-27T02:14:09Z');
    expect(out).not.toBe('2026-07-27T02:14:09Z');
    expect(out).toMatch(/2026/);
  });
});
