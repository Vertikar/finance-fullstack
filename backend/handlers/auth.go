package handlers

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
)

// AuthHandler handles registration and login.
// Secret must be set before use — it is provided by main.go at startup,
// which validates that JWT_SECRET is non-empty and at least 32 characters.
type AuthHandler struct {
	DB     *sql.DB
	Secret string
}

type authRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type authResponse struct {
	Token string   `json:"token"`
	User  userInfo `json:"user"`
}

type userInfo struct {
	ID    string `json:"id"`
	Email string `json:"email"`
}

func (h *AuthHandler) Register(w http.ResponseWriter, r *http.Request) {
	var req authRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Email == "" || req.Password == "" {
		jsonError(w, "email and password required", http.StatusBadRequest)
		return
	}
	if len(req.Password) < 8 {
		jsonError(w, "password must be at least 8 characters", http.StatusBadRequest)
		return
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		jsonError(w, "server error", http.StatusInternalServerError)
		return
	}

	var id, email string
	err = h.DB.QueryRow(
		`INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email`,
		req.Email, string(hash),
	).Scan(&id, &email)
	if err != nil {
		if err.Error() == `pq: duplicate key value violates unique constraint "users_email_key"` {
			jsonError(w, "email already registered", http.StatusConflict)
			return
		}
		jsonError(w, "server error", http.StatusInternalServerError)
		return
	}

	token, err := h.makeToken(id)
	if err != nil {
		jsonError(w, "server error", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(authResponse{Token: token, User: userInfo{ID: id, Email: email}})
}

func (h *AuthHandler) Login(w http.ResponseWriter, r *http.Request) {
	var req authRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Email == "" || req.Password == "" {
		jsonError(w, "email and password required", http.StatusBadRequest)
		return
	}

	var id, email, hash string
	err := h.DB.QueryRow(
		`SELECT id, email, password_hash FROM users WHERE email = $1`, req.Email,
	).Scan(&id, &email, &hash)
	if err == sql.ErrNoRows {
		jsonError(w, "invalid credentials", http.StatusUnauthorized)
		return
	} else if err != nil {
		jsonError(w, "server error", http.StatusInternalServerError)
		return
	}

	if err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(req.Password)); err != nil {
		jsonError(w, "invalid credentials", http.StatusUnauthorized)
		return
	}

	token, err := h.makeToken(id)
	if err != nil {
		jsonError(w, "server error", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(authResponse{Token: token, User: userInfo{ID: id, Email: email}})
}

// makeToken signs a JWT using the secret injected at construction time.
// There is no fallback — if Secret is empty the server would have already
// exited in main.go before reaching this point.
func (h *AuthHandler) makeToken(userID string) (string, error) {
	claims := jwt.MapClaims{
		"user_id": userID,
		"exp":     time.Now().Add(30 * 24 * time.Hour).Unix(),
		"iat":     time.Now().Unix(),
	}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(h.Secret))
}

func jsonError(w http.ResponseWriter, msg string, code int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}
