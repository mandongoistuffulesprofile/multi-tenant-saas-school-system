package validation

import (
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

func TestListMakesAnEmptyListAnArray(t *testing.T) {
	var nilSlice []struct{ ID string }
	encoded, err := json.Marshal(List(nilSlice))
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if string(encoded) != "[]" {
		t.Fatalf("nil slice encoded as %s, want []", encoded)
	}

	if got := List([]string{"a"}); len(got) != 1 || got[0] != "a" {
		t.Fatalf("List changed a populated slice: %v", got)
	}
	if got := List([]int{}); got == nil {
		t.Fatal("List returned nil for an empty slice")
	}
}

// TestNoHandlerEmitsADeclaredSliceUnwrapped is the regression gate for the
// `null` list. A handler that declares `var rows []T` and then writes it into a
// response sends null when the query finds nothing, which a client renders as a
// broken screen rather than an empty one. Every emission of a declared slice
// must go through validation.List.
func TestNoHandlerEmitsADeclaredSliceUnwrapped(t *testing.T) {
	decl := regexp.MustCompile(`\bvar (\w+) \[\]`)
	quoted := regexp.MustCompile(`"(?:[^"\\]|\\.)*"`)

	var offenders []string
	err := filepath.WalkDir("..", func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return nil
		}
		src, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		body := string(src)

		// Names declared as a slice anywhere in the file. A file is one package,
		// so a name declared in another function only costs a false positive we
		// tolerate: the emission is still worth wrapping.
		names := map[string]bool{}
		for _, m := range decl.FindAllStringSubmatch(body, -1) {
			names[m[1]] = true
		}
		if len(names) == 0 {
			return nil
		}

		for i, line := range strings.Split(body, "\n") {
			// A response emission, not a BindJSON, and not a mention inside a
			// message string ("failed to encode subjects").
			if !strings.Contains(line, ".JSON(") {
				continue
			}
			code := quoted.ReplaceAllString(line, `""`)
			for name := range names {
				if !regexp.MustCompile(`\b` + regexp.QuoteMeta(name) + `\b`).MatchString(code) {
					continue
				}
				if strings.Contains(code, "List("+name+")") {
					continue
				}
				offenders = append(offenders, path+":"+itoa(i+1)+" emits "+name+" without validation.List")
			}
		}
		return nil
	})
	if err != nil {
		t.Fatalf("scan: %v", err)
	}
	if len(offenders) > 0 {
		t.Fatalf("these responses can serialise as null; wrap the value in validation.List:\n  %s",
			strings.Join(offenders, "\n  "))
	}
}
