package handlers

import (
	"database/sql"
	"encoding/json"
	"net/http"
)

type CategoriesHandler struct {
	DB *sql.DB
}

// Category is a global (non-user-scoped) reference record. `Bucket` is the
// higher-level grouping (income/living/lifestyle/goals) that entries and
// transactions inherit via their category. `Color` is used by the frontend for
// the category pie and bucket breakdown.
type Category struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Type      string `json:"type"`
	Bucket    string `json:"bucket"`
	Color     string `json:"color"`
	SortOrder int    `json:"sort_order"`
}

// List returns the full category catalogue. It is global reference data, so
// there is no user_id filter — every authenticated user sees the same list.
func (h *CategoriesHandler) List(w http.ResponseWriter, r *http.Request) {
	rows, err := h.DB.Query(
		`SELECT id, name, type, bucket, color, sort_order
		 FROM categories ORDER BY sort_order ASC, name ASC`,
	)
	if err != nil {
		jsonError(w, "server error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	categories := []Category{}
	for rows.Next() {
		var c Category
		if err := rows.Scan(&c.ID, &c.Name, &c.Type, &c.Bucket, &c.Color, &c.SortOrder); err != nil {
			jsonError(w, "server error", http.StatusInternalServerError)
			return
		}
		categories = append(categories, c)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(categories)
}
