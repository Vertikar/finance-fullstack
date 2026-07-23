package main

import (
	"database/sql"
	"embed"
	"errors"
	"log"
	"net/http"
	"os"

	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/golang-migrate/migrate/v4"
	"github.com/golang-migrate/migrate/v4/database/postgres"
	"github.com/golang-migrate/migrate/v4/source/iofs"
	_ "github.com/lib/pq"

	"github.com/vertikar/finance-api/db"
	"github.com/vertikar/finance-api/handlers"
	mw "github.com/vertikar/finance-api/middleware"
)

//go:embed migrations/*.sql
var migrationsFS embed.FS

func main() {
	database := db.Connect()
	defer database.Close()

	runMigrations(database)

	// ── Validate JWT_SECRET at startup — fail fast rather than run insecurely ──
	jwtSecret := os.Getenv("JWT_SECRET")
	if err := validateJWTSecret(jwtSecret); err != nil {
		log.Fatal(err)
	}

	// Pass the validated secret explicitly — no handler reads os.Getenv directly.
	authH := &handlers.AuthHandler{DB: database, Secret: jwtSecret}
	entriesH := &handlers.EntriesHandler{DB: database}
	budgetsH := &handlers.BudgetsHandler{DB: database}
	categoriesH := &handlers.CategoriesHandler{DB: database}
	importExportH := &handlers.ImportExportHandler{DB: database}
	settingsH := &handlers.SettingsHandler{DB: database}

	r := chi.NewRouter()

	r.Use(chimw.Logger)
	r.Use(chimw.Recoverer)
	r.Use(chimw.RealIP)
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   []string{"*"},
		AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type"},
		AllowCredentials: false,
		MaxAge:           300,
	}))

	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"status":"ok"}`))
	})

	r.Post("/api/auth/register", authH.Register)
	r.Post("/api/auth/login", authH.Login)

	// Protected routes — all require a valid JWT
	r.Group(func(r chi.Router) {
		r.Use(mw.NewAuth(jwtSecret))

		// Entries CRUD
		r.Get("/api/entries", entriesH.List)
		r.Post("/api/entries", entriesH.Create)
		r.Put("/api/entries/{id}", entriesH.Update)
		r.Delete("/api/entries/{id}", entriesH.Delete)

		// Computed summary
		r.Get("/api/entries/summary", entriesH.Summary)

		// Category catalogue (global reference data with bucket + colour)
		r.Get("/api/categories", categoriesH.List)

		// Variable-expense budgets (monthly allowances per category)
		r.Get("/api/budgets", budgetsH.List)
		r.Post("/api/budgets", budgetsH.Create)
		r.Put("/api/budgets/{id}", budgetsH.Update)
		r.Delete("/api/budgets/{id}", budgetsH.Delete)

		// CSV export & import
		// Note: chi matches static segments before parameterised ones, so these
		// resolve correctly ahead of any future /api/entries/{id} GET route.
		r.Get("/api/entries/export", importExportH.Export)
		r.Post("/api/entries/import", importExportH.Import)

		// User settings
		r.Get("/api/settings/pay-cycle", settingsH.GetPayCycle)
		r.Put("/api/settings/pay-cycle", settingsH.PutPayCycle)
		r.Put("/api/settings/password", settingsH.ChangePassword)
	})

	port := getEnv("PORT", "8081")
	log.Printf("API listening on :%s", port)
	if err := http.ListenAndServe(":"+port, r); err != nil {
		log.Fatal(err)
	}
}

// validateJWTSecret enforces the startup security requirement that JWT_SECRET
// is present and long enough to be a meaningful HMAC key. Extracted from main()
// so the rule can be unit-tested without spawning the process.
func validateJWTSecret(secret string) error {
	if secret == "" {
		return errors.New("JWT_SECRET environment variable is required but not set. " +
			"Generate one with: openssl rand -hex 32")
	}
	if len(secret) < 32 {
		return errors.New("JWT_SECRET must be at least 32 characters. " +
			"Generate a strong one with: openssl rand -hex 32")
	}
	return nil
}

func runMigrations(database *sql.DB) {
	sourceDriver, err := iofs.New(migrationsFS, "migrations")
	if err != nil {
		log.Fatalf("Migration source error: %v", err)
	}
	dbDriver, err := postgres.WithInstance(database, &postgres.Config{})
	if err != nil {
		log.Fatalf("Migration db driver error: %v", err)
	}
	m, err := migrate.NewWithInstance("iofs", sourceDriver, "postgres", dbDriver)
	if err != nil {
		log.Fatalf("Migration init error: %v", err)
	}
	if err := m.Up(); err != nil && err != migrate.ErrNoChange {
		log.Fatalf("Migration failed: %v", err)
	}
	log.Println("Migrations applied")
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
