package handlers_test

import (
	"bytes"
	"encoding/csv"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/yourname/finance-api/handlers"
)

func newImportExportHandler(t *testing.T) (*handlers.ImportExportHandler, sqlmock.Sqlmock) {
	t.Helper()
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	t.Cleanup(func() { db.Close() })
	return &handlers.ImportExportHandler{DB: db}, mock
}

// csvRequest builds a POST request with a multipart CSV file body.
func csvRequest(t *testing.T, csvContent string) *http.Request {
	t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	fw, err := mw.CreateFormFile("file", "test.csv")
	if err != nil {
		t.Fatalf("create form file: %v", err)
	}
	if _, err := fw.Write([]byte(csvContent)); err != nil {
		t.Fatalf("write csv: %v", err)
	}
	mw.Close()
	r := httptest.NewRequest(http.MethodPost, "/api/entries/import", &buf)
	r.Header.Set("Content-Type", mw.FormDataContentType())
	return withUserID(r, "user-1")
}

// ─── Export ──────────────────────────────────────────────────────────────────

func TestExport_EmptyReturnsHeadersOnly(t *testing.T) {
	h, mock := newImportExportHandler(t)
	mock.ExpectQuery(`SELECT name, amount, type, frequency, category, next_due FROM entries`).
		WithArgs("user-1").
		WillReturnRows(sqlmock.NewRows([]string{"name", "amount", "type", "frequency", "category", "next_due"}))

	rr := httptest.NewRecorder()
	r := withUserID(httptest.NewRequest(http.MethodGet, "/api/entries/export", nil), "user-1")
	h.Export(rr, r)

	if rr.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", rr.Code)
	}
	body := rr.Body.String()
	if !strings.HasPrefix(body, "name,amount,type,frequency,category,next_due") {
		t.Errorf("unexpected CSV header: %q", body)
	}
}

func TestExport_RowsFormattedCorrectly(t *testing.T) {
	h, mock := newImportExportHandler(t)
	due := time.Date(2026, 7, 1, 0, 0, 0, 0, time.UTC)
	mock.ExpectQuery(`SELECT name, amount, type, frequency, category, next_due FROM entries`).
		WithArgs("user-1").
		WillReturnRows(
			sqlmock.NewRows([]string{"name", "amount", "type", "frequency", "category", "next_due"}).
				AddRow("Rent", 2000.00, "expense", "monthly", "Housing", due).
				AddRow("Car Rego", 900.00, "expense", "biannual", "Transport", due),
		)

	rr := httptest.NewRecorder()
	r := withUserID(httptest.NewRequest(http.MethodGet, "/api/entries/export", nil), "user-1")
	h.Export(rr, r)

	if rr.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", rr.Code)
	}

	cr := csv.NewReader(rr.Body)
	rows, err := cr.ReadAll()
	if err != nil {
		t.Fatalf("parse CSV: %v", err)
	}
	if len(rows) != 3 {
		t.Fatalf("want 3 rows (header + 2 data), got %d", len(rows))
	}

	// date must be YYYY-MM-DD
	if rows[1][5] != "2026-07-01" {
		t.Errorf("row 1 next_due: want 2026-07-01, got %q", rows[1][5])
	}
	if rows[2][1] != "900.00" {
		t.Errorf("row 2 amount: want 900.00, got %q", rows[2][1])
	}
	if rows[2][3] != "biannual" {
		t.Errorf("row 2 frequency: want biannual, got %q", rows[2][3])
	}
}

// ─── Import — validation errors ───────────────────────────────────────────────

func TestImport_MissingColumn(t *testing.T) {
	h, _ := newImportExportHandler(t)
	body := "name,amount,type,frequency,category\nRent,2000.00,expense,monthly,Housing\n"
	rr := httptest.NewRecorder()
	h.Import(rr, csvRequest(t, body))
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d: %s", rr.Code, rr.Body.String())
	}
}

func TestImport_InvalidType(t *testing.T) {
	h, _ := newImportExportHandler(t)
	body := "name,amount,type,frequency,category,next_due\nRent,2000.00,bad,monthly,Housing,2026-07-01\n"
	rr := httptest.NewRecorder()
	h.Import(rr, csvRequest(t, body))
	if rr.Code != http.StatusCreated {
		t.Fatalf("want 201, got %d", rr.Code)
	}
	var result handlers.ImportResult
	json.NewDecoder(rr.Body).Decode(&result)
	if result.Imported != 0 || result.Skipped != 1 {
		t.Errorf("want imported=0 skipped=1, got imported=%d skipped=%d", result.Imported, result.Skipped)
	}
	if !strings.Contains(result.Errors[0].Message, "type") {
		t.Errorf("want type error, got %q", result.Errors[0].Message)
	}
}

