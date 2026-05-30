package handlers_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/yourname/finance-api/handlers"
	"golang.org/x/crypto/bcrypt"
)

const testSecret = "this-is-a-test-secret-at-least-32-chars!!"

func newAuthHandler(t *testing.T) (*handlers.AuthHandler, sqlmock.Sqlmock) {
	t.Helper()
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	t.Cleanup(func() { db.Close() })
	return &handlers.AuthHandler{DB: db, Secret: testSecret}, mock
}

func doJSON(t *testing.T, h http.HandlerFunc, method, path string, body any) *httptest.ResponseRecorder {
	t.Helper()
	b, _ := json.Marshal(body)
	req := httptest.NewRequest(method, path, bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	h(rr, req)
	return rr
}

// ─── Register ────────────────────────────────────────────────────────────────

func TestRegister_Success(t *testing.T) {
	h, mock := newAuthHandler(t)

	mock.ExpectQuery(`INSERT INTO users`).
		WithArgs("alice@example.com", sqlmock.AnyArg()).
		WillReturnRows(sqlmock.NewRows([]string{"id", "email"}).
			AddRow("uuid-1", "alice@example.com"))

	rr := doJSON(t, h.Register, http.MethodPost, "/api/auth/register",
		map[string]string{"email": "alice@example.com", "password": "password123"})

	if rr.Code != http.StatusCreated {
		t.Fatalf("want 201, got %d: %s", rr.Code, rr.Body.String())
	}
	var resp map[string]any
	json.NewDecoder(rr.Body).Decode(&resp)
	if resp["token"] == nil {
		t.Error("expected token in response")
	}
}

func TestRegister_MissingFields(t *testing.T) {
	h, _ := newAuthHandler(t)

	cases := []map[string]string{
		{},
		{"email": "only@example.com"},
		{"password": "onlypassword"},
	}
	for _, body := range cases {
		rr := doJSON(t, h.Register, http.MethodPost, "/api/auth/register", body)
		if rr.Code != http.StatusBadRequest {
			t.Errorf("body=%v: want 400, got %d", body, rr.Code)
		}
	}
}

func TestRegister_ShortPassword(t *testing.T) {
	h, _ := newAuthHandler(t)
	rr := doJSON(t, h.Register, http.MethodPost, "/api/auth/register",
		map[string]string{"email": "a@b.com", "password": "short"})
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d", rr.Code)
	}
}

func TestRegister_DuplicateEmail(t *testing.T) {
	h, mock := newAuthHandler(t)
	mock.ExpectQuery(`INSERT INTO users`).
		WillReturnError(&pqError{code: "23505", msg: `pq: duplicate key value violates unique constraint "users_email_key"`})

	rr := doJSON(t, h.Register, http.MethodPost, "/api/auth/register",
		map[string]string{"email": "dup@example.com", "password": "validpass"})
	if rr.Code != http.StatusConflict {
		t.Fatalf("want 409, got %d: %s", rr.Code, rr.Body.String())
	}
}

// ─── Login ───────────────────────────────────────────────────────────────────

func TestLogin_Success(t *testing.T) {
	h, mock := newAuthHandler(t)

	hash, _ := bcrypt.GenerateFromPassword([]byte("validpassword"), bcrypt.MinCost)
	mock.ExpectQuery(`SELECT id, email, password_hash FROM users`).
		WithArgs("user@example.com").
		WillReturnRows(sqlmock.NewRows([]string{"id", "email", "password_hash"}).
			AddRow("uuid-2", "user@example.com", string(hash)))

	rr := doJSON(t, h.Login, http.MethodPost, "/api/auth/login",
		map[string]string{"email": "user@example.com", "password": "validpassword"})

	if rr.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rr.Code, rr.Body.String())
	}
	var resp map[string]any
	json.NewDecoder(rr.Body).Decode(&resp)
	if resp["token"] == nil {
		t.Error("expected token in response")
	}
}

func TestLogin_WrongPassword(t *testing.T) {
	h, mock := newAuthHandler(t)

	hash, _ := bcrypt.GenerateFromPassword([]byte("correctpassword"), bcrypt.MinCost)
	mock.ExpectQuery(`SELECT id, email, password_hash FROM users`).
		WithArgs("user@example.com").
		WillReturnRows(sqlmock.NewRows([]string{"id", "email", "password_hash"}).
			AddRow("uuid-3", "user@example.com", string(hash)))

	rr := doJSON(t, h.Login, http.MethodPost, "/api/auth/login",
		map[string]string{"email": "user@example.com", "password": "wrongpassword"})

	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("want 401, got %d", rr.Code)
	}
}

func TestLogin_UserNotFound(t *testing.T) {
	h, mock := newAuthHandler(t)

	mock.ExpectQuery(`SELECT id, email, password_hash FROM users`).
		WillReturnRows(sqlmock.NewRows([]string{"id", "email", "password_hash"}))

	rr := doJSON(t, h.Login, http.MethodPost, "/api/auth/login",
		map[string]string{"email": "ghost@example.com", "password": "anything"})

	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("want 401, got %d", rr.Code)
	}
}

func TestLogin_MissingFields(t *testing.T) {
	h, _ := newAuthHandler(t)
	rr := doJSON(t, h.Login, http.MethodPost, "/api/auth/login",
		map[string]string{"email": "only@example.com"})
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d", rr.Code)
	}
}

type pqError struct {
	code string
	msg  string
}

func (e *pqError) Error() string { return e.msg }
