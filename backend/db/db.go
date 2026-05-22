package db

import (
	"database/sql"
	"fmt"
	"log"
	"os"
	"time"

	_ "github.com/lib/pq"
)

func Connect() *sql.DB {
	dsn := fmt.Sprintf(
		"host=%s port=%s user=%s password=%s dbname=%s sslmode=disable",
		getEnv("DB_HOST", "localhost"),
		getEnv("DB_PORT", "5432"),
		getEnv("DB_USER", "finance"),
		getEnv("DB_PASSWORD", "finance"),
		getEnv("DB_NAME", "finance"),
	)

	var database *sql.DB
	var err error

	// Retry loop — wait for Postgres to be ready on startup
	for i := 0; i < 15; i++ {
		database, err = sql.Open("postgres", dsn)
		if err == nil {
			if err = database.Ping(); err == nil {
				break
			}
		}
		log.Printf("Waiting for database... (%d/15)", i+1)
		time.Sleep(2 * time.Second)
	}
	if err != nil {
		log.Fatalf("Could not connect to database: %v", err)
	}

	database.SetMaxOpenConns(25)
	database.SetMaxIdleConns(10)
	database.SetConnMaxLifetime(5 * time.Minute)

	log.Println("Database connected")
	return database
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
