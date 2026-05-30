package main

import (
	"database/sql"
	"embed"
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

	"github.com/yourname/finance-api/db"
	"github.com/yourname/finance-api/handlers"
	mw "github.com/yourname/finance-api/middleware"
)

//go:embed migrations/*.sql
var migrationsFS embed.FS

func main() {
	// ── Validate JWT_SECRET at startup — fail fast rather than run insecurely ──
	jwtSecret := os.Getenv("JWT_SECRET")
	if jwtSecret == "" {
		log.Fatal("JWT_SECRET environment variable is required but not set. " +
			"Generate one with: openssl rand -hex 32")
	}
	if len(jwtSecret) < 32 {
		log.Fatal("JWT_SECRET must be at least 32 characters. " +
			"Generate a strong one with: openssl rand -hex 32")
	}

	database := db.Connect()
	defer database.Close()

	runMigrations(database)

	// Pass the validated secret explicitly — no package reads os.Getenv directly.
	authH    := &handlers.AuthHandler{DB: database, Secret: jwtSecret}
	entriesH := &handlers.EntriesHandler{DB: database}

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

	r.Group(func(r chi.Router) {
		r.Use(mw.NewAuth(jwtSecret))
		r.Get("/api/entries", entriesH.List)
		r.Post("/api/entries", entriesH.Create)
		r.Put("/api/entries/{id}", entriesH.Update)
		r.Delete("/api/entries/{id}", entriesH.Delete)
		r.Get("/api/entries/summary", entriesH.Summary)
	})

	port := getEnv("PORT", "8081")
	log.Printf("API listening on :%s", port)
	if err := http.ListenAndServe(":"+port, r); err != nil {
		log.Fatal(err)
	}
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
