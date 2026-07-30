package importer

import "testing"

func TestParseDate(t *testing.T) {
	cases := []struct {
		name, in, format, want string
	}{
		{"iso with alias", "2026-03-15", "YYYY-MM-DD", "2026-03-15"},
		{"iso with go layout", "2026-03-15", "2006-01-02", "2026-03-15"},
		{"day first alias", "15/03/2026", "DD/MM/YYYY", "2026-03-15"},
		{"single digit day", "5/03/2026", "D/MM/YYYY", "2026-03-05"},
		{"single digit day and month", "5/3/2026", "D/M/YYYY", "2026-03-05"},
		{"month first alias", "03/15/2026", "MM/DD/YYYY", "2026-03-15"},
		{"dashed day first", "15-03-2026", "DD-MM-YYYY", "2026-03-15"},
		{"alias is case insensitive", "15/03/2026", "dd/mm/yyyy", "2026-03-15"},
		{"falls back when format wrong", "2026-03-15", "DD/MM/YYYY", "2026-03-15"},
		{"falls back with no format", "15/03/2026", "", "2026-03-15"},
		{"rfc3339", "2026-03-15T09:30:00Z", "", "2026-03-15"},
		{"surrounding space tolerated", "  2026-03-15  ", "", "2026-03-15"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, err := ParseDate(c.in, c.format)
			if err != nil {
				t.Fatalf("ParseDate(%q, %q) errored: %v", c.in, c.format, err)
			}
			if got != c.want {
				t.Errorf("ParseDate(%q, %q) = %q, want %q", c.in, c.format, got, c.want)
			}
		})
	}
}

// Australian exports are day-first; an ambiguous date must not be read as US
// month-first when the preset says DD/MM/YYYY.
func TestParseDate_AmbiguousIsDayFirst(t *testing.T) {
	got, err := ParseDate("03/06/2026", "DD/MM/YYYY")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != "2026-06-03" {
		t.Errorf("expected 3 June (day-first), got %q", got)
	}
}

func TestParseDate_Errors(t *testing.T) {
	for _, in := range []string{"", "   ", "not a date", "15/13/2026"} {
		if _, err := ParseDate(in, "DD/MM/YYYY"); err == nil {
			t.Errorf("ParseDate(%q) expected an error, got none", in)
		}
	}
}
