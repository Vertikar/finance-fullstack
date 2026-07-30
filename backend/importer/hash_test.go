package importer

import "testing"

func TestExternalID_IsDeterministic(t *testing.T) {
	a := ExternalID("2026-03-15", -20.99, "Disney Plus Aus", "Everyday Account")
	b := ExternalID("2026-03-15", -20.99, "Disney Plus Aus", "Everyday Account")
	if a != b {
		t.Fatalf("same inputs produced different ids: %q vs %q", a, b)
	}
	if len(a) != 64 {
		t.Errorf("expected a 64-char sha256 hex digest, got %d chars", len(a))
	}
}

// Re-importing an overlapping export must dedup, so incidental formatting
// differences in the description must not change the id.
func TestExternalID_IgnoresDescriptionFormatting(t *testing.T) {
	a := ExternalID("2026-03-15", -20.99, "Disney Plus Aus 4412", "Everyday Account")
	b := ExternalID("2026-03-15", -20.99, "DISNEY  PLUS   AUS 9987", "Everyday Account")
	if a != b {
		t.Errorf("expected normalised descriptions to hash equal, got %q vs %q", a, b)
	}
}

func TestExternalID_AmountPrecisionNormalised(t *testing.T) {
	if ExternalID("2026-03-15", -20.9, "x", "y") != ExternalID("2026-03-15", -20.90, "x", "y") {
		t.Error("expected -20.9 and -20.90 to hash equal")
	}
}

func TestExternalID_DistinctInputsDiffer(t *testing.T) {
	base := ExternalID("2026-03-15", -20.99, "Disney Plus Aus", "Everyday Account")
	cases := map[string]string{
		"different date":    ExternalID("2026-03-16", -20.99, "Disney Plus Aus", "Everyday Account"),
		"different amount":  ExternalID("2026-03-15", -21.99, "Disney Plus Aus", "Everyday Account"),
		"different desc":    ExternalID("2026-03-15", -20.99, "Netflix", "Everyday Account"),
		"different account": ExternalID("2026-03-15", -20.99, "Disney Plus Aus", "Savings Account"),
		"sign flip":         ExternalID("2026-03-15", 20.99, "Disney Plus Aus", "Everyday Account"),
	}
	for name, got := range cases {
		if got == base {
			t.Errorf("%s: expected a different id, got the same digest", name)
		}
	}
}
