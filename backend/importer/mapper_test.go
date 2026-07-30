package importer

import (
	"encoding/csv"
	"os"
	"path/filepath"
	"testing"
)

// readFixture parses a testdata CSV into its header row and data records.
func readFixture(t *testing.T, name string) ([]string, [][]string) {
	t.Helper()
	f, err := os.Open(filepath.Join("..", "testdata", name))
	if err != nil {
		t.Fatalf("open fixture: %v", err)
	}
	defer f.Close()

	cr := csv.NewReader(f)
	cr.TrimLeadingSpace = true
	cr.FieldsPerRecord = -1
	records, err := cr.ReadAll()
	if err != nil {
		t.Fatalf("parse fixture: %v", err)
	}
	if len(records) < 2 {
		t.Fatalf("fixture %s has no data rows", name)
	}
	return records[0], records[1:]
}

func TestMapRow_FrolloFixture(t *testing.T) {
	headers, records := readFixture(t, "frollo_sample.csv")
	idx := BuildColIndex(headers)
	cm := FrolloPreset.Map

	rows := make([]Row, 0, len(records))
	for i, rec := range records {
		r, err := cm.MapRow(rec, idx)
		if err != nil {
			t.Fatalf("row %d failed to map: %v", i+2, err)
		}
		rows = append(rows, r)
	}

	if len(rows) != 12 {
		t.Fatalf("expected 12 mapped rows, got %d", len(rows))
	}

	t.Run("first subscription row", func(t *testing.T) {
		r := rows[0]
		if r.ExternalID != "t-0001" {
			t.Errorf("external id = %q, want the source's own id t-0001", r.ExternalID)
		}
		if r.TransactionDate != "2026-01-15" {
			t.Errorf("date = %q, want 2026-01-15", r.TransactionDate)
		}
		if r.Amount != -20.99 {
			t.Errorf("amount = %v, want -20.99", r.Amount)
		}
		if r.Currency != "AUD" {
			t.Errorf("currency = %q, want AUD", r.Currency)
		}
		if r.CategoryRaw != "Subscriptions/Renewals" || r.BucketRaw != "lifestyle" {
			t.Errorf("category/bucket raw = %q/%q", r.CategoryRaw, r.BucketRaw)
		}
		if !r.Included {
			t.Error("expected the row to be included")
		}
	})

	t.Run("quoted comma in description", func(t *testing.T) {
		if got := rows[3].Description; got != "Example Grocer, Southbank" {
			t.Errorf("description = %q, want the comma preserved", got)
		}
	})

	t.Run("credit row is positive", func(t *testing.T) {
		if rows[4].Amount != 4210.55 {
			t.Errorf("amount = %v, want +4210.55", rows[4].Amount)
		}
	})

	t.Run("source exclusion flag respected", func(t *testing.T) {
		if rows[8].Included {
			t.Error("expected included=false to map to Included == false")
		}
	})

	t.Run("decorated amount parsed", func(t *testing.T) {
		if rows[9].Amount != -1823.00 {
			t.Errorf("amount = %v, want -1823.00 from \"-$1,823.00\"", rows[9].Amount)
		}
	})

	t.Run("bucket_raw may disagree with the category", func(t *testing.T) {
		r := rows[11]
		if r.CategoryRaw != "Savings" || r.BucketRaw != "lifestyle" {
			t.Errorf("expected Savings/lifestyle to survive mapping, got %q/%q", r.CategoryRaw, r.BucketRaw)
		}
	})

	t.Run("recurring merchant shares a normalised key", func(t *testing.T) {
		a := NormalizeDescription(rows[0].Description)
		if b := NormalizeDescription(rows[2].Description); a != b {
			t.Errorf("expected the three Disney rows to share a key, got %q vs %q", a, b)
		}
		if rows[0].ExternalID == rows[2].ExternalID {
			t.Error("distinct occurrences must keep distinct external ids")
		}
	})
}

func TestMapRow_RequiredFields(t *testing.T) {
	cm := FrolloPreset.Map
	headers := []string{"transaction_date", "description", "amount"}
	idx := BuildColIndex(headers)

	cases := []struct {
		name string
		rec  []string
	}{
		{"missing date", []string{"", "Disney Plus Aus", "-20.99"}},
		{"unparseable date", []string{"not-a-date", "Disney Plus Aus", "-20.99"}},
		{"missing description", []string{"2026-03-15", "", "-20.99"}},
		{"missing amount", []string{"2026-03-15", "Disney Plus Aus", ""}},
		{"unparseable amount", []string{"2026-03-15", "Disney Plus Aus", "abc"}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if _, err := cm.MapRow(c.rec, idx); err == nil {
				t.Error("expected an error, got none")
			}
		})
	}
}

