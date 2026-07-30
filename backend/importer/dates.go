package importer

import (
	"fmt"
	"strings"
	"time"
)

// ISODate is the canonical date form stored in the database and returned by
// ParseDate.
const ISODate = "2006-01-02"

// dateAliases lets a column_map spell its date_format the way the bank's
// documentation does ("DD/MM/YYYY") instead of in Go reference-time layout.
// A format that isn't an alias is passed to time.Parse as-is, so a raw Go
// layout also works.
var dateAliases = map[string]string{
	"YYYY-MM-DD": ISODate,
	"ISO":        ISODate,
	"DD/MM/YYYY": "02/01/2006",
	"D/MM/YYYY":  "2/01/2006",
	"D/M/YYYY":   "2/1/2006",
	"MM/DD/YYYY": "01/02/2006",
	"DD-MM-YYYY": "02-01-2006",
	"YYYY/MM/DD": "2006/01/02",
}

// fallbackLayouts are tried when the preset's own format doesn't match. Banks
// quietly change export formats, and spreadsheet round-trips rewrite dates, so
// accepting the common Australian variants avoids failing a whole import over
// formatting. Order matters: day-first before month-first, since "03/06/2026"
// is ambiguous and DD/MM is the Australian reading.
var fallbackLayouts = []string{
	ISODate,
	"02/01/2006",
	"2/01/2006",
	"2/1/2006",
	"02-01-2006",
	"2006/01/02",
	time.RFC3339,
}

// ParseDate converts a source date string to ISO form. format may be a
// dateAliases key, a Go layout, or empty to rely on the fallbacks.
func ParseDate(s, format string) (string, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return "", fmt.Errorf("date is empty")
	}

	layouts := make([]string, 0, len(fallbackLayouts)+1)
	if format != "" {
		if alias, ok := dateAliases[strings.ToUpper(format)]; ok {
			layouts = append(layouts, alias)
		} else {
			layouts = append(layouts, format)
		}
	}
	layouts = append(layouts, fallbackLayouts...)

	for _, layout := range layouts {
		if t, err := time.Parse(layout, s); err == nil {
			return t.Format(ISODate), nil
		}
	}
	return "", fmt.Errorf("date %q is not in a recognised format", s)
}
