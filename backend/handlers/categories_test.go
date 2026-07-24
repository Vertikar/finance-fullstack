package handlers_test

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/vertikar/finance-api/handlers"
)

func newCategoriesHandler(t *testing.T) (*handlers.CategoriesHandler, sqlmock.Sqlmock) {
	t.Helper()
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	t.Cleanup(func() { db.Close() })
	return &handlers.CategoriesHandler{DB: db}, mock
}

// ─── List ────────────────────────────────────────────────────────────────────

func TestCategories_List_ReturnsEmptyArray(t *testing.T) {
	h, mock := newCategoriesHandler(t)
	mock.ExpectQuery(`SELECT .* FROM categories`).
		WillReturnRows(sqlmock.NewRows([]string{"id", "name", "type", "bucket", "color", "sort_order"}))

	// Global reference data — no user scoping — but pass a user for parity with
	// the authenticated route the handler is mounted behind.
	req := withUserID(httptest.NewRequest(http.MethodGet, "/api/categories", nil), "user-1")
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

func TestCategories_List_ReturnsCategories(t *testing.T) {
	h, mock := newCategoriesHandler(t)
	rows := sqlmock.NewRows([]string{"id", "name", "type", "bucket", "color", "sort_order"}).
		AddRow("c1", "Salary", "income", "income", "#4ade80", 10).
		AddRow("c2", "Housing", "expense", "living", "#f87171", 100).
		AddRow("c3", "Restaurants", "expense", "lifestyle", "#fb7185", 230)

	mock.ExpectQuery(`SELECT .* FROM categories`).WillReturnRows(rows)

	req := withUserID(httptest.NewRequest(http.MethodGet, "/api/categories", nil), "user-1")
	rr := httptest.NewRecorder()
	h.List(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", rr.Code)
	}
	var result []handlers.Category
	if err := json.NewDecoder(rr.Body).Decode(&result); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(result) != 3 {
		t.Fatalf("expected 3 categories, got %d", len(result))
	}
	if result[0].Name != "Salary" || result[0].Bucket != "income" || result[0].Color != "#4ade80" {
		t.Errorf("unexpected first category: %+v", result[0])
	}
	if result[2].Name != "Restaurants" || result[2].Bucket != "lifestyle" {
		t.Errorf("unexpected third category: %+v", result[2])
	}
}

func TestCategories_List_DBError(t *testing.T) {
	h, mock := newCategoriesHandler(t)
	mock.ExpectQuery(`SELECT .* FROM categories`).
		WillReturnError(sql.ErrConnDone)

	req := withUserID(httptest.NewRequest(http.MethodGet, "/api/categories", nil), "user-1")
	rr := httptest.NewRecorder()
	h.List(rr, req)

	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("want 500, got %d", rr.Code)
	}
}
