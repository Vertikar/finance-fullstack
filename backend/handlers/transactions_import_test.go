package handlers_test

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"errors"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/vertikar/finance-api/handlers"
)

func newTransactionsHandler(t *testing.T) (*handlers.TransactionsHandler, sqlmock.Sqlmock) {
	t.Helper()
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	t.Cleanup(func() { db.Close() })
	return &handlers.TransactionsHandler{DB: db}, mock
}

// txCSVRequest builds a multipart POST for the transaction importer, with
// optional extra form fields (source_id, column_map).
func txCSVRequest(t *testing.T, csvContent string, fields map[string]string) *http.Request {
	t.Helper()
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	fw, err := w.CreateFormFile("file", "transactions.csv")
	if err != nil {
		t.Fatalf("create form file: %v", err)
	}
	if _, err := fw.Write([]byte(csvContent)); err != nil {
		t.Fatalf("write csv: %v", err)
	}
	for k, v := range fields {
		if err := w.WriteField(k, v); err != nil {
			t.Fatalf("write field %s: %v", k, err)
		}
	}
	w.Close()

	r := httptest.NewRequest(http.MethodPost, "/api/transactions/import", &buf)
	r.Header.Set("Content-Type", w.FormDataContentType())
	return withUserID(r, "user-1")
}

func loadFrolloFixture(t *testing.T) string {
	t.Helper()
	data, err := os.ReadFile(filepath.Join("..", "testdata", "frollo_sample.csv"))
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	return string(data)
}

// categoryRows mirrors the seeded defaults the handler needs for bucket pre-fill.
func categoryRows() *sqlmock.Rows {
	return sqlmock.NewRows([]string{"name", "bucket"}).
		AddRow("Subscriptions", "lifestyle").
		AddRow("Food & Groceries", "living").
		AddRow("Salary", "income").
		AddRow("Housing", "living").
		AddRow("Savings", "goals").
		AddRow("Cafes & Coffee", "lifestyle")
}

// expectSourceAndCategories sets up the two lookups every auto-detected import
// performs before opening its transaction.
func expectSourceAndCategories(mock sqlmock.Sqlmock) {
	mock.ExpectQuery(`SELECT id FROM import_sources`).
		WithArgs("Frollo").
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("source-frollo"))
	mock.ExpectQuery(`SELECT name, bucket FROM categories`).
		WillReturnRows(categoryRows())
}

// ─── Success ─────────────────────────────────────────────────────────────────

