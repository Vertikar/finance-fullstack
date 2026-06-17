package handlers_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/yourname/finance-api/handlers"
)

func newSettingsHandler(t *testing.T) (*handlers.SettingsHandler, sqlmock.Sqlmock) {
	t.Helper()
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	t.Cleanup(func() { db.Close() })
	return &handlers.SettingsHandler{DB: db}, mock
}

// ─── GetPayCycle ──────────────────────────────────────────────────────────────

func TestGetPayCycle_Unconfigured(t *testing.T) {
	h, mock := newSettingsHandler(t)
	mock.ExpectQuery(`SELECT pay_cycle`).
		WithArgs("user-1").
		WillReturnRows(sqlmock.NewRows([]string{"pay_cycle", "last_pay_date"}).AddRow(nil, nil))

	req := withUserID(httptest.NewRequest(http.MethodGet, "/api/settings/pay-cycle", nil), "user-1")
	rr := httptest.NewRecorder()
	h.GetPayCycle(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", rr.Code)
	}
	var result map[string]interface{}
	json.NewDecoder(rr.Body).Decode(&result)
	if result["pay_cycle"] != nil {
		t.Errorf("expected null pay_cycle, got %v", result["pay_cycle"])
	}
	if result["last_pay_date"] != nil {
		t.Errorf("expected null last_pay_date, got %v", result["last_pay_date"])
	}
}

func TestGetPayCycle_Configured(t *testing.T) {
	h, mock := newSettingsHandler(t)
	mock.ExpectQuery(`SELECT pay_cycle`).
		WithArgs("user-1").
		WillReturnRows(sqlmock.NewRows([]string{"pay_cycle", "last_pay_date"}).
			AddRow("fortnightly", "2026-06-10"))

	req := withUserID(httptest.NewRequest(http.MethodGet, "/api/settings/pay-cycle", nil), "user-1")
	rr := httptest.NewRecorder()
	h.GetPayCycle(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", rr.Code)
	}
	var result map[string]interface{}
	json.NewDecoder(rr.Body).Decode(&result)
	if result["pay_cycle"] != "fortnightly" {
		t.Errorf("expected 'fortnightly', got %v", result["pay_cycle"])
	}
	if result["last_pay_date"] != "2026-06-10" {
		t.Errorf("expected '2026-06-10', got %v", result["last_pay_date"])
	}
}

// ─── PutPayCycle ─────────────────────────────────────────────────────────────

func TestPutPayCycle_InvalidCycle(t *testing.T) {
	h, _ := newSettingsHandler(t)
	body, _ := json.Marshal(map[string]string{
		"pay_cycle":    "weekly",
		"last_pay_date": "2026-06-10",
	})
	req := withUserID(httptest.NewRequest(http.MethodPut, "/api/settings/pay-cycle", bytes.NewReader(body)), "user-1")
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	h.PutPayCycle(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("want 400 for invalid pay_cycle value, got %d", rr.Code)
	}
}

func TestPutPayCycle_MissingDate(t *testing.T) {
	h, _ := newSettingsHandler(t)
	body, _ := json.Marshal(map[string]string{"pay_cycle": "monthly"})
	req := withUserID(httptest.NewRequest(http.MethodPut, "/api/settings/pay-cycle", bytes.NewReader(body)), "user-1")
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	h.PutPayCycle(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("want 400 for missing last_pay_date, got %d", rr.Code)
	}
}

func TestPutPayCycle_Success(t *testing.T) {
	h, mock := newSettingsHandler(t)
	mock.ExpectQuery(`UPDATE users SET pay_cycle`).
		WithArgs("monthly", "2026-06-01", "user-1").
		WillReturnRows(sqlmock.NewRows([]string{"pay_cycle", "last_pay_date"}).
			AddRow("monthly", "2026-06-01"))

	body, _ := json.Marshal(map[string]string{
		"pay_cycle":    "monthly",
		"last_pay_date": "2026-06-01",
	})
	req := withUserID(httptest.NewRequest(http.MethodPut, "/api/settings/pay-cycle", bytes.NewReader(body)), "user-1")
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	h.PutPayCycle(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rr.Code, rr.Body.String())
	}
	var result map[string]interface{}
	json.NewDecoder(rr.Body).Decode(&result)
	if result["pay_cycle"] != "monthly" {
		t.Errorf("expected 'monthly', got %v", result["pay_cycle"])
	}
	if result["last_pay_date"] != "2026-06-01" {
		t.Errorf("expected '2026-06-01', got %v", result["last_pay_date"])
	}
}
