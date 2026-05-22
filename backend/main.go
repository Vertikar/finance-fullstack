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
	database := db.Connect()
	defer database.Close()

	runMigrations(database)

	authH := &handlers.AuthHandler{DB: database}
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

	// Health check
	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"status":"ok"}`))
	})

	// Public auth routes
	r.Post("/api/auth/register", authH.Register)
	r.Post("/api/auth/login", authH.Login)

	// Protected routes
	r.Group(func(r chi.Router) {
		r.Use(mw.Auth)
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
