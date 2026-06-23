import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AuthScreen from './AuthScreen';
import { api } from './api';

jest.mock('./api', () => ({
  api: { login: jest.fn(), register: jest.fn() },
}));

const localStorageMock = (() => {
  let store = {};
  return {
    getItem:    jest.fn((key) => store[key] ?? null),
    setItem:    jest.fn((key, value) => { store[key] = String(value); }),
    removeItem: jest.fn((key) => { delete store[key]; }),
    clear:      jest.fn(() => { store = {}; }),
  };
})();
Object.defineProperty(window, 'localStorage', { value: localStorageMock });

beforeEach(() => {
  jest.clearAllMocks();
  localStorageMock.clear();
});

// The form has no <label> elements, so select inputs by type and submit via the
// Enter keydown handler (avoids the duplicate "Sign In" button vs. mode toggle).
function setup() {
  const onAuth = jest.fn();
  const { container } = render(<AuthScreen onAuth={onAuth} />);
  const email    = container.querySelector('input[type="email"]');
  const password = container.querySelector('input[type="password"]');
  return { onAuth, email, password };
}

test('renders the sign-in form by default', () => {
  setup();
  // In login mode "Create Account" is only the mode-toggle button.
  expect(screen.getByRole('button', { name: /create account/i })).toBeInTheDocument();
  expect(screen.getByPlaceholderText('you@example.com')).toBeInTheDocument();
});

test('logs in and calls onAuth on success', async () => {
  api.login.mockResolvedValueOnce({ token: 'tok123', user: { id: '1', email: 'a@b.com' } });
  const { onAuth, email, password } = setup();

  fireEvent.change(email,    { target: { value: 'a@b.com' } });
  fireEvent.change(password, { target: { value: 'secret123' } });
  fireEvent.keyDown(password, { key: 'Enter' });

  // onAuth fires last, after the awaited login promise resolves — wait on it.
  await waitFor(() => expect(onAuth).toHaveBeenCalledWith({ id: '1', email: 'a@b.com' }));
  expect(api.login).toHaveBeenCalledWith('a@b.com', 'secret123');
  expect(localStorageMock.setItem).toHaveBeenCalledWith('finance_token', 'tok123');
});

test('switches to register mode and registers a new account', async () => {
  api.register.mockResolvedValueOnce({ token: 'tok456', user: { id: '2' } });
  const { onAuth, email, password } = setup();

  fireEvent.click(screen.getByRole('button', { name: /create account/i }));
  fireEvent.change(email,    { target: { value: 'new@b.com' } });
  fireEvent.change(password, { target: { value: 'password1' } });
  fireEvent.keyDown(password, { key: 'Enter' });

  await waitFor(() => expect(onAuth).toHaveBeenCalled());
  expect(api.register).toHaveBeenCalledWith('new@b.com', 'password1');
  expect(api.login).not.toHaveBeenCalled();
});

test('shows the server error message when login fails', async () => {
  api.login.mockRejectedValueOnce(new Error('invalid credentials'));
  const { email, password } = setup();

  fireEvent.change(email,    { target: { value: 'a@b.com' } });
  fireEvent.change(password, { target: { value: 'wrongpass' } });
  fireEvent.keyDown(password, { key: 'Enter' });

  expect(await screen.findByText(/invalid credentials/i)).toBeInTheDocument();
});

test('guards against empty fields without calling the api', async () => {
  const { password } = setup();
  fireEvent.keyDown(password, { key: 'Enter' });

  expect(await screen.findByText(/email and password are required/i)).toBeInTheDocument();
  expect(api.login).not.toHaveBeenCalled();
});
