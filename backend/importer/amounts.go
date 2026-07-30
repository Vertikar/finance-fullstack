package importer

import (
	"fmt"
	"math"
	"strconv"
	"strings"
)

// Amount modes understood by a column_map.
const (
	// AmountModeSigned reads one column holding a signed value; negative is
	// money out.
	AmountModeSigned = "signed"
	// AmountModeDebitCredit reads two columns (debit, credit) and merges them
	// into a signed value. Used by ubank and ING-style exports.
	AmountModeDebitCredit = "debit_credit"
)

// amountCleaner strips the decoration banks put around numbers so that
// "-$1,823.00" and "1823.00" both parse.
var amountCleaner = strings.NewReplacer(
	"$", "", ",", "", " ", "", " ", "", "AUD", "",
)

// parseSignedAmount parses one decorated numeric string. Values wrapped in
// parentheses are negative, following the accounting convention several
// exporters use instead of a minus sign.
func parseSignedAmount(s string) (float64, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0, fmt.Errorf("amount is empty")
	}

	negative := false
	if strings.HasPrefix(s, "(") && strings.HasSuffix(s, ")") {
		negative = true
		s = strings.TrimSuffix(strings.TrimPrefix(s, "("), ")")
	}

	cleaned := amountCleaner.Replace(s)
	if cleaned == "" || cleaned == "-" {
		return 0, fmt.Errorf("amount %q is not a number", s)
	}

	v, err := strconv.ParseFloat(cleaned, 64)
	if err != nil {
		return 0, fmt.Errorf("amount %q is not a number", s)
	}
	if negative {
		v = -math.Abs(v)
	}
	return v, nil
}

// mergeDebitCredit combines a debit and a credit column into one signed amount:
// debits are money out (negative), credits money in (positive). Either side may
// be blank — that is the normal case, since a row is one or the other. Both
// sides are taken as magnitudes, so an export that already signs its debits
// still yields the right result.
func mergeDebitCredit(debit, credit string) (float64, error) {
	var d, c float64
	if strings.TrimSpace(debit) != "" {
		v, err := parseSignedAmount(debit)
		if err != nil {
			return 0, err
		}
		d = math.Abs(v)
	}
	if strings.TrimSpace(credit) != "" {
		v, err := parseSignedAmount(credit)
		if err != nil {
			return 0, err
		}
		c = math.Abs(v)
	}
	if d == 0 && c == 0 {
		return 0, fmt.Errorf("row has neither a debit nor a credit amount")
	}
	return c - d, nil
}
