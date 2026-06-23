package main

import (
	"strings"
	"testing"
)

// TestValidateJWTSecret covers the fail-fast startup guard. An empty or short
// secret must be rejected; a secret of at least 32 characters must be accepted.
func TestValidateJWTSecret(t *testing.T) {
	cases := []struct {
		name    string
		secret  string
		wantErr bool
	}{
		{"empty is rejected", "", true},
		{"short word is rejected", "tooshort", true},
		{"31 chars is rejected", strings.Repeat("a", 31), true},
		{"exactly 32 chars is accepted", strings.Repeat("a", 32), false},
		{"long secret is accepted", "this-is-a-perfectly-fine-jwt-secret-value", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := validateJWTSecret(tc.secret)
			if tc.wantErr && err == nil {
				t.Errorf("validateJWTSecret(%q): expected error, got nil", tc.secret)
			}
			if !tc.wantErr && err != nil {
				t.Errorf("validateJWTSecret(%q): expected no error, got %v", tc.secret, err)
			}
		})
	}
}
