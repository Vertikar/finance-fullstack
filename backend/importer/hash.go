package importer

import (
	"crypto/sha256"
	"encoding/hex"
	"strconv"
	"strings"
)

// ExternalID derives a stable identifier for a transaction that its source did
// not give one (most raw bank exports). Re-importing an overlapping date range
// then produces identical ids, so the unique index on
// (user_id, external_id) turns the duplicate rows into no-ops.
//
// The description is normalised first so incidental formatting differences
// between two exports of the same transaction don't defeat the dedup. Amount is
// fixed to 2dp for the same reason ("-20.9" and "-20.90" must agree).
//
// date must already be ISO (YYYY-MM-DD); ParseDate guarantees that.
func ExternalID(date string, amount float64, description, account string) string {
	parts := []string{
		date,
		strconv.FormatFloat(amount, 'f', 2, 64),
		NormalizeDescription(description),
		NormalizeDescription(account),
	}
	sum := sha256.Sum256([]byte(strings.Join(parts, "|")))
	return hex.EncodeToString(sum[:])
}
