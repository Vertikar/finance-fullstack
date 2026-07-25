package importer

import (
	"fmt"
	"strconv"
	"strings"
)

// Canonical field names a column_map can bind to a source column. These are the
// keys of ColumnMap.Columns.
const (
	FieldExternalID      = "external_id"
	FieldTransactionDate = "transaction_date"
	FieldDescription     = "description"
	FieldAmount          = "amount"
	FieldDebit           = "debit"
	FieldCredit          = "credit"
	FieldCurrency        = "currency"
	FieldAccountName     = "account_name"
	FieldProviderName    = "provider_name"
	FieldCategoryRaw     = "category_raw"
	FieldBucketRaw       = "bucket_raw"
	FieldTransactionType = "transaction_type"
	FieldIncluded        = "included"
)

// DefaultCurrency is applied when an export has no currency column.
const DefaultCurrency = "AUD"

// ColumnMap describes how one export format's columns map onto our transaction
// fields. It is stored as JSONB in import_sources.column_map so a new bank can
// be supported by adding a row, without a code change.
//
// When HasHeader is false the Columns values are zero-based column indices
// ("0", "1", …) rather than header names — CommBank-style exports ship no
// header row.
type ColumnMap struct {
	HasHeader  bool              `json:"has_header"`
	DateFormat string            `json:"date_format"`
	AmountMode string            `json:"amount_mode"`
	Detect     []string          `json:"detect"`
	Columns    map[string]string `json:"columns"`
	// CategoryAliases translates the source's own category labels into app
	// category names (scope §3), e.g. Frollo's "Groceries" -> "Food &
	// Groceries". Labels with no alias are passed through unchanged; the caller
	// decides whether the result is a category it recognises.
	CategoryAliases map[string]string `json:"category_aliases,omitempty"`
}

// ResolveCategory maps a source category label to an app category name. It
// returns "" when the source had no category at all.
func (cm ColumnMap) ResolveCategory(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	if mapped, ok := cm.CategoryAliases[raw]; ok {
		return mapped
	}
	return raw
}

// Row is one mapped transaction, ready to persist. Optional fields are empty
// strings when the source doesn't provide them; the handler converts those to
// SQL NULL.
type Row struct {
	ExternalID      string
	Description     string
	Amount          float64
	Currency        string
	TransactionDate string // ISO YYYY-MM-DD
	AccountName     string
	ProviderName    string
	CategoryRaw     string
	BucketRaw       string
	TransactionType string
	Included        bool
}

// BuildColIndex maps lower-cased, trimmed header names to their position.
func BuildColIndex(headers []string) map[string]int {
	idx := make(map[string]int, len(headers))
	for i, h := range headers {
		idx[strings.ToLower(strings.TrimSpace(h))] = i
	}
	return idx
}

// value returns the trimmed cell for a canonical field, or "" when the field is
// unmapped, the source column is absent, or the row is short. Ragged rows are
// common in bank exports, so a missing trailing cell is treated as empty rather
// than as an error.
func (cm ColumnMap) value(field string, rec []string, idx map[string]int) string {
	src, ok := cm.Columns[field]
	if !ok || src == "" {
		return ""
	}

	pos := -1
	if cm.HasHeader {
		if i, found := idx[strings.ToLower(strings.TrimSpace(src))]; found {
			pos = i
		}
	} else if i, err := strconv.Atoi(strings.TrimSpace(src)); err == nil {
		pos = i
	}

	if pos < 0 || pos >= len(rec) {
		return ""
	}
	return strings.TrimSpace(rec[pos])
}

// Matches reports whether a header row satisfies this map's detection columns,
// which is how a preset is auto-selected when the caller doesn't name one.
func (cm ColumnMap) Matches(headers []string) bool {
	if len(cm.Detect) == 0 {
		return false
	}
	idx := BuildColIndex(headers)
	for _, want := range cm.Detect {
		if _, ok := idx[strings.ToLower(strings.TrimSpace(want))]; !ok {
			return false
		}
	}
	return true
}

// MapRow converts one CSV record into a Row. idx comes from BuildColIndex over
// the header row (and is ignored for headerless maps).
func (cm ColumnMap) MapRow(rec []string, idx map[string]int) (Row, error) {
	var r Row

	date, err := ParseDate(cm.value(FieldTransactionDate, rec, idx), cm.DateFormat)
	if err != nil {
		return r, err
	}
	r.TransactionDate = date

	r.Description = cm.value(FieldDescription, rec, idx)
	if r.Description == "" {
		return r, fmt.Errorf("description is required")
	}

	switch cm.AmountMode {
	case AmountModeDebitCredit:
		amount, err := mergeDebitCredit(
			cm.value(FieldDebit, rec, idx),
			cm.value(FieldCredit, rec, idx),
		)
		if err != nil {
			return r, err
		}
		r.Amount = amount
	default: // AmountModeSigned
		amount, err := parseSignedAmount(cm.value(FieldAmount, rec, idx))
		if err != nil {
			return r, err
		}
		r.Amount = amount
	}

	r.Currency = strings.ToUpper(cm.value(FieldCurrency, rec, idx))
	if r.Currency == "" {
		r.Currency = DefaultCurrency
	}

	r.AccountName = cm.value(FieldAccountName, rec, idx)
	r.ProviderName = cm.value(FieldProviderName, rec, idx)
	r.CategoryRaw = cm.value(FieldCategoryRaw, rec, idx)
	r.BucketRaw = cm.value(FieldBucketRaw, rec, idx)
	r.TransactionType = cm.value(FieldTransactionType, rec, idx)
	r.Included = parseBoolDefaultTrue(cm.value(FieldIncluded, rec, idx))

	// Sources without their own id get a deterministic one so re-imports dedup.
	r.ExternalID = cm.value(FieldExternalID, rec, idx)
	if r.ExternalID == "" {
		r.ExternalID = ExternalID(r.TransactionDate, r.Amount, r.Description, r.AccountName)
	}

	return r, nil
}

// parseBoolDefaultTrue reads an exporter's inclusion flag. Anything
// unrecognised — including a blank cell or a missing column — means "include",
// so a source without the concept imports everything.
func parseBoolDefaultTrue(s string) bool {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "false", "0", "no", "n", "f":
		return false
	default:
		return true
	}
}
