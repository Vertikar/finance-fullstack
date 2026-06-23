//go:build race

package handlers_test

// raceEnabled is true when the test binary is built with -race. Both CI paths
// (the native Go job and the Docker test image) run with -race, whereas the
// local `make test-backend` target does not — so this is a reliable signal for
// "running in a CI-style environment" used to skip a harness-flaky test.
const raceEnabled = true
