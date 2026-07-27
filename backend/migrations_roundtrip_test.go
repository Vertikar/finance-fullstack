package main

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"net/url"
	"os"
	"strings"
	"testing"

	"github.com/golang-migrate/migrate/v4"
	"github.com/golang-migrate/migrate/v4/source/iofs"
	"github.com/lib/pq"
)

// Up → down → up round trip against a real Postgres.
//
// The second up is the part that earns its keep: running a down migration
// without error only proves it is valid SQL. Comparing the schema after the
// second up against the first proves the down actually reversed the up —
// catching the "dropped tables in the wrong order", "forgot to restore the
// CHECK constraint" and "left an index behind" family, which otherwise only
// surface during a rollback, under pressure.
//
// Configure with a URL-form DSN pointing at a Postgres the test may create and
// drop databases on:
//
//	MIGRATE_TEST_DATABASE_URL='postgres://postgres:postgres@localhost:5432/postgres?sslmode=disable'
//
// The database named in the URL is never migrated — it is only used to create a
// uniquely-named throwaway, which is dropped again at the end.
const (
	dbURLEnv     = "MIGRATE_TEST_DATABASE_URL"
	requireDBEnv = "MIGRATE_TEST_REQUIRE_DB"
)

func TestMigrationRoundTrip(t *testing.T) {
	adminURL := os.Getenv(dbURLEnv)
	if adminURL == "" {
		// CI sets MIGRATE_TEST_REQUIRE_DB=1 so a typo'd variable or a service
		// container that failed to come up is a red build, not a silent skip.
		if os.Getenv(requireDBEnv) != "" {
			t.Fatalf("%s is set but %s is empty — the round-trip check would have been skipped", requireDBEnv, dbURLEnv)
		}
		t.Skipf("%s not set — skipping the migration round trip (set it to a throwaway Postgres to run this)", dbURLEnv)
	}

	testURL, dropDB := createThrowawayDatabase(t, adminURL)
	defer dropDB()

	database, err := sql.Open("postgres", testURL)
	if err != nil {
		t.Fatalf("opening the throwaway database: %v", err)
	}
	defer database.Close()

	m, err := newMigrator(database)
	if err != nil {
		t.Fatalf("building the migrator: %v", err)
	}
	versions := embeddedVersions(t)

	// 1. Up one version at a time, recording the schema at each step.
	//
	// Stepping rather than a single m.Up() is what makes an incomplete down
	// detectable. Going straight down to zero hides them: 001's down drops the
	// entries table outright, so a later down that forgets to drop a column it
	// added still ends at an empty schema and still re-ups identically. Only
	// comparing version N-1 against the schema recorded on the way up isolates
	// which down is at fault.
	atVersion := map[uint][]string{0: schemaSnapshot(t, database)}
	if len(atVersion[0]) > 0 {
		t.Fatalf("the throwaway database is not empty before migrating:\n%s", strings.Join(atVersion[0], "\n"))
	}
	for _, v := range versions {
		if err := m.Steps(1); err != nil {
			t.Fatalf("applying up migration %03d: %v", v, err)
		}
		atVersion[v] = schemaSnapshot(t, database)
	}

	head := versions[len(versions)-1]
	afterFirstUp := atVersion[head]
	if len(afterFirstUp) == 0 {
		t.Fatal("the schema is empty after migrating up — no migrations appear to have run")
	}

	// 2. Back down one version at a time, comparing each intermediate state
	//    against what the way up recorded.
	for i := len(versions) - 1; i >= 0; i-- {
		v := versions[i]
		if err := m.Steps(-1); err != nil {
			t.Fatalf("applying down migration %03d: %v", v, err)
		}
		var previous uint
		if i > 0 {
			previous = versions[i-1]
		}
		if diff := diffSnapshots(atVersion[previous], schemaSnapshot(t, database)); diff != "" {
			// Stop at the first offender. Once one down leaves something behind,
			// every earlier comparison inherits the same difference and the extra
			// output only obscures which migration is actually at fault.
			t.Fatalf("down migration %03d did not reverse its up: after rolling it back the schema "+
				"differs from what it was at version %03d on the way up.\n\n%s",
				v, previous, diff)
		}
	}

	// 3. Up again from zero, and compare against the first time.
	if err := m.Up(); err != nil && !errors.Is(err, migrate.ErrNoChange) {
		t.Fatalf("second up (after rolling all the way back): %v", err)
	}
	if diff := diffSnapshots(afterFirstUp, schemaSnapshot(t, database)); diff != "" {
		t.Errorf("the schema after up→down→up differs from the schema after the first up.\n\n%s", diff)
	}
}

