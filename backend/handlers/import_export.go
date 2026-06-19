package handlers

import (
	"database/sql"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	mw "github.com/yourname/finance-api/middleware"
)

// ImportExportHandler provides CSV export and import for a user's entries.
type ImportExportHandler struct {
	DB *sql.DB
}

// csvColumns is the canonical column order used by both Export and Import.
// Keeping it in one place ensures the two operations stay in sync.
var csvColumns = []string{"name", "amount", "type", "frequency", "category", "next_due"}

var allowedTypes = map[string]bool{"income": true, "expense": true}

var allowedFrequencies = map[string]bool{
	"weekly": true, "fortnightly": true, "monthly": true,
	"quarterly": true, "biannual": true, "yearly": true,
}

// ── Export ────────────────────────────────────────────────────────────────────

// Export streams all entries for the authenticated user as a CSV download.
//
// GET /api/entries/export
func (h *ImportExportHandler) Export(w http.ResponseWriter, r *http.Request) {
	userID := mw.GetUserID(r)

	rows, err := h.DB.Query(
		`SELECT name, amount, type, frequency, category, next_due
		   FROM entries
		  WHERE user_id = $1
		  ORDER BY type ASC, category ASC, name ASC`,
		userID,
	)
	if err != nil {
		jsonError(w, "server error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	filename := fmt.Sprintf("finance-export-%s.csv", time.Now().Format("2006-01-02"))
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, filename))
	w.Header().Set("X-Content-Type-Options", "nosniff")

	cw := csv.NewWriter(w)
	if err := cw.Write(csvColumns); err != nil {
		return // headers already sent; nothing useful we can do
	}

	for rows.Next() {
		var (
			name, entryType, frequency, category string
			amount                               float64
			nextDue                              time.Time
		)
		if err := rows.Scan(&name, &amount, &entryType, &frequency, &category, &nextDue); err != nil {
			continue
		}
		_ = cw.Write([]string{
			name,
			strconv.FormatFloat(amount, 'f', 2, 64),
			entryType,
			frequency,
			category,
			nextDue.Format("2006-01-02"),
		})
	}

	if rows.Err() != nil {
		return // response already started; log but don't crash
	}
	cw.Flush()
}

// ── Import ────────────────────────────────────────────────────────────────────

// ImportResult is the JSON body returned after a CSV import.
type ImportResult struct {
	Imported int           `json:"imported"`
	Skipped  int           `json:"skipped"`
	Errors   []ImportError `json:"errors"`
}

// ImportError describes a single invalid data row.
type ImportError struct {
	Row     int    `json:"row"`
	Message string `json:"message"`
}

const (
	maxImportBytes = 5 << 20 // 5 MB — generous ceiling for a finance CSV
	maxImportRows  = 1000    // guards against runaway files
)

