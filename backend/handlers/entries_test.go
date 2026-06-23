package handlers_test

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/go-chi/chi/v5"
	"github.com/yourname/finance-api/handlers"
	mw "github.com/yourname/finance-api/middleware"
)

// withChiParam attaches a chi URL parameter (e.g. the {id} segment) to a request
// so handlers that call chi.URLParam resolve it outside the router.
func withChiParam(r *http.Request, key, val string) *http.Request {
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add(key, val)
	return r.WithContext(context.WithValue(r.Context(), chi.RouteCtxKey, rctx))
}

func newEntriesHandler(t *testing.T) (*handlers.EntriesHandler, sqlmock.Sqlmock) {
	t.Helper()
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	t.Cleanup(func() { db.Close() })
	return &handlers.EntriesHandler{DB: db}, mock
}

func withUserID(r *http.Request, userID string) *http.Request {
	ctx := context.WithValue(r.Context(), mw.UserIDKey, userID)
	return r.WithContext(ctx)
}

// ─── List ────────────────────────────────────────────────────────────────────

func TestList_ReturnsEmptyArray(t *testing.T) {
	h, mock := newEntriesHandler(t)
	mock.ExpectQuery(`SELECT .* FROM entries WHERE user_id`).
		WithArgs("user-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "name", "amount", "type", "frequency", "category", "next_due", "created_at", "updated_at"}))

	req := withUserID(httptest.NewRequest(http.MethodGet, "/api/entries", nil), "user-1")
	rr := httptest.NewRecorder()
	h.List(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", rr.Code)
	}
	var result []any
	json.NewDecoder(rr.Body).Decode(&result)
	if len(result) != 0 {
		t.Errorf("expected empty slice, got %d items", len(result))
	}
}

func TestList_ReturnsEntries(t *testing.T) {
	h, mock := newEntriesHandler(t)
	now := time.Now()
	rows := sqlmock.NewRows([]string{"id", "name", "amount", "type", "frequency", "category", "next_due", "created_at", "updated_at"}).
		AddRow("e1", "Rent", 1800.00, "expense", "monthly", "Housing", now, now, now).
		AddRow("e2", "Salary", 5500.00, "income", "monthly", "Salary", now, now, now).
		AddRow("e3", "Rego", 900.00, "expense", "biannual", "Transport", now, now, now)

	mock.ExpectQuery(`SELECT .* FROM entries WHERE user_id`).
		WithArgs("user-1").WillReturnRows(rows)

	req := withUserID(httptest.NewRequest(http.MethodGet, "/api/entries", nil), "user-1")
	rr := httptest.NewRecorder()
	h.List(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", rr.Code)
	}
	var result []handlers.Entry
	json.NewDecoder(rr.Body).Decode(&result)
	if len(result) != 3 {
		t.Fatalf("expected 3 entries, got %d", len(result))
	}
	if result[2].Frequency != "biannual" {
		t.Errorf("expected biannual frequency, got %q", result[2].Frequency)
	}
}

// ─── Create ──────────────────────────────────────────────────────────────────

func TestCreate_Success(t *testing.T) {
	h, mock := newEntriesHandler(t)
	now := time.Now()
	mock.ExpectQuery(`INSERT INTO entries`).
		WillReturnRows(sqlmock.NewRows([]string{"id", "next_due"}).AddRow("new-id", now))

	payload := handlers.Entry{Name: "Netflix", Amount: 18.00, Type: "expense", Frequency: "monthly", Category: "Subscriptions", NextDue: "2026-06-01"}
	body, _ := json.Marshal(payload)
	req := withUserID(httptest.NewRequest(http.MethodPost, "/api/entries", bytes.NewReader(body)), "user-1")
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	h.Create(rr, req)

	if rr.Code != http.StatusCreated {
		t.Fatalf("want 201, got %d: %s", rr.Code, rr.Body.String())
	}
	var result handlers.Entry
	json.NewDecoder(rr.Body).Decode(&result)
	if result.ID != "new-id" {
		t.Errorf("expected id 'new-id', got %q", result.ID)
	}
}

func TestCreate_BiannualEntry(t *testing.T) {
	h, mock := newEntriesHandler(t)
	now := time.Now()
	mock.ExpectQuery(`INSERT INTO entries`).
		WillReturnRows(sqlmock.NewRows([]string{"id", "next_due"}).AddRow("rego-id", now))

	payload := handlers.Entry{Name: "Car Rego", Amount: 900.00, Type: "expense", Frequency: "biannual", Category: "Transport", NextDue: "2026-06-01"}
	body, _ := json.Marshal(payload)
	req := withUserID(httptest.NewRequest(http.MethodPost, "/api/entries", bytes.NewReader(body)), "user-1")
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	h.Create(rr, req)

	if rr.Code != http.StatusCreated {
		t.Fatalf("want 201 for biannual entry, got %d: %s", rr.Code, rr.Body.String())
	}
}

func TestCreate_MissingName(t *testing.T) {
	h, _ := newEntriesHandler(t)
	payload := handlers.Entry{Amount: 100, NextDue: "2026-06-01"}
	body, _ := json.Marshal(payload)
	req := withUserID(httptest.NewRequest(http.MethodPost, "/api/entries", bytes.NewReader(body)), "user-1")
	rr := httptest.NewRecorder()
	h.Create(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d", rr.Code)
	}
}

func TestCreate_ZeroAmount(t *testing.T) {
	h, _ := newEntriesHandler(t)
	payload := handlers.Entry{Name: "Free Stuff", Amount: 0, NextDue: "2026-06-01"}
	body, _ := json.Marshal(payload)
	req := withUserID(httptest.NewRequest(http.MethodPost, "/api/entries", bytes.NewReader(body)), "user-1")
	rr := httptest.NewRecorder()
	h.Create(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("want 400 for zero amount, got %d", rr.Code)
	}
}

// ─── Delete ──────────────────────────────────────────────────────────────────

func TestDelete_Success(t *testing.T) {
	h, mock := newEntriesHandler(t)
	mock.ExpectExec(`DELETE FROM entries`).WithArgs("e1", "user-1").WillReturnResult(sqlmock.NewResult(1, 1))

	req := withUserID(httptest.NewRequest(http.MethodDelete, "/api/entries/e1", nil), "user-1")
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("id", "e1")
	req = req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))
	rr := httptest.NewRecorder()
	h.Delete(rr, req)
	if rr.Code != http.StatusNoContent {
		t.Fatalf("want 204, got %d", rr.Code)
	}
}

