package handlers_test

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/go-chi/chi/v5"
	"github.com/vertikar/finance-api/handlers"
)

func newBudgetsHandler(t *testing.T) (*handlers.BudgetsHandler, sqlmock.Sqlmock) {
	t.Helper()
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	t.Cleanup(func() { db.Close() })
	return &handlers.BudgetsHandler{DB: db}, mock
}

func budgetWithID(req *http.Request, id string) *http.Request {
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("id", id)
	return req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))
}

// ─── List ────────────────────────────────────────────────────────────────────

func TestBudgets_List_ReturnsEmptyArray(t *testing.T) {
	h, mock := newBudgetsHandler(t)
	mock.ExpectQuery(`SELECT .* FROM budgets WHERE user_id`).
		WithArgs("user-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "category", "amount", "created_at", "updated_at"}))

	req := withUserID(httptest.NewRequest(http.MethodGet, "/api/budgets", nil), "user-1")
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

func TestBudgets_List_ReturnsBudgets(t *testing.T) {
	h, mock := newBudgetsHandler(t)
	now := time.Now()
	rows := sqlmock.NewRows([]string{"id", "category", "amount", "created_at", "updated_at"}).
		AddRow("b1", "Food & Groceries", 600.00, now, now).
		AddRow("b2", "Transport", 250.00, now, now)

	mock.ExpectQuery(`SELECT .* FROM budgets WHERE user_id`).
		WithArgs("user-1").WillReturnRows(rows)

	req := withUserID(httptest.NewRequest(http.MethodGet, "/api/budgets", nil), "user-1")
	rr := httptest.NewRecorder()
	h.List(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", rr.Code)
	}
	var result []handlers.Budget
	json.NewDecoder(rr.Body).Decode(&result)
	if len(result) != 2 {
		t.Fatalf("expected 2 budgets, got %d", len(result))
	}
	if result[0].Category != "Food & Groceries" || result[0].Amount != 600 {
		t.Errorf("unexpected first budget: %+v", result[0])
	}
}

// ─── Create ──────────────────────────────────────────────────────────────────

func TestBudgets_Create_Success(t *testing.T) {
	h, mock := newBudgetsHandler(t)
	mock.ExpectQuery(`INSERT INTO budgets`).
		WithArgs("user-1", "Food & Groceries", 600.00).
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("b-new"))

	payload := handlers.Budget{Category: "Food & Groceries", Amount: 600.00}
	body, _ := json.Marshal(payload)
	req := withUserID(httptest.NewRequest(http.MethodPost, "/api/budgets", bytes.NewReader(body)), "user-1")
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	h.Create(rr, req)

	if rr.Code != http.StatusCreated {
		t.Fatalf("want 201, got %d: %s", rr.Code, rr.Body.String())
	}
	var result handlers.Budget
	json.NewDecoder(rr.Body).Decode(&result)
	if result.ID != "b-new" {
		t.Errorf("expected id 'b-new', got %q", result.ID)
	}
}

func TestBudgets_Create_MissingCategory(t *testing.T) {
	h, _ := newBudgetsHandler(t)
	payload := handlers.Budget{Amount: 100}
	body, _ := json.Marshal(payload)
	req := withUserID(httptest.NewRequest(http.MethodPost, "/api/budgets", bytes.NewReader(body)), "user-1")
	rr := httptest.NewRecorder()
	h.Create(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("want 400 for missing category, got %d", rr.Code)
	}
}

func TestBudgets_Create_NegativeAmount(t *testing.T) {
	h, _ := newBudgetsHandler(t)
	payload := handlers.Budget{Category: "Transport", Amount: -50}
	body, _ := json.Marshal(payload)
	req := withUserID(httptest.NewRequest(http.MethodPost, "/api/budgets", bytes.NewReader(body)), "user-1")
	rr := httptest.NewRecorder()
	h.Create(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("want 400 for negative amount, got %d", rr.Code)
	}
}

// ─── Update ──────────────────────────────────────────────────────────────────

func TestBudgets_Update_Success(t *testing.T) {
	h, mock := newBudgetsHandler(t)
	mock.ExpectQuery(`UPDATE budgets SET amount`).
		WithArgs(750.00, "b1", "user-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "category", "amount"}).AddRow("b1", "Food & Groceries", 750.00))

	payload := handlers.Budget{Amount: 750.00}
	body, _ := json.Marshal(payload)
	req := withUserID(httptest.NewRequest(http.MethodPut, "/api/budgets/b1", bytes.NewReader(body)), "user-1")
	req = budgetWithID(req, "b1")
	rr := httptest.NewRecorder()
	h.Update(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rr.Code, rr.Body.String())
	}
	var result handlers.Budget
	json.NewDecoder(rr.Body).Decode(&result)
	if result.Amount != 750 {
		t.Errorf("expected amount 750, got %.2f", result.Amount)
	}
}

func TestBudgets_Update_NotFound(t *testing.T) {
	h, mock := newBudgetsHandler(t)
	mock.ExpectQuery(`UPDATE budgets SET amount`).
		WithArgs(750.00, "missing", "user-1").
		WillReturnError(sql.ErrNoRows)

	payload := handlers.Budget{Amount: 750.00}
	body, _ := json.Marshal(payload)
	req := withUserID(httptest.NewRequest(http.MethodPut, "/api/budgets/missing", bytes.NewReader(body)), "user-1")
	req = budgetWithID(req, "missing")
	rr := httptest.NewRecorder()
	h.Update(rr, req)

	if rr.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d", rr.Code)
	}
}

// ─── Delete ──────────────────────────────────────────────────────────────────

func TestBudgets_Delete_Success(t *testing.T) {
	h, mock := newBudgetsHandler(t)
	mock.ExpectExec(`DELETE FROM budgets`).WithArgs("b1", "user-1").WillReturnResult(sqlmock.NewResult(0, 1))

	req := withUserID(httptest.NewRequest(http.MethodDelete, "/api/budgets/b1", nil), "user-1")
	req = budgetWithID(req, "b1")
	rr := httptest.NewRecorder()
	h.Delete(rr, req)
	if rr.Code != http.StatusNoContent {
		t.Fatalf("want 204, got %d", rr.Code)
	}
}

func TestBudgets_Delete_NotFound(t *testing.T) {
	h, mock := newBudgetsHandler(t)
	mock.ExpectExec(`DELETE FROM budgets`).WithArgs("missing", "user-1").WillReturnResult(sqlmock.NewResult(0, 0))

	req := withUserID(httptest.NewRequest(http.MethodDelete, "/api/budgets/missing", nil), "user-1")
	req = budgetWithID(req, "missing")
	rr := httptest.NewRecorder()
	h.Delete(rr, req)
	if rr.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d", rr.Code)
	}
}