// Import reads a multipart CSV upload and inserts valid entries atomically.
// Rows that fail validation are reported individually; valid rows are committed
// together so the result is either all-in or nothing (no partial ghost state).
//
// POST /api/entries/import
func (h *ImportExportHandler) Import(w http.ResponseWriter, r *http.Request) {
	userID := mw.GetUserID(r)

	if err := r.ParseMultipartForm(maxImportBytes); err != nil {
		jsonError(w, "file too large (max 5 MB) or malformed form", http.StatusBadRequest)
		return
	}

	f, _, err := r.FormFile("file")
	if err != nil {
		jsonError(w, "multipart field 'file' is required", http.StatusBadRequest)
		return
	}
	defer f.Close()

	cr := csv.NewReader(f)
	cr.TrimLeadingSpace = true
	cr.FieldsPerRecord = -1 // validate counts ourselves for better error messages

	// ── Validate header row ───────────────────────────────────────────────────
	headerRow, err := cr.Read()
	if err != nil {
		jsonError(w, "cannot read CSV header row", http.StatusBadRequest)
		return
	}
	colIdx, ok := buildColIndex(headerRow)
	if !ok {
		jsonError(w,
			"CSV must contain columns (any order): "+strings.Join(csvColumns, ", "),
			http.StatusBadRequest,
		)
		return
	}

	// ── Parse and validate every data row ────────────────────────────────────
	type pendingRow struct {
		name, entryType, frequency, category, nextDue string
		amount                                         float64
	}

	var (
		pending []pendingRow
		result  = ImportResult{Errors: []ImportError{}}
		rowNum  = 1 // header occupied row 1; data begins at row 2
	)

	for {
		rowNum++
		if rowNum > maxImportRows+1 {
			result.Errors = append(result.Errors, ImportError{
				Row:     rowNum,
				Message: fmt.Sprintf("row limit of %d reached; further rows were skipped", maxImportRows),
			})
			result.Skipped++
			break
		}

		rec, readErr := cr.Read()
		if readErr != nil {
			break // EOF (or unrecoverable CSV parse error — treat as end)
		}

		name, amount, entryType, frequency, category, nextDue, msg := validateRow(rec, colIdx)
		if msg != "" {
			result.Errors = append(result.Errors, ImportError{Row: rowNum, Message: msg})
			result.Skipped++
			continue
		}
		pending = append(pending, pendingRow{name, entryType, frequency, category, nextDue, amount})
	}

	// ── Insert valid rows inside a single transaction ─────────────────────────
	// All-or-nothing: if any DB insert fails (which should be extremely rare
	// after validation) we roll back so the user never sees partial state.
	if len(pending) > 0 {
		tx, txErr := h.DB.Begin()
		if txErr != nil {
			jsonError(w, "server error: cannot begin transaction", http.StatusInternalServerError)
			return
		}

		stmt, stmtErr := tx.Prepare(
			`INSERT INTO entries (user_id, name, amount, type, frequency, category, next_due)
			 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
		)
		if stmtErr != nil {
			tx.Rollback()
			jsonError(w, "server error: cannot prepare statement", http.StatusInternalServerError)
			return
		}

		for _, row := range pending {
			if _, execErr := stmt.Exec(
				userID, row.name, row.amount, row.entryType,
				row.frequency, row.category, row.nextDue,
			); execErr != nil {
				stmt.Close()
				tx.Rollback()
				jsonError(w, "server error: insert failed — no rows were imported", http.StatusInternalServerError)
				return
			}
			result.Imported++
		}
		stmt.Close()

		if commitErr := tx.Commit(); commitErr != nil {
			jsonError(w, "server error: commit failed — no rows were imported", http.StatusInternalServerError)
			return
		}
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(result)
}

// ── helpers ───────────────────────────────────────────────────────────────────

// buildColIndex maps lower-cased header names to their column index.
// Returns (nil, false) if any required column is absent.
func buildColIndex(headers []string) (map[string]int, bool) {
	idx := make(map[string]int, len(headers))
	for i, h := range headers {
		idx[strings.ToLower(strings.TrimSpace(h))] = i
	}
	for _, required := range csvColumns {
		if _, present := idx[required]; !present {
			return nil, false
		}
	}
	return idx, true
}

// validateRow parses and validates one CSV data record.
// Returns the typed fields on success, or a non-empty errMsg on failure.
func validateRow(rec []string, idx map[string]int) (
	name string,
	amount float64,
	entryType, frequency, category, nextDue string,
	errMsg string,
) {
	get := func(col string) string {
		i, ok := idx[col]
		if !ok || i >= len(rec) {
			return ""
		}
		return strings.TrimSpace(rec[i])
	}

	name = get("name")
	if name == "" {
		return "", 0, "", "", "", "", "name is required"
	}

	amtStr := get("amount")
	var parseErr error
	amount, parseErr = strconv.ParseFloat(amtStr, 64)
	if parseErr != nil || amount <= 0 {
		return "", 0, "", "", "", "", fmt.Sprintf("amount %q must be a positive number", amtStr)
	}

	entryType = get("type")
	if !allowedTypes[entryType] {
		return "", 0, "", "", "", "", fmt.Sprintf("type %q must be 'income' or 'expense'", entryType)
	}

	frequency = get("frequency")
	if !allowedFrequencies[frequency] {
		return "", 0, "", "", "", "",
			fmt.Sprintf("frequency %q must be one of: weekly, fortnightly, monthly, quarterly, biannual, yearly", frequency)
	}

	category = get("category")
	if category == "" {
		return "", 0, "", "", "", "", "category is required"
	}

	nextDue = get("next_due")
	if t, dateErr := time.Parse("2006-01-02", nextDue); dateErr != nil {
		// Also accept DD/MM/YYYY and D/MM/YYYY (common when CSV is opened and re-saved by spreadsheet apps)
		if t2, dateErr2 := time.Parse("02/01/2006", nextDue); dateErr2 != nil {
			if t3, dateErr3 := time.Parse("2/01/2006", nextDue); dateErr3 != nil {
				return "", 0, "", "", "", "", fmt.Sprintf("next_due %q must be in YYYY-MM-DD format", nextDue)
			} else {
				nextDue = t3.Format("2006-01-02")
			}
		} else {
			nextDue = t2.Format("2006-01-02")
		}
	} else {
		nextDue = t.Format("2006-01-02")
	}

	return name, amount, entryType, frequency, category, nextDue, ""
}