func TestDelete_NotFound(t *testing.T) {
	h, mock := newEntriesHandler(t)
	mock.ExpectExec(`DELETE FROM entries`).WithArgs("missing", "user-1").WillReturnResult(sqlmock.NewResult(0, 0))

	req := withUserID(httptest.NewRequest(http.MethodDelete, "/api/entries/missing", nil), "user-1")
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("id", "missing")
	req = req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))
	rr := httptest.NewRecorder()
	h.Delete(rr, req)
	if rr.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d", rr.Code)
	}
}

// ─── Summary — includes biannual frequency ────────────────────────────────────

func TestSummary_CalculatesCorrectly(t *testing.T) {
	h, mock := newEntriesHandler(t)
	rows := sqlmock.NewRows([]string{"amount", "type", "frequency", "category"}).
		AddRow(5500.00, "income", "monthly", "Salary").
		AddRow(1800.00, "expense", "monthly", "Housing").
		AddRow(55.00, "expense", "monthly", "Health").
		AddRow(900.00, "expense", "biannual", "Transport") // 900/6 = $150/mo

	mock.ExpectQuery(`SELECT amount, type, frequency, category FROM entries`).
		WithArgs("user-1").WillReturnRows(rows)

	// Variable-expense budgets are folded into the monthly totals.
	mock.ExpectQuery(`SELECT category, amount FROM budgets`).
		WithArgs("user-1").
		WillReturnRows(sqlmock.NewRows([]string{"category", "amount"}).
			AddRow("Food & Groceries", 600.00).
			AddRow("Transport", 250.00))

	req := withUserID(httptest.NewRequest(http.MethodGet, "/api/entries/summary", nil), "user-1")
	rr := httptest.NewRecorder()
	h.Summary(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", rr.Code)
	}
	var result handlers.Summary
	json.NewDecoder(rr.Body).Decode(&result)

	if result.MonthlyIncome != 5500 {
		t.Errorf("expected income 5500, got %.2f", result.MonthlyIncome)
	}
	// entries: 1800 + 55 + (900/6=150) = 2005; budgets: 600 + 250 = 850
	expectedExpenses := 1800.0 + 55.0 + (900.0 / 6.0) + 600.0 + 250.0
	if result.MonthlyExpenses != expectedExpenses {
		t.Errorf("expected expenses %.2f, got %.2f", expectedExpenses, result.MonthlyExpenses)
	}
	// Transport has both a biannual entry (900/6=150) and a 250 budget → combined 400.
	if result.ByCategory["Transport"] != 400.0 {
		t.Errorf("expected combined Transport 400 in byCategory, got %.2f", result.ByCategory["Transport"])
	}
	if result.ByCategory["Food & Groceries"] != 600.0 {
		t.Errorf("expected Food & Groceries budget 600 in byCategory, got %.2f", result.ByCategory["Food & Groceries"])
	}
}

