package handlers

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	mw "github.com/yourname/finance-api/middleware"
)

type EntriesHandler struct {
	DB *sql.DB
}

type Entry struct {
	ID        string    `json:"id"`
	UserID    string    `json:"user_id,omitempty"`
	Name      string    `json:"name"`
	Amount    float64   `json:"amount"`
	Type      string    `json:"type"`
	Frequency string    `json:"frequency"`
	Category  string    `json:"category"`
	NextDue   string    `json:"nextDue"`
	CreatedAt time.Time `json:"created_at,omitempty"`
	UpdatedAt time.Time `json:"updated_at,omitempty"`
}

type Summary struct {
	MonthlyIncome   float64            `json:"monthlyIncome"`
	MonthlyExpenses float64            `json:"monthlyExpenses"`
	MonthlyNet      float64            `json:"monthlyNet"`
	ByCategory      map[string]float64 `json:"byCategory"`
}

// Monthly multipliers
var freqMultiplier = map[string]float64{
	"weekly":      52.0 / 12.0,
	"fortnightly": 26.0 / 12.0,
	"monthly":     1.0,
	"quarterly":   1.0 / 3.0,
	"yearly":      1.0 / 12.0,
}

func (h *EntriesHandler) List(w http.ResponseWriter, r *http.Request) {
	userID := mw.GetUserID(r)
	rows, err := h.DB.Query(
		`SELECT id, name, amount, type, frequency, category, next_due, created_at, updated_at
		 FROM entries WHERE user_id = $1 ORDER BY created_at ASC`, userID,
	)
	if err != nil {
		jsonError(w, "server error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	entries := []Entry{}
	for rows.Next() {
		var e Entry
		var nextDue time.Time
		if err := rows.Scan(&e.ID, &e.Name, &e.Amount, &e.Type, &e.Frequency, &e.Category, &nextDue, &e.CreatedAt, &e.UpdatedAt); err != nil {
			jsonError(w, "server error", http.StatusInternalServerError)
			return
		}
		e.NextDue = nextDue.Format("2006-01-02")
		entries = append(entries, e)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(entries)
}

func (h *EntriesHandler) Create(w http.ResponseWriter, r *http.Request) {
	userID := mw.GetUserID(r)
	var e Entry
	if err := json.NewDecoder(r.Body).Decode(&e); err != nil {
		jsonError(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if e.Name == "" || e.Amount <= 0 || e.NextDue == "" {
		jsonError(w, "name, amount and nextDue are required", http.StatusBadRequest)
		return
	}

	var id string
	var nextDue time.Time
	err := h.DB.QueryRow(
		`INSERT INTO entries (user_id, name, amount, type, frequency, category, next_due)
		 VALUES ($1,$2,$3,$4,$5,$6,$7)
		 RETURNING id, next_due`,
		userID, e.Name, e.Amount, e.Type, e.Frequency, e.Category, e.NextDue,
	).Scan(&id, &nextDue)
	if err != nil {
		jsonError(w, "server error: "+err.Error(), http.StatusInternalServerError)
		return
	}
	e.ID = id
	e.NextDue = nextDue.Format("2006-01-02")

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(e)
}

func (h *EntriesHandler) Update(w http.ResponseWriter, r *http.Request) {
	userID := mw.GetUserID(r)
	entryID := chi.URLParam(r, "id")

	var e Entry
	if err := json.NewDecoder(r.Body).Decode(&e); err != nil {
		jsonError(w, "invalid request body", http.StatusBadRequest)
		return
	}

	var nextDue time.Time
	err := h.DB.QueryRow(
		`UPDATE entries SET name=$1, amount=$2, type=$3, frequency=$4, category=$5, next_due=$6
		 WHERE id=$7 AND user_id=$8
		 RETURNING id, next_due`,
		e.Name, e.Amount, e.Type, e.Frequency, e.Category, e.NextDue, entryID, userID,
	).Scan(&e.ID, &nextDue)
	if err == sql.ErrNoRows {
		jsonError(w, "entry not found", http.StatusNotFound)
		return
	} else if err != nil {
		jsonError(w, "server error", http.StatusInternalServerError)
		return
	}
	e.NextDue = nextDue.Format("2006-01-02")

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(e)
}

func (h *EntriesHandler) Delete(w http.ResponseWriter, r *http.Request) {
	userID := mw.GetUserID(r)
	entryID := chi.URLParam(r, "id")

	res, err := h.DB.Exec(
		`DELETE FROM entries WHERE id=$1 AND user_id=$2`, entryID, userID,
	)
	if err != nil {
		jsonError(w, "server error", http.StatusInternalServerError)
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		jsonError(w, "entry not found", http.StatusNotFound)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *EntriesHandler) Summary(w http.ResponseWriter, r *http.Request) {
	userID := mw.GetUserID(r)
	rows, err := h.DB.Query(
		`SELECT amount, type, frequency, category FROM entries WHERE user_id = $1`, userID,
	)
	if err != nil {
		jsonError(w, "server error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var income, expenses float64
	byCategory := map[string]float64{}

	for rows.Next() {
		var amount float64
		var entryType, frequency, category string
		if err := rows.Scan(&amount, &entryType, &frequency, &category); err != nil {
			continue
		}
		monthly := amount * freqMultiplier[frequency]
		if entryType == "income" {
			income += monthly
		} else {
			expenses += monthly
			byCategory[category] += monthly
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(Summary{
		MonthlyIncome:   income,
		MonthlyExpenses: expenses,
		MonthlyNet:      income - expenses,
		ByCategory:      byCategory,
	})
}
