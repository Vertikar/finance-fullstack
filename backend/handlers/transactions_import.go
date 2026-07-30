package handlers

import (
	"database/sql"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/vertikar/finance-api/importer"
	mw "github.com/vertikar/finance-api/middleware"
)

type TransactionsHandler struct {
	DB *sql.DB
}

// TransactionImportResult is the JSON body returned after a transaction import.
type TransactionImportResult struct {
	BatchID string `json:"batch_id"`
	// Source is the column mapping that was used, echoed so the caller can
	// confirm auto-detection picked what they expected.
	Source            string        `json:"source"`
	Imported          int           `json:"imported"`
	SkippedDuplicates int           `json:"skipped_duplicates"`
	Errors            []ImportError `json:"errors"`
}

const (
	// Real exports run to thousands of rows — a year of one household's
	// transactions was ~3,100 — so these ceilings are far higher than the
	// recurring-entries importer's.
	maxTransactionBytes = 10 << 20 // 10 MB
	maxTransactionRows  = 20000
)

// Import ingests a bank-export CSV into the transactions table.
//
// The column mapping is resolved in priority order: an inline column_map form
// field, then a saved source_id, then auto-detection from the header row.
// Rows that fail to map are reported per-row and skipped; rows already imported
// (same user + external_id) are counted as duplicates rather than erroring, so
// re-importing an overlapping export is safe.
func (h *TransactionsHandler) Import(w http.ResponseWriter, r *http.Request) {
	userID := mw.GetUserID(r)

	// MaxBytesReader is a real ceiling; ParseMultipartForm's argument is only a
	// memory hint and silently spills to disk beyond it.
	r.Body = http.MaxBytesReader(w, r.Body, maxTransactionBytes)
	if err := r.ParseMultipartForm(maxTransactionBytes); err != nil {
		jsonError(w, "file too large (max 10 MB) or malformed form", http.StatusBadRequest)
		return
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		jsonError(w, "multipart field 'file' is required", http.StatusBadRequest)
		return
	}
	defer file.Close()

	filename := ""
	if header != nil {
		filename = header.Filename
	}

	cr := csv.NewReader(file)
	cr.TrimLeadingSpace = true
	cr.FieldsPerRecord = -1 // ragged rows are handled per-field by the mapper

	// ── Resolve the column mapping ───────────────────────────────────────────
	var (
		colMap     importer.ColumnMap
		sourceID   = strings.TrimSpace(r.FormValue("source_id"))
		inlineMap  = strings.TrimSpace(r.FormValue("column_map"))
		sourceName string
	)

	switch {
	case inlineMap != "":
		if err := json.Unmarshal([]byte(inlineMap), &colMap); err != nil {
			jsonError(w, "column_map is not valid JSON", http.StatusBadRequest)
			return
		}
		sourceName = "inline"
	case sourceID != "":
		label, cm, err := h.loadSource(sourceID, userID)
		if err == sql.ErrNoRows {
			jsonError(w, "import source not found", http.StatusNotFound)
			return
		} else if err != nil {
			jsonError(w, "server error", http.StatusInternalServerError)
			return
		}
		colMap, sourceName = cm, label
	}

	// The header row is consumed here so the row loop only sees data. A
	// headerless mapping addresses columns by index, so it keeps its first row.
	var headers []string
	if colMap.Columns == nil || colMap.HasHeader {
		headers, err = cr.Read()
		if err != nil {
			jsonError(w, "cannot read CSV header row", http.StatusBadRequest)
			return
		}
	}

	// No mapping named: fall back to auto-detection from the header.
	if colMap.Columns == nil {
		preset, ok := importer.Detect(headers)
		if !ok {
			jsonError(w,
				"could not recognise this CSV format — pass source_id or column_map",
				http.StatusBadRequest)
			return
		}
		colMap, sourceName = preset.Map, preset.Label
		if err := h.lookupSourceID(preset.Label, &sourceID); err != nil && err != sql.ErrNoRows {
			jsonError(w, "server error", http.StatusInternalServerError)
			return
		}
	}
	colIdx := importer.BuildColIndex(headers)

	// Category defaults drive the bucket pre-fill below.
	catBuckets, err := h.categoryBuckets()
	if err != nil {
		jsonError(w, "server error", http.StatusInternalServerError)
		return
	}

	// ── Parse and map every data row ─────────────────────────────────────────
	type pendingRow struct {
		row      importer.Row
		category string
		bucket   string
	}

	var (
		pending []pendingRow
		result  = TransactionImportResult{Source: sourceName, Errors: []ImportError{}}
		rowNum  = 1 // the header occupied row 1
	)
	if !colMap.HasHeader {
		rowNum = 0
	}

	for {
		rowNum++
		if len(pending)+len(result.Errors) >= maxTransactionRows {
			result.Errors = append(result.Errors, ImportError{
				Row:     rowNum,
				Message: fmt.Sprintf("row limit of %d reached; further rows were skipped", maxTransactionRows),
			})
			break
		}

		rec, readErr := cr.Read()
		if readErr != nil {
			break // EOF, or an unrecoverable parse error — treat as end of file
		}
		if len(rec) == 0 {
			continue
		}

		row, mapErr := colMap.MapRow(rec, colIdx)
		if mapErr != nil {
			result.Errors = append(result.Errors, ImportError{Row: rowNum, Message: mapErr.Error()})
			continue
		}

		// Keep the source's own category only when it names a category we know;
		// anything else is left for the review step to assign.
		category := colMap.ResolveCategory(row.CategoryRaw)
		defaultBucket, known := catBuckets[category]
		if !known {
			category = ""
		}

		// Preserve the source's bucket placement when it disagrees with the
		// category's default — that disagreement is information, and the user
		// can still change it later.
		bucket := ""
		if known && isValidBucket(row.BucketRaw) && row.BucketRaw != defaultBucket {
			bucket = row.BucketRaw
		}

		pending = append(pending, pendingRow{row: row, category: category, bucket: bucket})
	}

	// ── Persist the batch and its rows in one transaction ────────────────────
	tx, err := h.DB.BeginTx(r.Context(), nil)
	if err != nil {
		jsonError(w, "server error: cannot begin transaction", http.StatusInternalServerError)
		return
	}
	// No-op once the transaction is committed; guarantees we never leak an open
	// transaction on an early return.
	defer tx.Rollback()

	var batchID string
	if err := tx.QueryRow(
		`INSERT INTO import_batches (user_id, source_id, filename, row_count)
		 VALUES ($1,$2,$3,$4) RETURNING id`,
		userID, nullableStr(&sourceID), nullableStr(&filename), len(pending),
	).Scan(&batchID); err != nil {
		jsonError(w, "server error: cannot record import batch", http.StatusInternalServerError)
		return
	}

	stmt, err := tx.Prepare(
		`INSERT INTO transactions
		   (user_id, import_batch_id, external_id, description, amount, currency,
		    transaction_date, account_name, provider_name, category_raw, bucket_raw,
		    category, bucket, transaction_type, included)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
		 ON CONFLICT (user_id, external_id) WHERE external_id IS NOT NULL DO NOTHING`,
	)
	if err != nil {
		jsonError(w, "server error: cannot prepare statement", http.StatusInternalServerError)
		return
	}
	defer stmt.Close()

	for _, p := range pending {
		res, execErr := stmt.Exec(
			userID, batchID, p.row.ExternalID, p.row.Description, p.row.Amount,
			p.row.Currency, p.row.TransactionDate,
			nullableStr(&p.row.AccountName), nullableStr(&p.row.ProviderName),
			nullableStr(&p.row.CategoryRaw), nullableStr(&p.row.BucketRaw),
			nullableStr(&p.category), nullableStr(&p.bucket),
			nullableStr(&p.row.TransactionType), p.row.Included,
		)
		if execErr != nil {
			jsonError(w, "server error: insert failed — no rows were imported", http.StatusInternalServerError)
			return
		}
		// A partial-index conflict inserts nothing: the row is already ours.
		if n, _ := res.RowsAffected(); n == 0 {
			result.SkippedDuplicates++
			continue
		}
		result.Imported++
	}

	// row_count reflects what actually landed, not what was offered.
	if _, err := tx.Exec(
		`UPDATE import_batches SET row_count = $1 WHERE id = $2`,
		result.Imported, batchID,
	); err != nil {
		jsonError(w, "server error: cannot finalise import batch", http.StatusInternalServerError)
		return
	}

	if err := tx.Commit(); err != nil {
		jsonError(w, "server error: commit failed — no rows were imported", http.StatusInternalServerError)
		return
	}
	result.BatchID = batchID

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(result)
}