// ─── Error paths & edge cases ─────────────────────────────────────────────────

func TestList_DBError(t *testing.T) {
	h, mock := newEntriesHandler(t)
	mock.ExpectQuery(`SELECT .* FROM entries WHERE user_id`).
		WithArgs("user-1").WillReturnError(errors.New("connection refused"))

	req := withUserID(httptest.NewRequest(http.MethodGet, "/api/entries", nil), "user-1")
	rr := httptest.NewRecorder()
	h.List(rr, req)

	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("want 500 on query error, got %d", rr.Code)
	}
}

func TestCreate_DBError(t *testing.T) {
	h, mock := newEntriesHandler(t)
	mock.ExpectQuery(`INSERT INTO entries`).WillReturnError(errors.New("constraint violation"))

	payload := handlers.Entry{Name: "Netflix", Amount: 18.00, Type: "expense", Frequency: "monthly", Category: "Subscriptions", NextDue: "2026-06-01"}
	body, _ := json.Marshal(payload)
	req := withUserID(httptest.NewRequest(http.MethodPost, "/api/entries", bytes.NewReader(body)), "user-1")
	rr := httptest.NewRecorder()
	h.Create(rr, req)

	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("want 500 on insert error, got %d", rr.Code)
	}
}

func TestCreate_NegativeAmount(t *testing.T) {
	h, _ := newEntriesHandler(t)
	payload := handlers.Entry{Name: "Refund", Amount: -50, NextDue: "2026-06-01"}
	body, _ := json.Marshal(payload)
	req := withUserID(httptest.NewRequest(http.MethodPost, "/api/entries", bytes.NewReader(body)), "user-1")
	rr := httptest.NewRecorder()
	h.Create(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("want 400 for negative amount, got %d", rr.Code)
	}
}

func TestCreate_MalformedJSON(t *testing.T) {
	h, _ := newEntriesHandler(t)
	req := withUserID(httptest.NewRequest(http.MethodPost, "/api/entries", bytes.NewReader([]byte(`{not json`))), "user-1")
	rr := httptest.NewRecorder()
	h.Create(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("want 400 for malformed JSON, got %d", rr.Code)
	}
}

// ─── Update — not previously covered ──────────────────────────────────────────

func TestUpdate_Success(t *testing.T) {
	h, mock := newEntriesHandler(t)
	now := time.Now()
	mock.ExpectQuery(`UPDATE entries SET`).
		WillReturnRows(sqlmock.NewRows([]string{"id", "next_due"}).AddRow("e1", now))

	payload := handlers.Entry{Name: "Rent", Amount: 2000, Type: "expense", Frequency: "monthly", Category: "Housing", NextDue: "2026-07-01"}
	body, _ := json.Marshal(payload)
	req := withChiParam(withUserID(httptest.NewRequest(http.MethodPut, "/api/entries/e1", bytes.NewReader(body)), "user-1"), "id", "e1")
	rr := httptest.NewRecorder()
	h.Update(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rr.Code, rr.Body.String())
	}
}