func TestImport_InvalidFrequency(t *testing.T) {
	h, _ := newImportExportHandler(t)
	body := "name,amount,type,frequency,category,next_due\nRent,2000.00,expense,daily,Housing,2026-07-01\n"
	rr := httptest.NewRecorder()
	h.Import(rr, csvRequest(t, body))
	var result handlers.ImportResult
	json.NewDecoder(rr.Body).Decode(&result)
	if result.Skipped != 1 || !strings.Contains(result.Errors[0].Message, "frequency") {
		t.Errorf("want frequency error, got %+v", result)
	}
}

func TestImport_InvalidDate(t *testing.T) {
	h, _ := newImportExportHandler(t)
	body := "name,amount,type,frequency,category,next_due\nRent,2000.00,expense,monthly,Housing,not-a-date\n"
	rr := httptest.NewRecorder()
	h.Import(rr, csvRequest(t, body))
	var result handlers.ImportResult
	json.NewDecoder(rr.Body).Decode(&result)
	if result.Skipped != 1 || !strings.Contains(result.Errors[0].Message, "next_due") {
		t.Errorf("want next_due error, got %+v", result)
	}
}

func TestImport_NegativeAmount(t *testing.T) {
	h, _ := newImportExportHandler(t)
	body := "name,amount,type,frequency,category,next_due\nRent,-100.00,expense,monthly,Housing,2026-07-01\n"
	rr := httptest.NewRecorder()
	h.Import(rr, csvRequest(t, body))
	var result handlers.ImportResult
	json.NewDecoder(rr.Body).Decode(&result)
	if result.Skipped != 1 || !strings.Contains(result.Errors[0].Message, "amount") {
		t.Errorf("want amount error, got %+v", result)
	}
}

// ─── Import — date format flexibility ────────────────────────────────────────

func TestImport_DateDDMMYYYYIsNormalisedAndAccepted(t *testing.T) {
	h, mock := newImportExportHandler(t)
	// DD/MM/YYYY format (common when CSV opened and re-saved by Excel in Australian locale)
	body := "name,amount,type,frequency,category,next_due\nRent,2000.00,expense,monthly,Housing,01/07/2026\n"

	mock.ExpectBegin()
	mock.ExpectPrepare(`INSERT INTO entries`)
	mock.ExpectExec(`INSERT INTO entries`).
		WithArgs("user-1", "Rent", 2000.00, "expense", "monthly", "Housing", "2026-07-01").
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	rr := httptest.NewRecorder()
	h.Import(rr, csvRequest(t, body))

	if rr.Code != http.StatusCreated {
		t.Fatalf("want 201, got %d: %s", rr.Code, rr.Body.String())
	}
	var result handlers.ImportResult
	json.NewDecoder(rr.Body).Decode(&result)
	if result.Imported != 1 || result.Skipped != 0 {
		t.Errorf("want imported=1 skipped=0, got %+v", result)
	}
}

// ─── Import — successful inserts ─────────────────────────────────────────────

func TestImport_ValidRowsImported(t *testing.T) {
	h, mock := newImportExportHandler(t)
	body := strings.Join([]string{
		"name,amount,type,frequency,category,next_due",
		"Rent,2000.00,expense,monthly,Housing,2026-07-01",
		"Salary,6500.00,income,monthly,Salary,2026-07-15",
	}, "\n") + "\n"

	mock.ExpectBegin()
	mock.ExpectPrepare(`INSERT INTO entries`)
	mock.ExpectExec(`INSERT INTO entries`).
		WithArgs("user-1", "Rent", 2000.00, "expense", "monthly", "Housing", "2026-07-01").
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(`INSERT INTO entries`).
		WithArgs("user-1", "Salary", 6500.00, "income", "monthly", "Salary", "2026-07-15").
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	rr := httptest.NewRecorder()
	h.Import(rr, csvRequest(t, body))

	if rr.Code != http.StatusCreated {
		t.Fatalf("want 201, got %d: %s", rr.Code, rr.Body.String())
	}
	var result handlers.ImportResult
	json.NewDecoder(rr.Body).Decode(&result)
	if result.Imported != 2 || result.Skipped != 0 {
		t.Errorf("want imported=2 skipped=0, got %+v", result)
	}
}