// Bank exports frequently have short trailing rows; a missing optional cell
// must map to empty rather than panic.
func TestMapRow_RaggedRowIsTolerated(t *testing.T) {
	cm := FrolloPreset.Map
	headers := []string{"transaction_date", "description", "amount", "account_name", "category_name"}
	idx := BuildColIndex(headers)

	r, err := cm.MapRow([]string{"2026-03-15", "Disney Plus Aus", "-20.99"}, idx)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if r.AccountName != "" || r.CategoryRaw != "" {
		t.Errorf("expected absent trailing cells to be empty, got %q/%q", r.AccountName, r.CategoryRaw)
	}
}

func TestMapRow_DerivesExternalIDWhenSourceHasNone(t *testing.T) {
	cm := FrolloPreset.Map
	headers := []string{"transaction_date", "description", "amount", "account_name"}
	idx := BuildColIndex(headers)
	rec := []string{"2026-03-15", "Disney Plus Aus", "-20.99", "Everyday Account"}

	r, err := cm.MapRow(rec, idx)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	want := ExternalID("2026-03-15", -20.99, "Disney Plus Aus", "Everyday Account")
	if r.ExternalID != want {
		t.Errorf("external id = %q, want the derived hash %q", r.ExternalID, want)
	}
}

// The engine already supports the formats used by the presets still to be
// added, so those become a column_map row rather than a code change.
func TestColumnMap_HeaderlessIndexed(t *testing.T) {
	// CommBank-style: no header, Date, Amount, Description, Balance.
	cm := ColumnMap{
		HasHeader:  false,
		DateFormat: "DD/MM/YYYY",
		AmountMode: AmountModeSigned,
		Columns: map[string]string{
			FieldTransactionDate: "0",
			FieldAmount:          "1",
			FieldDescription:     "2",
		},
	}
	r, err := cm.MapRow([]string{"15/03/2026", "-20.99", "Disney Plus Aus", "1378.13"}, nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if r.TransactionDate != "2026-03-15" || r.Amount != -20.99 || r.Description != "Disney Plus Aus" {
		t.Errorf("unexpected mapping: %+v", r)
	}
	if r.ExternalID == "" {
		t.Error("expected a derived external id for a source without one")
	}
}

func TestColumnMap_DebitCreditMode(t *testing.T) {
	// ubank/ING-style: separate Debit and Credit columns.
	cm := ColumnMap{
		HasHeader:  true,
		DateFormat: "DD/MM/YYYY",
		AmountMode: AmountModeDebitCredit,
		Columns: map[string]string{
			FieldTransactionDate: "date",
			FieldDescription:     "description",
			FieldDebit:           "debit",
			FieldCredit:          "credit",
		},
	}
	idx := BuildColIndex([]string{"date", "description", "debit", "credit", "balance"})

	debitRow, err := cm.MapRow([]string{"15/03/2026", "Example Grocer", "84.20", "", "100.00"}, idx)
	if err != nil {
		t.Fatalf("debit row errored: %v", err)
	}
	if debitRow.Amount != -84.20 {
		t.Errorf("debit amount = %v, want -84.20", debitRow.Amount)
	}

	creditRow, err := cm.MapRow([]string{"15/03/2026", "Salary", "", "4210.55", "100.00"}, idx)
	if err != nil {
		t.Fatalf("credit row errored: %v", err)
	}
	if creditRow.Amount != 4210.55 {
		t.Errorf("credit amount = %v, want +4210.55", creditRow.Amount)
	}
}

func TestColumnMap_UnmappedColumnsIgnored(t *testing.T) {
	cm := FrolloPreset.Map
	headers, records := readFixture(t, "frollo_sample.csv")
	idx := BuildColIndex(headers)

	// The fixture carries balance/notes columns the preset doesn't bind.
	if _, ok := idx["balance"]; !ok {
		t.Fatal("fixture should include an unmapped balance column")
	}
	if _, err := cm.MapRow(records[0], idx); err != nil {
		t.Errorf("unmapped columns should be ignored, got error: %v", err)
	}
}