// embeddedVersions lists the embedded migration versions in ascending order,
// enumerated through the same iofs driver main.go uses.
func embeddedVersions(t *testing.T) []uint {
	t.Helper()

	driver, err := iofs.New(migrationsFS, "migrations")
	if err != nil {
		t.Fatalf("iofs.New over the embedded migrations: %v", err)
	}
	defer driver.Close()

	version, err := driver.First()
	if err != nil {
		t.Fatalf("no first migration in the embedded set: %v", err)
	}
	versions := []uint{version}
	for {
		next, err := driver.Next(version)
		if err != nil {
			return versions // os.ErrNotExist marks the end of the sequence
		}
		versions = append(versions, next)
		version = next
	}
}

// createThrowawayDatabase creates a uniquely-named database on the server in
// adminURL and returns a DSN for it plus a cleanup func. The admin database
// itself is never migrated, so pointing the test at a development Postgres is
// safe.
func createThrowawayDatabase(t *testing.T, adminURL string) (string, func()) {
	t.Helper()

	parsed, err := url.Parse(adminURL)
	if err != nil {
		t.Fatalf("%s is not a valid URL (%q): %v", dbURLEnv, adminURL, err)
	}
	if parsed.Scheme != "postgres" && parsed.Scheme != "postgresql" {
		t.Fatalf("%s must be a postgres:// URL, got scheme %q", dbURLEnv, parsed.Scheme)
	}

	suffix := make([]byte, 6)
	if _, err := rand.Read(suffix); err != nil {
		t.Fatalf("generating a database name: %v", err)
	}
	name := "migrate_roundtrip_" + hex.EncodeToString(suffix)

	admin, err := sql.Open("postgres", adminURL)
	if err != nil {
		t.Fatalf("connecting to %s: %v", dbURLEnv, err)
	}
	defer admin.Close()

	if err := admin.Ping(); err != nil {
		t.Fatalf("cannot reach the Postgres in %s: %v", dbURLEnv, err)
	}
	if _, err := admin.Exec("CREATE DATABASE " + pq.QuoteIdentifier(name)); err != nil {
		t.Fatalf("creating throwaway database %s: %v", name, err)
	}

	testURL := *parsed
	testURL.Path = "/" + name

	return testURL.String(), func() {
		// A fresh admin connection: the deferred admin.Close above has already
		// run by the time the caller's defer fires.
		cleanup, err := sql.Open("postgres", adminURL)
		if err != nil {
			t.Logf("cleanup: reconnecting to drop %s: %v", name, err)
			return
		}
		defer cleanup.Close()
		if _, err := cleanup.Exec("DROP DATABASE IF EXISTS " + pq.QuoteIdentifier(name) + " WITH (FORCE)"); err != nil {
			t.Logf("cleanup: dropping throwaway database %s: %v", name, err)
		}
	}
}