func TestImport_BiannualFrequencyAccepted(t *testing.T) {
	h, mock := newImportExportHandler(t)
	body := "name,amount,type,frequency,category,next_due\nCar Rego,900.00,expense,biannual,Transport,2026-07-01\n"

	mock.ExpectBegin()
	mock.ExpectPrepare(`INSERT INTO entries`)
	mock.ExpectExec(`INSERT INTO entries`).
		WithArgs("user-1", "Car Rego", 900.00, "expense", "biannual", "Transport", "2026-07-01").
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	rr := httptest.NewRecorder()
	h.Import(rr, csvRequest(t, body))

	if rr.Code != http.StatusCreated {
		t.Fatalf("want 201, got %d: %s", rr.Code, rr.Body.String())
	}
	var result handlers.ImportResult
	json.NewDecoder(rr.Body).Decode(&result)
	if result.Imported != 1 || result.Skipped != 0 {
		t.Errorf("want imported=1 skipped=0, got %+v", result)
	}
}

func TestImport_MixedValidAndInvalidRows(t *testing.T) {
	h, mock := newImportExportHandler(t)
	body := strings.Join([]string{
		"name,amount,type,frequency,category,next_due",
		"Rent,2000.00,expense,monthly,Housing,2026-07-01",   // valid
		",100.00,expense,monthly,Housing,2026-07-01",         // invalid: empty name
		"Salary,6500.00,income,monthly,Salary,2026-07-15",   // valid
	}, "\n") + "\n"

	mock.ExpectBegin()
	mock.ExpectPrepare(`INSERT INTO entries`)
	mock.ExpectExec(`INSERT INTO entries`).
		WithArgs("user-1", "Rent", 2000.00, "expense", "monthly", "Housing", "2026-07-01").
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(`INSERT INTO entries`).
		WithArgs("user-1", "Salary", 6500.00, "income", "monthly", "Salary", "2026-07-15").
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	rr := httptest.NewRecorder()
	h.Import(rr, csvRequest(t, body))

	if rr.Code != http.StatusCreated {
		t.Fatalf("want 201, got %d: %s", rr.Code, rr.Body.String())
	}
	var result handlers.ImportResult
	json.NewDecoder(rr.Body).Decode(&result)
	if result.Imported != 2 || result.Skipped != 1 {
		t.Errorf("want imported=2 skipped=1, got %+v", result)
	}
}

func TestImport_EmptyFileSetsZeroCounts(t *testing.T) {
	h, _ := newImportExportHandler(t)
	body := "name,amount,type,frequency,category,next_due\n"
	rr := httptest.NewRecorder()
	h.Import(rr, csvRequest(t, body))
	if rr.Code != http.StatusCreated {
		t.Fatalf("want 201, got %d", rr.Code)
	}
	var result handlers.ImportResult
	json.NewDecoder(rr.Body).Decode(&result)
	if result.Imported != 0 || result.Skipped != 0 {
		t.Errorf("want imported=0 skipped=0, got %+v", result)
	}
}

// Ensure the round-trip: export YYYY-MM-DD, re-import YYYY-MM-DD works end-to-end.
func TestExportImportRoundTrip_DateFormat(t *testing.T) {
	due := time.Date(2026, 7, 1, 0, 0, 0, 0, time.UTC)
	exportHandler, exportMock := newImportExportHandler(t)
	exportMock.ExpectQuery(`SELECT name, amount, type, frequency, category, next_due FROM entries`).
		WithArgs("user-1").
		WillReturnRows(
			sqlmock.NewRows([]string{"name", "amount", "type", "frequency", "category", "next_due"}).
				AddRow("Rent", 2000.00, "expense", "monthly", "Housing", due),
		)

	exportRR := httptest.NewRecorder()
	exportHandler.Export(exportRR, withUserID(httptest.NewRequest(http.MethodGet, "/api/entries/export", nil), "user-1"))
	exportedCSV := exportRR.Body.String()

	// Confirm the exported date is YYYY-MM-DD
	if !strings.Contains(exportedCSV, "2026-07-01") {
		t.Fatalf("exported CSV does not contain YYYY-MM-DD date; got:\n%s", exportedCSV)
	}

	importHandler, importMock := newImportExportHandler(t)
	importMock.ExpectBegin()
	importMock.ExpectPrepare(`INSERT INTO entries`)
	importMock.ExpectExec(`INSERT INTO entries`).
		WithArgs("user-1", "Rent", 2000.00, "expense", "monthly", "Housing", "2026-07-01").
		WillReturnResult(sqlmock.NewResult(1, 1))
	importMock.ExpectCommit()

	importRR := httptest.NewRecorder()
	importHandler.Import(importRR, csvRequest(t, exportedCSV))

	if importRR.Code != http.StatusCreated {
		t.Fatalf("re-import failed: %d %s", importRR.Code, importRR.Body.String())
	}
	var result handlers.ImportResult
	json.NewDecoder(importRR.Body).Decode(&result)
	if result.Imported != 1 {
		t.Errorf("want imported=1, got %+v", result)
	}
}

