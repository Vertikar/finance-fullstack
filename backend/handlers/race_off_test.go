//go:build !race

package handlers_test

// raceEnabled is false in plain (non -race) builds, e.g. the local
// `make test-backend` target, where the harness-flaky test runs normally.
const raceEnabled = false
