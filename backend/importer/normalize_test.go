package importer

import "testing"

func TestNormalizeDescription(t *testing.T) {
	cases := []struct {
		name, in, want string
	}{
		{"lowercases", "Disney Plus Aus", "disney plus aus"},
		{"strips digits", "LN REPAY 885202194", "ln repay"},
		{"strips punctuation", "PAYPAL *AUSTRALIA-DD", "paypal australia dd"},
		{"collapses whitespace", "  Yarra   Valley\tWater  ", "yarra valley water"},
		{"empty stays empty", "", ""},
		{"digits only collapse away", "1234 5678", ""},
		{"keeps accented letters", "Café Crème", "café crème"},
		{"card suffix dropped", "Woolworths 4412", "woolworths"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := NormalizeDescription(c.in); got != c.want {
				t.Errorf("NormalizeDescription(%q) = %q, want %q", c.in, got, c.want)
			}
		})
	}
}

// The whole point of normalisation is that superficially different renderings
// of the same merchant collapse to one key.
func TestNormalizeDescription_CollapsesVariants(t *testing.T) {
	variants := []string{
		"Direct Debit RACV Insurance 4412",
		"DIRECT DEBIT RACV INSURANCE 9987",
		"direct debit  racv insurance",
	}
	first := NormalizeDescription(variants[0])
	for _, v := range variants[1:] {
		if got := NormalizeDescription(v); got != first {
			t.Errorf("expected %q to normalise to %q, got %q", v, first, got)
		}
	}
}