func TestUpdate_NotFound(t *testing.T) {
	h, mock := newEntriesHandler(t)
	mock.ExpectQuery(`UPDATE entries SET`).WillReturnError(sql.ErrNoRows)

	payload := handlers.Entry{Name: "Rent", Amount: 2000, NextDue: "2026-07-01"}
	body, _ := json.Marshal(payload)
	req := withChiParam(withUserID(httptest.NewRequest(http.MethodPut, "/api/entries/missing", bytes.NewReader(body)), "user-1"), "id", "missing")
	rr := httptest.NewRecorder()
	h.Update(rr, req)

	if rr.Code != http.StatusNotFound {
		t.Fatalf("want 404 when no row matches, got %d", rr.Code)
	}
}

func TestUpdate_DBError(t *testing.T) {
	h, mock := newEntriesHandler(t)
	mock.ExpectQuery(`UPDATE entries SET`).WillReturnError(errors.New("db down"))

	payload := handlers.Entry{Name: "Rent", Amount: 2000, NextDue: "2026-07-01"}
	body, _ := json.Marshal(payload)
	req := withChiParam(withUserID(httptest.NewRequest(http.MethodPut, "/api/entries/e1", bytes.NewReader(body)), "user-1"), "id", "e1")
	rr := httptest.NewRecorder()
	h.Update(rr, req)

	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("want 500 on update error, got %d", rr.Code)
	}
}

func TestUpdate_MalformedJSON(t *testing.T) {
	h, _ := newEntriesHandler(t)
	req := withChiParam(withUserID(httptest.NewRequest(http.MethodPut, "/api/entries/e1", bytes.NewReader([]byte(`{bad`))), "user-1"), "id", "e1")
	rr := httptest.NewRecorder()
	h.Update(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("want 400 for malformed JSON, got %d", rr.Code)
	}
}

func TestDelete_DBError(t *testing.T) {
	h, mock := newEntriesHandler(t)
	mock.ExpectExec(`DELETE FROM entries`).WithArgs("e1", "user-1").WillReturnError(errors.New("db down"))

	req := withChiParam(withUserID(httptest.NewRequest(http.MethodDelete, "/api/entries/e1", nil), "user-1"), "id", "e1")
	rr := httptest.NewRecorder()
	h.Delete(rr, req)

	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("want 500 on delete error, got %d", rr.Code)
	}
}

func TestSummary_DBError(t *testing.T) {
	h, mock := newEntriesHandler(t)
	mock.ExpectQuery(`SELECT amount, type, frequency, category FROM entries`).
		WithArgs("user-1").WillReturnError(errors.New("db down"))

	req := withUserID(httptest.NewRequest(http.MethodGet, "/api/entries/summary", nil), "user-1")
	rr := httptest.NewRecorder()
	h.Summary(rr, req)

	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("want 500 on summary query error, got %d", rr.Code)
	}
}

// An unknown frequency has no multiplier; it must not crash and contributes 0.
// Mirrors TestSummary_CalculatesCorrectly's multi-row shape and pairs the unknown
// frequency with a known one so we can assert it adds nothing to the total.
func TestSummary_UnknownFrequency(t *testing.T) {
	h, mock := newEntriesHandler(t)
	rows := sqlmock.NewRows([]string{"amount", "type", "frequency", "category"}).
		AddRow(2000.00, "expense", "monthly", "Housing"). // known: $2000/mo
		AddRow(100.00, "expense", "daily", "Misc")        // "daily" is not a known frequency → 0

	mock.ExpectQuery(`SELECT amount, type, frequency, category FROM entries`).
		WithArgs("user-1").WillReturnRows(rows)

	// Summary also folds in variable-expense budgets; none here.
	mock.ExpectQuery(`SELECT category, amount FROM budgets`).
		WithArgs("user-1").
		WillReturnRows(sqlmock.NewRows([]string{"category", "amount"}))

	req := withUserID(httptest.NewRequest(http.MethodGet, "/api/entries/summary", nil), "user-1")
	rr := httptest.NewRecorder()
	h.Summary(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("want 200 even with unknown frequency, got %d", rr.Code)
	}
	var result handlers.Summary
	json.NewDecoder(rr.Body).Decode(&result)
	// Only the known monthly entry counts; the unknown frequency contributes 0.
	if result.MonthlyExpenses != 2000 {
		t.Errorf("unknown frequency should contribute 0; expected expenses 2000, got %.2f", result.MonthlyExpenses)
	}
}
