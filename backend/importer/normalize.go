// Package importer maps raw bank-export CSV rows onto transaction records.
// It is deliberately free of HTTP and database concerns so the mapping rules
// can be unit-tested directly, and so the recurring-detection phase can reuse
// the same normalisation.
package importer

import (
	"strings"
	"unicode"
)

// NormalizeDescription reduces a bank description to a stable comparison key:
// lower-cased, with digits and punctuation dropped and whitespace collapsed.
//
// This strips the volatile parts of a merchant line — reference numbers, card
// suffixes, dates — so that repeated charges from the same merchant collapse to
// one key. "Direct Debit RACV Insurance 4412" and "DIRECT DEBIT RACV INSURANCE
// 9987" both become "direct debit racv insurance".
//
// It is the single source of truth for description normalisation: the
// external_id dedup hash and (later) recurring-payment grouping both use it, so
// the two can never disagree about what counts as "the same" description.
func NormalizeDescription(s string) string {
	var b strings.Builder
	b.Grow(len(s))
	for _, r := range strings.ToLower(s) {
		switch {
		case unicode.IsLetter(r):
			b.WriteRune(r)
		default:
			// Digits, punctuation and existing whitespace all become a single
			// separator; the Fields/Join below collapses runs of them.
			b.WriteRune(' ')
		}
	}
	return strings.Join(strings.Fields(b.String()), " ")
}
