import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import Budget from './Budget';
import { api } from './api';

jest.mock('./api', () => ({
  api: {
    getBudgets:   jest.fn(),
    createBudget: jest.fn(),
    updateBudget: jest.fn(),
    deleteBudget: jest.fn(),
  },
}));

beforeEach(() => {
  jest.clearAllMocks();
});

const entries = [
  { id: 'i1', type: 'income',  amount: 5000, frequency: 'monthly', category: 'Salary',  nextDue: '2026-06-01' },
  { id: 'e1', type: 'expense', amount: 2000, frequency: 'monthly', category: 'Housing', nextDue: '2026-06-01' },
];

function renderBudget(props = {}) {
  return render(
    <Budget
      entries={entries}
      budgets={props.budgets ?? []}
      setBudgets={props.setBudgets ?? jest.fn()}
      setApiError={props.setApiError ?? jest.fn()}
    />
  );
}

test('renders a row per expense category and the leftover figure', () => {
  renderBudget({ budgets: [{ id: 'b1', category: 'Food & Groceries', amount: 600 }] });

  expect(screen.getByText(/leftover \/ month/i)).toBeInTheDocument();
  // 5000 income − 2000 fixed − 600 budget = 2400 leftover
  expect(screen.getByText(/\+\$2,400/)).toBeInTheDocument();
  // Existing budget pre-fills its input
  expect(screen.getByLabelText(/Food & Groceries monthly budget/i)).toHaveValue(600);
});

test('creating an allowance for a new category calls createBudget', async () => {
  api.createBudget.mockResolvedValueOnce({ id: 'b2', category: 'Transport', amount: 250 });
  const setBudgets = jest.fn();
  renderBudget({ budgets: [], setBudgets });

  const input = screen.getByLabelText(/Transport monthly budget/i);
  fireEvent.change(input, { target: { value: '250' } });
  fireEvent.blur(input);

  await waitFor(() =>
    expect(api.createBudget).toHaveBeenCalledWith({ category: 'Transport', amount: 250 })
  );
});

test('editing an existing allowance calls updateBudget', async () => {
  api.updateBudget.mockResolvedValueOnce({ id: 'b1', category: 'Food & Groceries', amount: 750 });
  renderBudget({ budgets: [{ id: 'b1', category: 'Food & Groceries', amount: 600 }] });

  const input = screen.getByLabelText(/Food & Groceries monthly budget/i);
  fireEvent.change(input, { target: { value: '750' } });
  fireEvent.blur(input);

  await waitFor(() =>
    expect(api.updateBudget).toHaveBeenCalledWith('b1', { amount: 750 })
  );
  expect(api.createBudget).not.toHaveBeenCalled();
});

test('clearing an existing allowance calls deleteBudget', async () => {
  api.deleteBudget.mockResolvedValueOnce(null);
  renderBudget({ budgets: [{ id: 'b1', category: 'Food & Groceries', amount: 600 }] });

  const input = screen.getByLabelText(/Food & Groceries monthly budget/i);
  fireEvent.change(input, { target: { value: '' } });
  fireEvent.blur(input);

  await waitFor(() => expect(api.deleteBudget).toHaveBeenCalledWith('b1'));
});