// loadSource fetches a column mapping the caller named: either one of their own
// saved sources or a built-in (user_id IS NULL).
func (h *TransactionsHandler) loadSource(sourceID, userID string) (string, importer.ColumnMap, error) {
	var (
		label string
		raw   []byte
		cm    importer.ColumnMap
	)
	err := h.DB.QueryRow(
		`SELECT label, column_map FROM import_sources
		 WHERE id = $1 AND (user_id IS NULL OR user_id = $2)`,
		sourceID, userID,
	).Scan(&label, &raw)
	if err != nil {
		return "", cm, err
	}
	if err := json.Unmarshal(raw, &cm); err != nil {
		return "", cm, err
	}
	return label, cm, nil
}

// lookupSourceID resolves an auto-detected preset label back to its seeded row
// so the batch records which source produced it.
func (h *TransactionsHandler) lookupSourceID(label string, dest *string) error {
	return h.DB.QueryRow(
		`SELECT id FROM import_sources WHERE label = $1 AND user_id IS NULL`, label,
	).Scan(dest)
}

// categoryBuckets returns each known category's default bucket.
func (h *TransactionsHandler) categoryBuckets() (map[string]string, error) {
	rows, err := h.DB.Query(`SELECT name, bucket FROM categories`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	buckets := map[string]string{}
	for rows.Next() {
		var name, bucket string
		if err := rows.Scan(&name, &bucket); err != nil {
			return nil, err
		}
		buckets[name] = bucket
	}
	return buckets, rows.Err()
}

// isValidBucket guards the DB CHECK constraint: a source's own bucket label is
// only usable if it happens to be one of ours.
func isValidBucket(b string) bool {
	switch b {
	case "income", "living", "lifestyle", "goals":
		return true
	}
	return false
}
