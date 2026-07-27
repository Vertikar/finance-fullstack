import { render, screen, fireEvent } from '@testing-library/react';
import ImportModal, { parseCSVLine, parseCSVText } from './ImportModal';

// ── parseCSVLine ────────────────────────────────────────────────────────────
describe('parseCSVLine', () => {
  test('splits a simple comma-separated line', () => {
    expect(parseCSVLine('a,b,c')).toEqual(['a', 'b', 'c']);
  });

  test('trims surrounding whitespace on each field', () => {
    expect(parseCSVLine('a ,  b , c')).toEqual(['a', 'b', 'c']);
  });

  test('keeps commas that appear inside quoted fields', () => {
    expect(parseCSVLine('"Smith, John",100,income')).toEqual(['Smith, John', '100', 'income']);
  });

  test('unescapes doubled quotes inside a quoted field', () => {
    expect(parseCSVLine('"say ""hi""",x')).toEqual(['say "hi"', 'x']);
  });

  test('appends an empty trailing field for a trailing comma', () => {
    expect(parseCSVLine('a,b,')).toEqual(['a', 'b', '']);
  });
});

// ── parseCSVText ────────────────────────────────────────────────────────────
describe('parseCSVText', () => {
  test('lowercases headers and maps each row to an object', () => {
    const { headers, rows } = parseCSVText('Name,Amount\nRent,1800');
    expect(headers).toEqual(['name', 'amount']);
    expect(rows[0]).toEqual({ name: 'Rent', amount: '1800' });
  });

  test('normalises CRLF and bare CR line endings', () => {
    expect(parseCSVText('a,b\r\n1,2').rows[0]).toEqual({ a: '1', b: '2' });
    expect(parseCSVText('a,b\r1,2').rows[0]).toEqual({ a: '1', b: '2' });
  });

  test('ignores blank lines', () => {
    const { rows } = parseCSVText('a,b\n\n1,2\n\n');
    expect(rows).toHaveLength(1);
  });

  test('returns empty headers and rows for empty input', () => {
    expect(parseCSVText('')).toEqual({ headers: [], rows: [] });
  });

  test('reports totalLines and caps imported rows at 1000', () => {
    const lines = ['name,amount'];
    for (let i = 0; i < 1200; i++) lines.push(`row${i},${i}`);
    const { rows, totalLines } = parseCSVText(lines.join('\n'));
    expect(totalLines).toBe(1200);
    expect(rows).toHaveLength(1000);
  });

  test('fills missing trailing values with empty strings', () => {
    const { rows } = parseCSVText('name,amount,type\nRent,1800');
    expect(rows[0]).toEqual({ name: 'Rent', amount: '1800', type: '' });
  });
});

// ── Component ────────────────────────────────────────────────────────────────
describe('ImportModal component', () => {
  test('renders the idle drop zone listing the required columns', () => {
    render(<ImportModal onClose={() => {}} onImported={() => {}} themeKey="dark" />);
    expect(screen.getByText(/Upload Entries/i)).toBeInTheDocument();
    expect(screen.getByText(/Required columns:/i)).toBeInTheDocument();
  });

  test('shows an error when an uploaded CSV is missing required columns', async () => {
    const { container } = render(
      <ImportModal onClose={() => {}} onImported={() => {}} themeKey="dark" />
    );
    const input = container.querySelector('input[type="file"]');
    const file = new File(['name,amount\nRent,1800'], 'bad.csv', { type: 'text/csv' });
    fireEvent.change(input, { target: { files: [file] } });

    expect(await screen.findByText(/Missing required columns/i)).toBeInTheDocument();
  });

  test('rejects a non-CSV file by extension', () => {
    const { container } = render(
      <ImportModal onClose={() => {}} onImported={() => {}} themeKey="dark" />
    );
    const input = container.querySelector('input[type="file"]');
    const file = new File(['whatever'], 'notes.txt', { type: 'text/plain' });
    fireEvent.change(input, { target: { files: [file] } });

    expect(screen.getByText(/Please select a \.csv file/i)).toBeInTheDocument();
  });

  // A bank statement can never satisfy this importer — it has no frequency
  // column — so the plain "missing columns" error is misleading on its own.
  test('explains the mismatch when the CSV is a bank statement', async () => {
    const { container } = render(
      <ImportModal onClose={() => {}} onImported={() => {}} themeKey="dark" />
    );
    const input = container.querySelector('input[type="file"]');
    const statement =
      'transaction_id,transaction_date,description,amount,category_name,budget_category,account_name\n' +
      't-1,2026-03-15,Disney Plus Aus,-20.99,Subscriptions/Renewals,lifestyle,Everyday Account';
    const file = new File([statement], 'frollo.csv', { type: 'text/csv' });
    fireEvent.change(input, { target: { files: [file] } });

    expect(await screen.findByText(/Missing required columns/i)).toBeInTheDocument();
    expect(screen.getByText(/looks like a bank statement/i)).toBeInTheDocument();
    expect(screen.getByText(/separate transaction import/i)).toBeInTheDocument();
  });

  test('does not show the statement hint for an ordinary invalid CSV', async () => {
    const { container } = render(
      <ImportModal onClose={() => {}} onImported={() => {}} themeKey="dark" />
    );
    const input = container.querySelector('input[type="file"]');
    const file = new File(['foo,bar\n1,2'], 'junk.csv', { type: 'text/csv' });
    fireEvent.change(input, { target: { files: [file] } });

    expect(await screen.findByText(/Missing required columns/i)).toBeInTheDocument();
    expect(screen.queryByText(/looks like a bank statement/i)).not.toBeInTheDocument();
  });
});
