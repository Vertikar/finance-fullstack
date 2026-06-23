package handlers

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	mw "github.com/yourname/finance-api/middleware"
)

type BudgetsHandler struct {
	DB *sql.DB
}

// Budget is a per-user, per-category monthly spending allowance for variable
// expenses (e.g. Petrol, Groceries) that aren't tracked as fixed recurring
// entries. There is at most one budget per (user, category).
type Budget struct {
	ID        string    `json:"id"`
	UserID    string    `json:"user_id,omitempty"`
	Category  string    `json:"category"`
	Amount    float64   `json:"amount"`
	CreatedAt time.Time `json:"created_at,omitempty"`
	UpdatedAt time.Time `json:"updated_at,omitempty"`
}

func (h *BudgetsHandler) List(w http.ResponseWriter, r *http.Request) {
	userID := mw.GetUserID(r)
	rows, err := h.DB.Query(
		`SELECT id, category, amount, created_at, updated_at
		 FROM budgets WHERE user_id = $1 ORDER BY category ASC`, userID,
	)
	if err != nil {
		jsonError(w, "server error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	budgets := []Budget{}
	for rows.Next() {
		var b Budget
		if err := rows.Scan(&b.ID, &b.Category, &b.Amount, &b.CreatedAt, &b.UpdatedAt); err != nil {
			jsonError(w, "server error", http.StatusInternalServerError)
			return
		}
		budgets = append(budgets, b)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(budgets)
}

func (h *BudgetsHandler) Create(w http.ResponseWriter, r *http.Request) {
	userID := mw.GetUserID(r)
	var b Budget
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		jsonError(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if b.Category == "" || b.Amount < 0 {
		jsonError(w, "category is required and amount must be non-negative", http.StatusBadRequest)
		return
	}

	// Upsert: one allowance per (user, category). Re-adding an existing
	// category updates its amount rather than failing on the unique constraint.
	var id string
	err := h.DB.QueryRow(
		`INSERT INTO budgets (user_id, category, amount)
		 VALUES ($1,$2,$3)
		 ON CONFLICT (user_id, category) DO UPDATE SET amount = EXCLUDED.amount
		 RETURNING id`,
		userID, b.Category, b.Amount,
	).Scan(&id)
	if err != nil {
		jsonError(w, "server error", http.StatusInternalServerError)
		return
	}
	b.ID = id

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(b)
}

func (h *BudgetsHandler) Update(w http.ResponseWriter, r *http.Request) {
	userID := mw.GetUserID(r)
	budgetID := chi.URLParam(r, "id")

	var b Budget
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		jsonError(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if b.Amount < 0 {
		jsonError(w, "amount must be non-negative", http.StatusBadRequest)
		return
	}

	err := h.DB.QueryRow(
		`UPDATE budgets SET amount=$1
		 WHERE id=$2 AND user_id=$3
		 RETURNING id, category, amount`,
		b.Amount, budgetID, userID,
	).Scan(&b.ID, &b.Category, &b.Amount)
	if err == sql.ErrNoRows {
		jsonError(w, "budget not found", http.StatusNotFound)
		return
	} else if err != nil {
		jsonError(w, "server error", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(b)
}

func (h *BudgetsHandler) Delete(w http.ResponseWriter, r *http.Request) {
	userID := mw.GetUserID(r)
	budgetID := chi.URLParam(r, "id")

	res, err := h.DB.Exec(
		`DELETE FROM budgets WHERE id=$1 AND user_id=$2`, budgetID, userID,
	)
	if err != nil {
		jsonError(w, "server error", http.StatusInternalServerError)
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		jsonError(w, "budget not found", http.StatusNotFound)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