// schemaQueries describe the snapshot. Each returns rows that are concatenated
// into one line per object, prefixed with the section name.
//
// `pg_get_*def` output is what makes this worth doing: it renders the full
// definition, so a CHECK constraint that comes back with different terms, or an
// index rebuilt over different columns, shows up as a textual difference.
// schema_migrations is golang-migrate's own bookkeeping table, not something a
// migration creates, so it is excluded throughout.
var schemaQueries = []struct {
	section string
	query   string
}{
	{"column", `
		SELECT format('%s.%s [%s] type=%s null=%s default=%s prec=%s scale=%s maxlen=%s',
		              table_name, column_name, ordinal_position, data_type, is_nullable,
		              coalesce(column_default, '-'),
		              coalesce(numeric_precision::text, '-'),
		              coalesce(numeric_scale::text, '-'),
		              coalesce(character_maximum_length::text, '-'))
		FROM information_schema.columns
		WHERE table_schema = 'public' AND table_name <> 'schema_migrations'
		ORDER BY table_name, ordinal_position`},

	{"table", `
		SELECT format('%s [%s]', table_name, table_type)
		FROM information_schema.tables
		WHERE table_schema = 'public' AND table_name <> 'schema_migrations'
		ORDER BY table_name`},

	{"constraint", `
		SELECT format('%s.%s %s', c.relname, con.conname, pg_get_constraintdef(con.oid))
		FROM pg_constraint con
		JOIN pg_class c ON c.oid = con.conrelid
		JOIN pg_namespace n ON n.oid = c.relnamespace
		WHERE n.nspname = 'public' AND c.relname <> 'schema_migrations'
		ORDER BY c.relname, con.conname`},

	{"index", `
		SELECT format('%s.%s %s', tablename, indexname, indexdef)
		FROM pg_indexes
		WHERE schemaname = 'public' AND tablename <> 'schema_migrations'
		ORDER BY tablename, indexname`},

	{"trigger", `
		SELECT format('%s.%s %s', c.relname, t.tgname, pg_get_triggerdef(t.oid))
		FROM pg_trigger t
		JOIN pg_class c ON c.oid = t.tgrelid
		JOIN pg_namespace n ON n.oid = c.relnamespace
		WHERE n.nspname = 'public' AND NOT t.tgisinternal
		ORDER BY c.relname, t.tgname`},

	// Functions live in public too, including those an extension installs, so
	// this covers both a migration's own functions and extension presence.
	{"function", `
		SELECT format('%s(%s)', p.proname, pg_get_function_identity_arguments(p.oid))
		FROM pg_proc p
		JOIN pg_namespace n ON n.oid = p.pronamespace
		WHERE n.nspname = 'public'
		ORDER BY p.proname, pg_get_function_identity_arguments(p.oid)`},

	{"extension", `
		SELECT format('%s in %s', e.extname, n.nspname)
		FROM pg_extension e
		JOIN pg_namespace n ON n.oid = e.extnamespace
		WHERE e.extname <> 'plpgsql'
		ORDER BY e.extname`},

	{"sequence", `
		SELECT sequence_name
		FROM information_schema.sequences
		WHERE sequence_schema = 'public'
		ORDER BY sequence_name`},
}

// schemaSnapshot renders the structure of schema public as a sorted, comparable
// list of lines. Row data is deliberately not included — seed content is out of
// scope, and an idempotent seed would compare equal anyway.
func schemaSnapshot(t *testing.T, database *sql.DB) []string {
	t.Helper()

	var snapshot []string
	for _, q := range schemaQueries {
		rows, err := database.Query(q.query)
		if err != nil {
			t.Fatalf("snapshotting %ss: %v", q.section, err)
		}
		for rows.Next() {
			var line string
			if err := rows.Scan(&line); err != nil {
				rows.Close()
				t.Fatalf("scanning %s row: %v", q.section, err)
			}
			snapshot = append(snapshot, fmt.Sprintf("%-10s %s", q.section, line))
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			t.Fatalf("iterating %s rows: %v", q.section, err)
		}
		rows.Close()
	}
	return snapshot
}

// diffSnapshots describes how got departs from want, or returns "" when they
// match. Both inputs are already in a deterministic order, so a set difference
// is enough and reads better than a positional diff.
func diffSnapshots(want, got []string) string {
	inGot := make(map[string]bool, len(got))
	for _, line := range got {
		inGot[line] = true
	}
	inWant := make(map[string]bool, len(want))
	for _, line := range want {
		inWant[line] = true
	}

	var b strings.Builder
	for _, line := range want {
		if !inGot[line] {
			fmt.Fprintf(&b, "  missing:   %s\n", line)
		}
	}
	for _, line := range got {
		if !inWant[line] {
			fmt.Fprintf(&b, "  left over: %s\n", line)
		}
	}
	return b.String()
}
