package importer

import "testing"

func TestParseSignedAmount(t *testing.T) {
	cases := []struct {
		name, in string
		want     float64
	}{
		{"plain negative", "-20.99", -20.99},
		{"plain positive", "4210.55", 4210.55},
		{"thousands separator", "1823.00", 1823.00},
		{"decorated negative", "-$1,823.00", -1823.00},
		{"dollar before minus", "$-20.99", -20.99},
		{"parentheses mean negative", "(20.99)", -20.99},
		{"parentheses with decoration", "($1,823.00)", -1823.00},
		{"currency suffix stripped", "1,000.00 AUD", 1000.00},
		{"zero", "0", 0},
		{"surrounding space", "  -12.30  ", -12.30},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, err := parseSignedAmount(c.in)
			if err != nil {
				t.Fatalf("parseSignedAmount(%q) errored: %v", c.in, err)
			}
			if got != c.want {
				t.Errorf("parseSignedAmount(%q) = %v, want %v", c.in, got, c.want)
			}
		})
	}
}

func TestParseSignedAmount_Errors(t *testing.T) {
	for _, in := range []string{"", "   ", "abc", "-", "$"} {
		if _, err := parseSignedAmount(in); err == nil {
			t.Errorf("parseSignedAmount(%q) expected an error, got none", in)
		}
	}
}

func TestMergeDebitCredit(t *testing.T) {
	cases := []struct {
		name, debit, credit string
		want                float64
	}{
		{"debit only is negative", "84.20", "", -84.20},
		{"credit only is positive", "", "4210.55", 4210.55},
		{"already signed debit still negative", "-84.20", "", -84.20},
		{"decorated debit", "$1,823.00", "", -1823.00},
		{"blank credit column ignored", "12.30", "   ", -12.30},
		{"both populated nets out", "100.00", "30.00", -70.00},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, err := mergeDebitCredit(c.debit, c.credit)
			if err != nil {
				t.Fatalf("mergeDebitCredit(%q,%q) errored: %v", c.debit, c.credit, err)
			}
			if got != c.want {
				t.Errorf("mergeDebitCredit(%q,%q) = %v, want %v", c.debit, c.credit, got, c.want)
			}
		})
	}
}

func TestMergeDebitCredit_Errors(t *testing.T) {
	if _, err := mergeDebitCredit("", ""); err == nil {
		t.Error("expected an error when neither column has a value")
	}
	if _, err := mergeDebitCredit("abc", ""); err == nil {
		t.Error("expected an error for an unparseable debit")
	}
}

func TestParseBoolDefaultTrue(t *testing.T) {
	falsey := []string{"false", "FALSE", "0", "no", "N", "f"}
	for _, s := range falsey {
		if parseBoolDefaultTrue(s) {
			t.Errorf("parseBoolDefaultTrue(%q) = true, want false", s)
		}
	}
	// Anything else — including blank, which is what a missing column yields —
	// means include.
	truthy := []string{"true", "1", "yes", "", "   ", "anything"}
	for _, s := range truthy {
		if !parseBoolDefaultTrue(s) {
			t.Errorf("parseBoolDefaultTrue(%q) = false, want true", s)
		}
	}
}
