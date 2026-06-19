import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import UserSettings from './UserSettings';
import { api } from './api';

jest.mock('./api', () => ({
  api: { changePassword: jest.fn() },
}));

beforeEach(() => {
  jest.clearAllMocks();
});

function renderSettings() {
  return render(<UserSettings />);
}

test('renders the change password form', () => {
  renderSettings();
  expect(screen.getByLabelText(/current password/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/^new password$/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/confirm new password/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /update password/i })).toBeInTheDocument();
});

test('shows error when passwords do not match', async () => {
  renderSettings();
  fireEvent.change(screen.getByLabelText(/current password/i),  { target: { value: 'currentpass' } });
  fireEvent.change(screen.getByLabelText(/^new password$/i),    { target: { value: 'newpassword1' } });
  fireEvent.change(screen.getByLabelText(/confirm new password/i), { target: { value: 'different123' } });
  fireEvent.click(screen.getByRole('button', { name: /update password/i }));

  expect(await screen.findByRole('alert')).toHaveTextContent(/do not match/i);
  expect(api.changePassword).not.toHaveBeenCalled();
});

test('shows error when new password is too short', async () => {
  renderSettings();
  fireEvent.change(screen.getByLabelText(/current password/i),  { target: { value: 'currentpass' } });
  fireEvent.change(screen.getByLabelText(/^new password$/i),    { target: { value: 'short' } });
  fireEvent.change(screen.getByLabelText(/confirm new password/i), { target: { value: 'short' } });
  fireEvent.click(screen.getByRole('button', { name: /update password/i }));

  expect(await screen.findByRole('alert')).toHaveTextContent(/at least 8 characters/i);
  expect(api.changePassword).not.toHaveBeenCalled();
});

test('calls api.changePassword and shows success on valid submission', async () => {
  api.changePassword.mockResolvedValueOnce({ message: 'password updated' });
  renderSettings();
  fireEvent.change(screen.getByLabelText(/current password/i),     { target: { value: 'currentpass' } });
  fireEvent.change(screen.getByLabelText(/^new password$/i),       { target: { value: 'newpassword1' } });
  fireEvent.change(screen.getByLabelText(/confirm new password/i), { target: { value: 'newpassword1' } });
  fireEvent.click(screen.getByRole('button', { name: /update password/i }));

  await waitFor(() => expect(api.changePassword).toHaveBeenCalledWith('currentpass', 'newpassword1'));
  expect(await screen.findByRole('status')).toHaveTextContent(/updated successfully/i);
});

test('shows API error message on failed submission', async () => {
  api.changePassword.mockRejectedValueOnce(new Error('current password is incorrect'));
  renderSettings();
  fireEvent.change(screen.getByLabelText(/current password/i),     { target: { value: 'wrongpass' } });
  fireEvent.change(screen.getByLabelText(/^new password$/i),       { target: { value: 'newpassword1' } });
  fireEvent.change(screen.getByLabelText(/confirm new password/i), { target: { value: 'newpassword1' } });
  fireEvent.click(screen.getByRole('button', { name: /update password/i }));

  expect(await screen.findByRole('alert')).toHaveTextContent(/current password is incorrect/i);
});
