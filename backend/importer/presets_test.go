package importer

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestDetect_FrolloFromHeader(t *testing.T) {
	headers, _ := readFixture(t, "frollo_sample.csv")
	p, ok := Detect(headers)
	if !ok {
		t.Fatal("expected the Frollo preset to be detected from its header row")
	}
	if p.Label != "Frollo" {
		t.Errorf("detected %q, want Frollo", p.Label)
	}
}

func TestDetect_HeaderOrderAndCaseIrrelevant(t *testing.T) {
	headers := []string{"BUDGET_CATEGORY", "Amount", "  description  ", "category_name"}
	if _, ok := Detect(headers); !ok {
		t.Error("detection should be case- and order-insensitive and tolerate padding")
	}
}

func TestDetect_UnknownFormat(t *testing.T) {
	// A generic bank export with none of Frollo's distinguishing columns.
	headers := []string{"Date", "Amount", "Description", "Balance"}
	if p, ok := Detect(headers); ok {
		t.Errorf("expected no match for an unknown format, got %q", p.Label)
	}
}

func TestMatches_RequiresEveryDetectColumn(t *testing.T) {
	// budget_category present but category_name missing — not a full match.
	headers := []string{"description", "amount", "budget_category"}
	if FrolloPreset.Map.Matches(headers) {
		t.Error("expected a partial header match to be rejected")
	}
}

func TestMatches_EmptyDetectNeverMatches(t *testing.T) {
	cm := ColumnMap{Columns: map[string]string{FieldAmount: "amount"}}
	if cm.Matches([]string{"amount"}) {
		t.Error("a map with no detect columns must not auto-match")
	}
}

// The built-in presets are defined twice: as Go values here, and as seeded
// import_sources rows in migration 007. This guards the two against drifting.
func TestFrolloPreset_MatchesMigrationSeed(t *testing.T) {
	path := filepath.Join("..", "migrations", "007_create_transactions.up.sql")
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read migration: %v", err)
	}
	sql := string(data)

	start := strings.Index(sql, "'{")
	end := strings.Index(sql, "}'::jsonb")
	if start < 0 || end < 0 || end < start {
		t.Fatal("could not locate the seeded column_map JSON in migration 007")
	}
	raw := sql[start+1 : end+1]

	var seeded ColumnMap
	if err := json.Unmarshal([]byte(raw), &seeded); err != nil {
		t.Fatalf("seeded column_map is not valid JSON: %v", err)
	}

	if !reflect.DeepEqual(seeded, FrolloPreset.Map) {
		t.Errorf("migration seed and FrolloPreset have diverged:\nseeded: %+v\ncode:   %+v", seeded, FrolloPreset.Map)
	}
}

func TestResolveCategory(t *testing.T) {
	cm := FrolloPreset.Map
	cases := []struct{ in, want string }{
		{"Groceries", "Food & Groceries"},           // aliased
		{"Subscriptions/Renewals", "Subscriptions"}, // aliased
		{"Mortgage", "Housing"},                     // aliased
		{"Cafes & Coffee", "Cafes & Coffee"},        // already an app category
		{"Round Up", "Round Up"},                    // unknown; caller decides
		{"", ""},                                    // no category at all
		{"  Groceries  ", "Food & Groceries"},       // padded
	}
	for _, c := range cases {
		if got := cm.ResolveCategory(c.in); got != c.want {
			t.Errorf("ResolveCategory(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

// The seeded map must actually work against the fixture, not merely parse.
func TestSeededPresetMapsFixture(t *testing.T) {
	headers, records := readFixture(t, "frollo_sample.csv")
	idx := BuildColIndex(headers)
	for i, rec := range records {
		if _, err := FrolloPreset.Map.MapRow(rec, idx); err != nil {
			t.Errorf("fixture row %d failed under the preset: %v", i+2, err)
		}
	}
}