func TestTransactionsImport_AutoDetectsFrolloAndImports(t *testing.T) {
	h, mock := newTransactionsHandler(t)
	expectSourceAndCategories(mock)

	mock.ExpectBegin()
	mock.ExpectQuery(`INSERT INTO import_batches`).
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("batch-1"))
	mock.ExpectPrepare(`INSERT INTO transactions`)
	for i := 0; i < 12; i++ {
		mock.ExpectExec(`INSERT INTO transactions`).
			WillReturnResult(sqlmock.NewResult(1, 1))
	}
	mock.ExpectExec(`UPDATE import_batches SET row_count`).
		WithArgs(12, "batch-1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	rr := httptest.NewRecorder()
	h.Import(rr, txCSVRequest(t, loadFrolloFixture(t), nil))

	if rr.Code != http.StatusCreated {
		t.Fatalf("want 201, got %d: %s", rr.Code, rr.Body.String())
	}
	var result handlers.TransactionImportResult
	json.NewDecoder(rr.Body).Decode(&result)

	if result.Imported != 12 || result.SkippedDuplicates != 0 {
		t.Errorf("want imported=12 skipped=0, got imported=%d skipped=%d",
			result.Imported, result.SkippedDuplicates)
	}
	if result.Source != "Frollo" {
		t.Errorf("expected the Frollo preset to be auto-detected, got %q", result.Source)
	}
	if result.BatchID != "batch-1" {
		t.Errorf("expected the new batch id to be returned, got %q", result.BatchID)
	}
	if len(result.Errors) != 0 {
		t.Errorf("expected no row errors, got %+v", result.Errors)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

// The source's own bucket is preserved only where it disagrees with the
// category's default; agreement leaves the override NULL so the category stays
// in charge.
func TestTransactionsImport_PrefillsBucketOnlyWhenItDisagrees(t *testing.T) {
	h, mock := newTransactionsHandler(t)
	csv := strings.Join([]string{
		"transaction_id,transaction_date,description,amount,category_name,budget_category",
		"t-1,2026-03-23,Extra Mortgage Payment,-60.00,Savings,lifestyle",
		"t-2,2026-03-24,Disney Plus Aus,-20.99,Subscriptions/Renewals,lifestyle",
	}, "\n") + "\n"

	expectSourceAndCategories(mock)
	mock.ExpectBegin()
	mock.ExpectQuery(`INSERT INTO import_batches`).
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("batch-1"))
	mock.ExpectPrepare(`INSERT INTO transactions`)

	// Savings defaults to goals, so Frollo's "lifestyle" becomes an override.
	mock.ExpectExec(`INSERT INTO transactions`).
		WithArgs("user-1", "batch-1", "t-1", "Extra Mortgage Payment", -60.00, "AUD",
			"2026-03-23", nil, nil, "Savings", "lifestyle",
			"Savings", "lifestyle", nil, true).
		WillReturnResult(sqlmock.NewResult(1, 1))

	// Subscriptions/Renewals aliases to Subscriptions, which already defaults to
	// lifestyle — no override, and the alias is stored as the app category.
	mock.ExpectExec(`INSERT INTO transactions`).
		WithArgs("user-1", "batch-1", "t-2", "Disney Plus Aus", -20.99, "AUD",
			"2026-03-24", nil, nil, "Subscriptions/Renewals", "lifestyle",
			"Subscriptions", nil, nil, true).
		WillReturnResult(sqlmock.NewResult(1, 1))

	mock.ExpectExec(`UPDATE import_batches SET row_count`).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	rr := httptest.NewRecorder()
	h.Import(rr, txCSVRequest(t, csv, nil))

	if rr.Code != http.StatusCreated {
		t.Fatalf("want 201, got %d: %s", rr.Code, rr.Body.String())
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

// An unrecognised source category must not be stored as if it were one of ours.
func TestTransactionsImport_UnknownCategoryLeftForReview(t *testing.T) {
	h, mock := newTransactionsHandler(t)
	csv := "transaction_id,transaction_date,description,amount,category_name,budget_category\n" +
		"t-1,2026-03-18,Round Up Transfer,-0.45,Round Up,goals\n"

	expectSourceAndCategories(mock)
	mock.ExpectBegin()
	mock.ExpectQuery(`INSERT INTO import_batches`).
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("batch-1"))
	mock.ExpectPrepare(`INSERT INTO transactions`)
	// category and bucket both NULL: "Round Up" is not an app category, so there
	// is no default to compare the source bucket against.
	mock.ExpectExec(`INSERT INTO transactions`).
		WithArgs("user-1", "batch-1", "t-1", "Round Up Transfer", -0.45, "AUD",
			"2026-03-18", nil, nil, "Round Up", "goals",
			nil, nil, nil, true).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(`UPDATE import_batches SET row_count`).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	rr := httptest.NewRecorder()
	h.Import(rr, txCSVRequest(t, csv, nil))

	if rr.Code != http.StatusCreated {
		t.Fatalf("want 201, got %d: %s", rr.Code, rr.Body.String())
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

// ─── Dedup ───────────────────────────────────────────────────────────────────

func TestTransactionsImport_DuplicatesCountedNotErrored(t *testing.T) {
	h, mock := newTransactionsHandler(t)
	csv := strings.Join([]string{
		"transaction_id,transaction_date,description,amount,category_name,budget_category",
		"t-1,2026-03-23,Already Imported,-60.00,Savings,goals",
		"t-2,2026-03-24,Also Already Imported,-20.99,Savings,goals",
		"t-3,2026-03-25,Brand New,-10.00,Savings,goals",
	}, "\n") + "\n"

	expectSourceAndCategories(mock)
	mock.ExpectBegin()
	mock.ExpectQuery(`INSERT INTO import_batches`).
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("batch-2"))
	mock.ExpectPrepare(`INSERT INTO transactions`)
	// ON CONFLICT DO NOTHING reports zero rows affected for an existing row.
	mock.ExpectExec(`INSERT INTO transactions`).WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectExec(`INSERT INTO transactions`).WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectExec(`INSERT INTO transactions`).WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(`UPDATE import_batches SET row_count`).
		WithArgs(1, "batch-2").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	rr := httptest.NewRecorder()
	h.Import(rr, txCSVRequest(t, csv, nil))

	if rr.Code != http.StatusCreated {
		t.Fatalf("want 201, got %d: %s", rr.Code, rr.Body.String())
	}
	var result handlers.TransactionImportResult
	json.NewDecoder(rr.Body).Decode(&result)
	if result.Imported != 1 || result.SkippedDuplicates != 2 {
		t.Errorf("want imported=1 skipped_duplicates=2, got imported=%d skipped=%d",
			result.Imported, result.SkippedDuplicates)
	}
	if len(result.Errors) != 0 {
		t.Errorf("duplicates must not be reported as errors, got %+v", result.Errors)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

// ─── Per-row errors ──────────────────────────────────────────────────────────

func TestTransactionsImport_BadRowsSkippedGoodRowsKept(t *testing.T) {
	h, mock := newTransactionsHandler(t)
	csv := strings.Join([]string{
		"transaction_id,transaction_date,description,amount,category_name,budget_category",
		"t-1,not-a-date,Bad Date,-60.00,Savings,goals",
		"t-2,2026-03-24,,-20.99,Savings,goals",
		"t-3,2026-03-25,Bad Amount,abc,Savings,goals",
		"t-4,2026-03-26,Good Row,-10.00,Savings,goals",
	}, "\n") + "\n"

	expectSourceAndCategories(mock)
	mock.ExpectBegin()
	mock.ExpectQuery(`INSERT INTO import_batches`).
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("batch-3"))
	mock.ExpectPrepare(`INSERT INTO transactions`)
	mock.ExpectExec(`INSERT INTO transactions`).WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(`UPDATE import_batches SET row_count`).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	rr := httptest.NewRecorder()
	h.Import(rr, txCSVRequest(t, csv, nil))

	if rr.Code != http.StatusCreated {
		t.Fatalf("want 201, got %d: %s", rr.Code, rr.Body.String())
	}
	var result handlers.TransactionImportResult
	json.NewDecoder(rr.Body).Decode(&result)
	if result.Imported != 1 {
		t.Errorf("want imported=1, got %d", result.Imported)
	}
	if len(result.Errors) != 3 {
		t.Fatalf("want 3 row errors, got %d: %+v", len(result.Errors), result.Errors)
	}
	// Row numbers are 1-based including the header, so the first data row is 2.
	if result.Errors[0].Row != 2 {
		t.Errorf("expected the first error on row 2, got %d", result.Errors[0].Row)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

func TestTransactionsImport_EmptyFileImportsNothing(t *testing.T) {
	h, mock := newTransactionsHandler(t)
	csv := "transaction_id,transaction_date,description,amount,category_name,budget_category\n"

	expectSourceAndCategories(mock)
	mock.ExpectBegin()
	mock.ExpectQuery(`INSERT INTO import_batches`).
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("batch-4"))
	mock.ExpectPrepare(`INSERT INTO transactions`)
	mock.ExpectExec(`UPDATE import_batches SET row_count`).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	rr := httptest.NewRecorder()
	h.Import(rr, txCSVRequest(t, csv, nil))

	if rr.Code != http.StatusCreated {
		t.Fatalf("want 201, got %d: %s", rr.Code, rr.Body.String())
	}
	// Capture the raw body before decoding — Decode drains the buffer.
	body := rr.Body.String()

	var result handlers.TransactionImportResult
	json.NewDecoder(strings.NewReader(body)).Decode(&result)
	if result.Imported != 0 {
		t.Errorf("want imported=0, got %d", result.Imported)
	}
	// Encoded as [] rather than null so clients can iterate unconditionally.
	if !strings.Contains(body, `"errors":[]`) {
		t.Errorf("expected an empty errors array in the body, got %s", body)
	}
}

// ─── Request / mapping failures ──────────────────────────────────────────────

func TestTransactionsImport_UnrecognisedFormat(t *testing.T) {
	h, _ := newTransactionsHandler(t)
	// A generic export with none of Frollo's distinguishing columns.
	csv := "Date,Amount,Description,Balance\n15/03/2026,-20.99,Disney Plus Aus,100.00\n"

	rr := httptest.NewRecorder()
	h.Import(rr, txCSVRequest(t, csv, nil))

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d: %s", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), "column_map") {
		t.Errorf("error should point at the available options, got %s", rr.Body.String())
	}
}

func TestTransactionsImport_MissingFileField(t *testing.T) {
	h, _ := newTransactionsHandler(t)
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	w.WriteField("source_id", "source-frollo")
	w.Close()

	r := withUserID(httptest.NewRequest(http.MethodPost, "/api/transactions/import", &buf), "user-1")
	r.Header.Set("Content-Type", w.FormDataContentType())

	rr := httptest.NewRecorder()
	h.Import(rr, r)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d", rr.Code)
	}
}

func TestTransactionsImport_UnknownSourceID(t *testing.T) {
	h, mock := newTransactionsHandler(t)
	mock.ExpectQuery(`SELECT label, column_map FROM import_sources`).
		WithArgs("no-such-source", "user-1").
		WillReturnError(sql.ErrNoRows)

	rr := httptest.NewRecorder()
	h.Import(rr, txCSVRequest(t, "a,b\n1,2\n", map[string]string{"source_id": "no-such-source"}))

	if rr.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d: %s", rr.Code, rr.Body.String())
	}
}

func TestTransactionsImport_InlineColumnMap(t *testing.T) {
	h, mock := newTransactionsHandler(t)
	// A caller-supplied headerless mapping — the CommBank shape.
	inline := `{
		"has_header": false,
		"date_format": "DD/MM/YYYY",
		"amount_mode": "signed",
		"columns": {"transaction_date":"0","amount":"1","description":"2"}
	}`
	csv := "15/03/2026,-20.99,Disney Plus Aus,1378.13\n"

	mock.ExpectQuery(`SELECT name, bucket FROM categories`).WillReturnRows(categoryRows())
	mock.ExpectBegin()
	mock.ExpectQuery(`INSERT INTO import_batches`).
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("batch-5"))
	mock.ExpectPrepare(`INSERT INTO transactions`)
	mock.ExpectExec(`INSERT INTO transactions`).WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(`UPDATE import_batches SET row_count`).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	rr := httptest.NewRecorder()
	h.Import(rr, txCSVRequest(t, csv, map[string]string{"column_map": inline}))

	if rr.Code != http.StatusCreated {
		t.Fatalf("want 201, got %d: %s", rr.Code, rr.Body.String())
	}
	var result handlers.TransactionImportResult
	json.NewDecoder(rr.Body).Decode(&result)
	if result.Imported != 1 {
		t.Errorf("want imported=1, got %d", result.Imported)
	}
	if result.Source != "inline" {
		t.Errorf("expected source to be reported as inline, got %q", result.Source)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

func TestTransactionsImport_MalformedInlineColumnMap(t *testing.T) {
	h, _ := newTransactionsHandler(t)
	rr := httptest.NewRecorder()
	h.Import(rr, txCSVRequest(t, "a,b\n1,2\n", map[string]string{"column_map": "{not json"}))

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d", rr.Code)
	}
}

// ─── DB failures ─────────────────────────────────────────────────────────────

func TestTransactionsImport_InsertFailureRollsBack(t *testing.T) {
	h, mock := newTransactionsHandler(t)
	csv := "transaction_id,transaction_date,description,amount,category_name,budget_category\n" +
		"t-1,2026-03-23,Example,-60.00,Savings,goals\n"

	expectSourceAndCategories(mock)
	mock.ExpectBegin()
	mock.ExpectQuery(`INSERT INTO import_batches`).
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("batch-6"))
	mock.ExpectPrepare(`INSERT INTO transactions`)
	mock.ExpectExec(`INSERT INTO transactions`).WillReturnError(errors.New("constraint violation"))
	mock.ExpectRollback()

	rr := httptest.NewRecorder()
	h.Import(rr, txCSVRequest(t, csv, nil))

	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("want 500, got %d: %s", rr.Code, rr.Body.String())
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("expected the transaction to roll back: %v", err)
	}
}

func TestTransactionsImport_CategoriesQueryFailure(t *testing.T) {
	h, mock := newTransactionsHandler(t)
	mock.ExpectQuery(`SELECT id FROM import_sources`).
		WithArgs("Frollo").
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("source-frollo"))
	mock.ExpectQuery(`SELECT name, bucket FROM categories`).
		WillReturnError(errors.New("db down"))

	rr := httptest.NewRecorder()
	h.Import(rr, txCSVRequest(t, loadFrolloFixture(t), nil))

	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("want 500, got %d", rr.Code)
	}
}

func TestTransactionsImport_BatchInsertFailure(t *testing.T) {
	h, mock := newTransactionsHandler(t)
	expectSourceAndCategories(mock)
	mock.ExpectBegin()
	mock.ExpectQuery(`INSERT INTO import_batches`).WillReturnError(errors.New("db down"))
	mock.ExpectRollback()

	rr := httptest.NewRecorder()
	h.Import(rr, txCSVRequest(t, loadFrolloFixture(t), nil))

	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("want 500, got %d", rr.Code)
	}
}
