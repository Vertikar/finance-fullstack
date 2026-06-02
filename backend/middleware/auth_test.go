package middleware_test

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	mw "github.com/yourname/finance-api/middleware"
)

const testSecret = "this-is-a-test-secret-at-least-32-chars!!"

// makeToken generates a signed JWT for testing.
func makeToken(t *testing.T, userID string, secret string, expiry time.Duration) string {
	t.Helper()
	claims := jwt.MapClaims{
		"user_id": userID,
		"exp":     time.Now().Add(expiry).Unix(),
		"iat":     time.Now().Unix(),
	}
	tok, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(secret))
	if err != nil {
		t.Fatalf("makeToken: %v", err)
	}
	return tok
}

func sentinelHandler(t *testing.T, reachedPtr *bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		*reachedPtr = true
		w.Write([]byte(mw.GetUserID(r)))
	}
}

func TestAuth_ValidToken_PassesThrough(t *testing.T) {
	tok := makeToken(t, "user-abc", testSecret, time.Hour)

	reached := false
	handler := mw.NewAuth(testSecret)(sentinelHandler(t, &reached))

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Authorization", "Bearer "+tok)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", rr.Code)
	}
	if !reached {
		t.Error("inner handler should have been called")
	}
	if rr.Body.String() != "user-abc" {
		t.Errorf("expected user-abc in body, got %q", rr.Body.String())
	}
}

func TestAuth_MissingHeader_Returns401(t *testing.T) {
	reached := false
	handler := mw.NewAuth(testSecret)(sentinelHandler(t, &reached))

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("want 401, got %d", rr.Code)
	}
	if reached {
		t.Error("inner handler must not be called")
	}
}

func TestAuth_WrongScheme_Returns401(t *testing.T) {
	reached := false
	handler := mw.NewAuth(testSecret)(sentinelHandler(t, &reached))

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Authorization", "Basic somebase64stuff")
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("want 401, got %d", rr.Code)
	}
}

func TestAuth_ExpiredToken_Returns401(t *testing.T) {
	tok := makeToken(t, "user-xyz", testSecret, -time.Hour)

	reached := false
	handler := mw.NewAuth(testSecret)(sentinelHandler(t, &reached))

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Authorization", "Bearer "+tok)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("want 401, got %d", rr.Code)
	}
	if reached {
		t.Error("inner handler must not be called for expired token")
	}
}

func TestAuth_WrongSecret_Returns401(t *testing.T) {
	tok := makeToken(t, "user-xyz", "wrong-secret-that-is-different-from-test", time.Hour)

	reached := false
	handler := mw.NewAuth(testSecret)(sentinelHandler(t, &reached))

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Authorization", "Bearer "+tok)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("want 401, got %d", rr.Code)
	}
}

func TestAuth_MalformedToken_Returns401(t *testing.T) {
	reached := false
	handler := mw.NewAuth(testSecret)(sentinelHandler(t, &reached))

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Authorization", "Bearer not.a.valid.jwt.token")
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("want 401, got %d", rr.Code)
	}
}

func TestGetUserID_ReturnsEmptyWhenNotSet(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	if id := mw.GetUserID(req); id != "" {
		t.Errorf("expected empty string, got %q", id)
	}
}
