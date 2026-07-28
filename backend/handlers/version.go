package handlers

import (
	"encoding/json"
	"net/http"
	"runtime"
)

// Fallbacks for build metadata that was never injected — a `go run` or `go test`
// binary, or a `docker build` with no --build-arg. Returning these rather than
// empty strings keeps the response shape honest: every field always says
// something, so the About dialog never renders a blank row.
const (
	defaultVersion = "dev"
	defaultCommit  = "unknown"
)

// VersionHandler reports the build the API binary was produced from. Unlike the
// other handlers it has no DB field — the values are stamped in at link time
// (see backend/Dockerfile) and passed in explicitly from main, the same rule the
// JWT secret follows: no handler reads a package global.
type VersionHandler struct {
	Version   string
	Commit    string
	BuildTime string
}

type versionResponse struct {
	Version   string `json:"version"`
	Commit    string `json:"commit"`
	BuildTime string `json:"build_time"`
	GoVersion string `json:"go_version"`
}

// Get returns the API's version, commit, build time and Go toolchain version.
//
// GET /api/version →
//
//	{"version":"v1.1.0","commit":"f280cb6","build_time":"2026-07-27T02:14:09Z","go_version":"go1.22.5"}
//
// Mounted inside the authenticated group: the dialog that consumes it is only
// reachable when signed in, and there's no reason to publish the deployed commit
// hash to anonymous callers. /health stays public for container healthchecks.
func (h *VersionHandler) Get(w http.ResponseWriter, r *http.Request) {
	resp := versionResponse{
		Version:   h.Version,
		Commit:    h.Commit,
		BuildTime: h.BuildTime,
		GoVersion: runtime.Version(),
	}
	if resp.Version == "" {
		resp.Version = defaultVersion
	}
	if resp.Commit == "" {
		resp.Commit = defaultCommit
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}
