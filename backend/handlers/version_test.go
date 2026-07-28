package handlers_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"runtime"
	"testing"

	"github.com/vertikar/finance-api/handlers"
)

// VersionHandler has no DB, so unlike every other handler test here there is no
// sqlmock to set up — and no withUserID, since the handler never reads a user.

func decodeVersion(t *testing.T, rr *httptest.ResponseRecorder) map[string]string {
	t.Helper()
	var got map[string]string
	if err := json.NewDecoder(rr.Body).Decode(&got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	return got
}

func TestVersion_Get_EchoesInjectedBuildInfo(t *testing.T) {
	h := &handlers.VersionHandler{
		Version:   "v1.2.3",
		Commit:    "f280cb6",
		BuildTime: "2026-07-27T02:14:09Z",
	}

	rr := httptest.NewRecorder()
	h.Get(rr, httptest.NewRequest(http.MethodGet, "/api/version", nil))

	if rr.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", rr.Code)
	}
	if ct := rr.Header().Get("Content-Type"); ct != "application/json" {
		t.Errorf("want Content-Type application/json, got %q", ct)
	}

	got := decodeVersion(t, rr)
	for field, want := range map[string]string{
		"version":    "v1.2.3",
		"commit":     "f280cb6",
		"build_time": "2026-07-27T02:14:09Z",
	} {
		if got[field] != want {
			t.Errorf("%s: want %q, got %q", field, want, got[field])
		}
	}
}

func TestVersion_Get_ReportsGoVersion(t *testing.T) {
	h := &handlers.VersionHandler{Version: "v1.2.3", Commit: "f280cb6"}

	rr := httptest.NewRecorder()
	h.Get(rr, httptest.NewRequest(http.MethodGet, "/api/version", nil))

	if got := decodeVersion(t, rr)["go_version"]; got != runtime.Version() {
		t.Errorf("go_version: want %q, got %q", runtime.Version(), got)
	}
}

// A binary built without -ldflags -X (go run, go test, or a docker build with no
// --build-arg) must still produce a meaningful response rather than empty
// strings the dialog would render as blank rows.
func TestVersion_Get_ZeroValueFallsBackToDevUnknown(t *testing.T) {
	rr := httptest.NewRecorder()
	(&handlers.VersionHandler{}).Get(rr, httptest.NewRequest(http.MethodGet, "/api/version", nil))

	if rr.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", rr.Code)
	}

	got := decodeVersion(t, rr)
	if got["version"] != "dev" {
		t.Errorf("version: want %q, got %q", "dev", got["version"])
	}
	if got["commit"] != "unknown" {
		t.Errorf("commit: want %q, got %q", "unknown", got["commit"])
	}
	// build_time has no sensible placeholder — the frontend renders the dash.
	if got["build_time"] != "" {
		t.Errorf("build_time: want empty, got %q", got["build_time"])
	}
}
