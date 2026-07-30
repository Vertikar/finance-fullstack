package importer

// Preset is a built-in, globally available column mapping. Built-ins are seeded
// into import_sources with a NULL user_id by migration 007; the definitions here
// are the source of truth and a test asserts the migration seed matches.
type Preset struct {
	Label string
	Map   ColumnMap
}

// FrolloPreset maps the Frollo aggregated export — the richest format, and the
// only one carrying its own category, bucket (budget_category), transaction id
// and inclusion flag. budget_category is what makes it unambiguously
// identifiable, so it anchors detection.
var FrolloPreset = Preset{
	Label: "Frollo",
	Map: ColumnMap{
		HasHeader:  true,
		DateFormat: "YYYY-MM-DD",
		AmountMode: AmountModeSigned,
		Detect:     []string{"description", "amount", "budget_category", "category_name"},
		Columns: map[string]string{
			FieldExternalID:      "transaction_id",
			FieldTransactionDate: "transaction_date",
			FieldDescription:     "description",
			FieldAmount:          "amount",
			FieldCurrency:        "currency",
			FieldAccountName:     "account_name",
			FieldProviderName:    "provider_name",
			FieldCategoryRaw:     "category_name",
			FieldBucketRaw:       "budget_category",
			FieldTransactionType: "transaction_type",
			FieldIncluded:        "included",
		},
		// Frollo labels that differ from ours (scope §3). Everything else it
		// emits either already matches a seeded category name or is noise the
		// caller drops.
		CategoryAliases: map[string]string{
			"Groceries":                "Food & Groceries",
			"Healthcare/Medical":       "Health",
			"Mortgage":                 "Housing",
			"Clothing/Shoes":           "Clothing",
			"Subscriptions/Renewals":   "Subscriptions",
			"Entertainment/Recreation": "Entertainment",
			"Salary/Regular Income":    "Salary",
			"Interest Income":          "Investment",
		},
	},
}

// BuiltinPresets is ordered: Detect returns the first match, so more specific
// formats must come before more permissive ones.
//
// Presets for raw CommBank, Up, ubank, ING Direct and AustralianSuper exports
// are intentionally absent until their real layouts can be confirmed against an
// actual export — the mapper engine already supports what they need (headerless
// files, debit/credit column merging, per-format date layouts), so adding one is
// a column_map row, not a code change.
var BuiltinPresets = []Preset{FrolloPreset}

// Detect picks the first built-in preset whose detection columns are all
// present in the header row.
func Detect(headers []string) (Preset, bool) {
	for _, p := range BuiltinPresets {
		if p.Map.Matches(headers) {
			return p, true
		}
	}
	return Preset{}, false
}
