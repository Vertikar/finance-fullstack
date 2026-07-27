package main

import (
	"io"
	"io/fs"
	"regexp"
	"sort"
	"testing"

	"github.com/golang-migrate/migrate/v4/source"
	"github.com/golang-migrate/migrate/v4/source/iofs"
)

// Static hygiene checks over the embedded migration set. These need no database,
// so they run on every PR and inside the Docker test image.
//
// Everything here guards a failure mode that only surfaces later, and badly:
// a version with no down file cannot be rolled back, and produces the
// "no migration found for version N: read down ..." crash loop when a database
// is left ahead of the binary. Two branches both adding 007 makes the applied
// set depend on directory iteration order.

// migrationFilename pins the naming convention: exactly three digits, a
// lower_snake_case title, and an explicit direction. golang-migrate itself
// parses any number of leading digits, so `7_foo.up.sql` and `0007_foo.up.sql`
// would both load — they just sort badly and make it easy to misread which
// migrations exist.
var migrationFilename = regexp.MustCompile(`^\d{3}_[a-z0-9_]+\.(up|down)\.sql$`)

// migrationFile is one parsed entry of the embedded set.
type migrationFile struct {
	name       string
	version    uint
	identifier string
	direction  source.Direction
}

// readMigrationFiles parses every file in the embedded migrations directory,
// failing the test on anything that does not match the naming convention.
// Parsing itself goes through golang-migrate's own source.Parse so this test
// cannot disagree with the runtime about what a filename means.
func readMigrationFiles(t *testing.T) []migrationFile {
	t.Helper()

	entries, err := fs.ReadDir(migrationsFS, "migrations")
	if err != nil {
		t.Fatalf("reading embedded migrations dir: %v", err)
	}
	if len(entries) == 0 {
		t.Fatal("embedded migrations directory is empty — the //go:embed directive in main.go is not picking up any files")
	}

	files := make([]migrationFile, 0, len(entries))
	for _, e := range entries {
		if e.IsDir() {
			t.Errorf("migrations/%s: unexpected subdirectory — migrations must be flat", e.Name())
			continue
		}
		if !migrationFilename.MatchString(e.Name()) {
			t.Errorf("migrations/%s: filename does not match the required convention %s "+
				"(three digits, lower_snake_case title, e.g. 007_create_transactions.up.sql)",
				e.Name(), migrationFilename)
			continue
		}
		parsed, err := source.Parse(e.Name())
		if err != nil {
			t.Errorf("migrations/%s: golang-migrate cannot parse this filename: %v", e.Name(), err)
			continue
		}
		files = append(files, migrationFile{
			name:       e.Name(),
			version:    parsed.Version,
			identifier: parsed.Identifier,
			direction:  parsed.Direction,
		})
	}
	return files
}

// TestMigrationFilenamesFollowConvention checks the naming/width convention on
// its own, so a stray filename reports as a naming failure rather than as a
// confusing gap in the version sequence.
func TestMigrationFilenamesFollowConvention(t *testing.T) {
	readMigrationFiles(t)
}

// TestMigrationVersionsAreUniqueAndPaired covers the three structural rules:
// each version has exactly one up and one down, no version is claimed twice,
// and all files at a version agree on the title.
func TestMigrationVersionsAreUniqueAndPaired(t *testing.T) {
	files := readMigrationFiles(t)

	// version -> direction -> filenames that claim it
	claims := map[uint]map[source.Direction][]string{}
	identifiers := map[uint]string{}
	reportedClash := map[uint]bool{}

	for _, f := range files {
		if claims[f.version] == nil {
			claims[f.version] = map[source.Direction][]string{}
		}
		claims[f.version][f.direction] = append(claims[f.version][f.direction], f.name)

		// Two branches adding 007 under different titles is the case this
		// catches: the version collides even though no filename does. Reported
		// once per version, not once per file that claims it.
		if existing, ok := identifiers[f.version]; !ok {
			identifiers[f.version] = f.identifier
		} else if existing != f.identifier && !reportedClash[f.version] {
			reportedClash[f.version] = true
			t.Errorf("version %03d is claimed by two different migrations (%q and %q) — "+
				"most likely two branches both added %03d; renumber one of them",
				f.version, existing, f.identifier, f.version)
		}
	}

	for _, version := range sortedVersions(claims) {
		for _, dir := range []source.Direction{source.Up, source.Down} {
			names := claims[version][dir]
			switch {
			case len(names) == 0:
				t.Errorf("version %03d (%s) has no .%s.sql file — every migration must be reversible",
					version, identifiers[version], dir)
			case len(names) > 1:
				t.Errorf("version %03d has %d .%s.sql files (%v) — exactly one is allowed",
					version, len(names), dir, names)
			}
		}
	}
}

// TestMigrationVersionsAreContiguous asserts the versions are exactly 1..N.
// A gap usually means a migration was deleted rather than reverted, and makes
// "the database is at version N" ambiguous to reason about.
func TestMigrationVersionsAreContiguous(t *testing.T) {
	files := readMigrationFiles(t)

	seen := map[uint]bool{}
	for _, f := range files {
		seen[f.version] = true
	}
	versions := make([]uint, 0, len(seen))
	for v := range seen {
		versions = append(versions, v)
	}
	sort.Slice(versions, func(i, j int) bool { return versions[i] < versions[j] })

	for i, got := range versions {
		want := uint(i + 1)
		if got != want {
			t.Fatalf("migration versions are not contiguous from 001: expected %03d at position %d, got %03d (full sequence: %v)",
				want, i+1, got, versions)
		}
	}
}

// TestMigrationSourceIsReadable drives the real iofs source driver, the same one
// main.go uses, and reads both directions of every version through it.
//
// This is the check that reproduces the incident in issue #31 directly: the
// crash there was a failed *down* read surfacing as
// "no migration found for version 7: read down for version 7 migrations: file
// does not exist". Asserting ReadDown succeeds for every version means a
// missing down file fails here rather than on someone's laptop mid-rollback.
func TestMigrationSourceIsReadable(t *testing.T) {
	driver, err := iofs.New(migrationsFS, "migrations")
	if err != nil {
		t.Fatalf("iofs.New over the embedded migrations: %v", err)
	}
	defer driver.Close()

	version, err := driver.First()
	if err != nil {
		t.Fatalf("no first migration in the embedded set: %v", err)
	}
	for {
		for _, read := range []struct {
			dir string
			fn  func(uint) (io.ReadCloser, string, error)
		}{
			{"up", driver.ReadUp},
			{"down", driver.ReadDown},
		} {
			body, identifier, err := read.fn(version)
			if err != nil {
				t.Errorf("reading %s migration for version %03d: %v", read.dir, version, err)
				continue
			}
			if err := body.Close(); err != nil {
				t.Errorf("closing %s migration for version %03d: %v", read.dir, version, err)
			}
			if identifier == "" {
				t.Errorf("version %03d %s migration has an empty identifier", version, read.dir)
			}
		}

		next, err := driver.Next(version)
		if err != nil {
			break // os.ErrNotExist marks the end of the sequence
		}
		version = next
	}
}

// sortedVersions returns the map's keys in ascending order, so failures are
// reported in migration order rather than in Go's randomised map order.
func sortedVersions[V any](m map[uint]V) []uint {
	out := make([]uint, 0, len(m))
	for v := range m {
		out = append(out, v)
	}
	sort.Slice(out, func(i, j int) bool { return out[i] < out[j] })
	return out
}
