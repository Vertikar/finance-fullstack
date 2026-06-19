package handlers

import (
	"database/sql"
	"encoding/json"
	"net/http"

	mw "github.com/yourname/finance-api/middleware"
	"golang.org/x/crypto/bcrypt"
)

type SettingsHandler struct {
	DB *sql.DB
}

type payCycleResponse struct {
	PayCycle    *string `json:"pay_cycle"`
	LastPayDate *string `json:"last_pay_date"`
}

func (h *SettingsHandler) GetPayCycle(w http.ResponseWriter, r *http.Request) {
	userID := mw.GetUserID(r)

	var payCycle, lastPayDate sql.NullString
	err := h.DB.QueryRow(
		`SELECT pay_cycle, last_pay_date::text FROM users WHERE id = $1`, userID,
	).Scan(&payCycle, &lastPayDate)
	if err != nil {
		jsonError(w, "server error", http.StatusInternalServerError)
		return
	}

	resp := payCycleResponse{}
	if payCycle.Valid {
		resp.PayCycle = &payCycle.String
	}
	if lastPayDate.Valid {
		resp.LastPayDate = &lastPayDate.String
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

func (h *SettingsHandler) ChangePassword(w http.ResponseWriter, r *http.Request) {
	userID := mw.GetUserID(r)

	var body struct {
		CurrentPassword string `json:"current_password"`
		NewPassword     string `json:"new_password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		jsonError(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if body.CurrentPassword == "" || body.NewPassword == "" {
		jsonError(w, "current_password and new_password are required", http.StatusBadRequest)
		return
	}
	if len(body.NewPassword) < 8 {
		jsonError(w, "new password must be at least 8 characters", http.StatusBadRequest)
		return
	}

	var hash string
	if err := h.DB.QueryRow(`SELECT password_hash FROM users WHERE id = $1`, userID).Scan(&hash); err != nil {
		jsonError(w, "server error", http.StatusInternalServerError)
		return
	}

	if err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(body.CurrentPassword)); err != nil {
		jsonError(w, "current password is incorrect", http.StatusUnauthorized)
		return
	}

	newHash, err := bcrypt.GenerateFromPassword([]byte(body.NewPassword), bcrypt.DefaultCost)
	if err != nil {
		jsonError(w, "server error", http.StatusInternalServerError)
		return
	}

	if _, err := h.DB.Exec(`UPDATE users SET password_hash = $1 WHERE id = $2`, string(newHash), userID); err != nil {
		jsonError(w, "server error", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"message": "password updated"})
}

func (h *SettingsHandler) PutPayCycle(w http.ResponseWriter, r *http.Request) {
	userID := mw.GetUserID(r)

	var body struct {
		PayCycle    string `json:"pay_cycle"`
		LastPayDate string `json:"last_pay_date"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		jsonError(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if body.PayCycle != "fortnightly" && body.PayCycle != "monthly" {
		jsonError(w, "pay_cycle must be 'fortnightly' or 'monthly'", http.StatusBadRequest)
		return
	}
	if body.LastPayDate == "" {
		jsonError(w, "last_pay_date is required", http.StatusBadRequest)
		return
	}

	var payCycle, lastPayDate sql.NullString
	err := h.DB.QueryRow(
		`UPDATE users SET pay_cycle = $1, last_pay_date = $2 WHERE id = $3
		 RETURNING pay_cycle, last_pay_date::text`,
		body.PayCycle, body.LastPayDate, userID,
	).Scan(&payCycle, &lastPayDate)
	if err != nil {
		jsonError(w, "server error", http.StatusInternalServerError)
		return
	}

	resp := payCycleResponse{}
	if payCycle.Valid {
		resp.PayCycle = &payCycle.String
	}
	if lastPayDate.Valid {
		resp.LastPayDate = &lastPayDate.String
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}
