package main

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode"
)

type repeatedFlag []string

func (values *repeatedFlag) String() string { return strings.Join(*values, ",") }
func (values *repeatedFlag) Set(value string) error {
	*values = append(*values, value)
	return nil
}

type detailDefinition struct {
	Type           string   `json:"type"`
	Values         []string `json:"values,omitempty"`
	Minimum        *int64   `json:"minimum,omitempty"`
	Maximum        *int64   `json:"maximum,omitempty"`
	MaxLength      int      `json:"maxLength,omitempty"`
	MaxBytes       int      `json:"maxBytes,omitempty"`
	MaxDepth       int      `json:"maxDepth,omitempty"`
	MaxItems       int      `json:"maxItems,omitempty"`
	AllowedSchemes []string `json:"allowedSchemes,omitempty"`
}

type applicationStatus struct {
	Generation  int64          `json:"generation"`
	Revision    int64          `json:"revision"`
	State       string         `json:"state"`
	UpdatedAt   time.Time      `json:"updatedAt"`
	LastReadyAt *time.Time     `json:"lastReadyAt,omitempty"`
	Summary     string         `json:"summary,omitempty"`
	Details     map[string]any `json:"details,omitempty"`
	Error       string         `json:"error,omitempty"`
}

func main() {
	if len(os.Args) == 3 && os.Args[1] == "--supervise-session" {
		if err := superviseSession(os.Args[2]); err != nil {
			fmt.Fprintln(os.Stderr, "remotexapp session supervisor:", err)
			os.Exit(1)
		}
		return
	}
	var path, schemaPath, state, summary, errorText string
	var connectionMetadata bool
	var connectionApplication string
	var generation int64
	var recordIBusPID int
	var stringsFlag, booleansFlag, integersFlag, jsonFlag repeatedFlag
	flag.StringVar(&path, "path", "", "application status JSON path")
	flag.StringVar(&schemaPath, "schema", "", "allowed public detail schema path")
	flag.Int64Var(&generation, "generation", -1, "current session generation")
	flag.IntVar(&recordIBusPID, "record-ibus-pid", -1, "record actual private IBus launch identity (0 explicitly disabled)")
	flag.StringVar(&state, "state", "", "application state")
	flag.StringVar(&summary, "summary", "", "short public summary")
	flag.StringVar(&errorText, "error", "", "safe public error")
	flag.Var(&stringsFlag, "detail-string", "public string detail as name=value")
	flag.Var(&booleansFlag, "detail-bool", "public boolean detail as name=true|false")
	flag.Var(&integersFlag, "detail-integer", "public integer detail as name=value")
	flag.Var(&jsonFlag, "detail-json", "bounded public JSON detail as name=JSON")
	flag.BoolVar(&connectionMetadata, "connection-metadata", false, "publish private session connection metadata separately")
	flag.StringVar(&connectionApplication, "connection-application", "", "declared private application connection JSON")
	flag.Parse()
	if recordIBusPID >= 0 {
		if err := recordIBus(path, generation, recordIBusPID); err != nil {
			fmt.Fprintln(os.Stderr, "remotexapp-status: IBus launch identity rejected")
			os.Exit(1)
		}
		return
	}
	if connectionMetadata {
		if err := reportConnections(path, generation, state, connectionApplication); err != nil {
			fmt.Fprintln(os.Stderr, "remotexapp-status: private connection metadata rejected")
			os.Exit(1)
		}
	}
	if err := report(path, schemaPath, generation, state, summary, errorText, stringsFlag, booleansFlag, integersFlag, jsonFlag); err != nil {
		fmt.Fprintln(os.Stderr, "remotexapp-status:", err)
		os.Exit(1)
	}
}

func report(path, schemaPath string, generation int64, state, summary, errorText string, stringsFlag, booleansFlag, integersFlag, jsonFlag []string) error {
	if path == "" || schemaPath == "" || generation < 1 {
		return errors.New("path, schema, and a positive generation are required")
	}
	if !validState(state) {
		return fmt.Errorf("invalid state %q", state)
	}
	if len(summary) > 4096 || len(errorText) > 8192 {
		return errors.New("summary or error exceeds its public size limit")
	}
	definitions, err := readSchema(schemaPath)
	if err != nil {
		return err
	}
	details := make(map[string]any)
	for _, raw := range stringsFlag {
		name, value, err := splitDetail(raw)
		if err != nil {
			return err
		}
		if err := addDetail(details, definitions, name, value, "string"); err != nil {
			return err
		}
	}
	for _, raw := range booleansFlag {
		name, text, err := splitDetail(raw)
		if err != nil {
			return err
		}
		value, err := strconv.ParseBool(text)
		if err != nil {
			return fmt.Errorf("detail %q must be true or false", name)
		}
		if err := addDetail(details, definitions, name, value, "boolean"); err != nil {
			return err
		}
	}
	for _, raw := range integersFlag {
		name, text, err := splitDetail(raw)
		if err != nil {
			return err
		}
		value, err := strconv.ParseInt(text, 10, 64)
		if err != nil {
			return fmt.Errorf("detail %q must be an integer", name)
		}
		if err := addDetail(details, definitions, name, value, "integer"); err != nil {
			return err
		}
	}
	for _, raw := range jsonFlag {
		name, text, err := splitDetail(raw)
		if err != nil {
			return err
		}
		decoder := json.NewDecoder(strings.NewReader(text))
		decoder.UseNumber()
		var value any
		if err := decoder.Decode(&value); err != nil {
			return fmt.Errorf("detail %q must be valid JSON", name)
		}
		var extra any
		if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
			return fmt.Errorf("detail %q must contain one JSON value", name)
		}
		if err := addDetail(details, definitions, name, value, "json"); err != nil {
			return err
		}
	}

	previous, err := readStatus(path)
	if err != nil {
		return fmt.Errorf("read current status: %w", err)
	}
	if previous.Generation != generation {
		return fmt.Errorf("stale generation %d; current generation is %d", generation, previous.Generation)
	}
	now := time.Now()
	status := applicationStatus{
		Generation: generation, Revision: previous.Revision + 1, State: state,
		UpdatedAt: now, LastReadyAt: previous.LastReadyAt, Summary: summary, Details: details, Error: errorText,
	}
	if state == "ready" {
		status.LastReadyAt = &now
	}
	payload, err := json.MarshalIndent(status, "", "  ")
	if err != nil {
		return err
	}
	return writeAtomic(path, append(payload, '\n'))
}

func readSchema(path string) (map[string]detailDefinition, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("open schema: %w", err)
	}
	defer file.Close()
	if info, err := file.Stat(); err != nil {
		return nil, err
	} else if info.Size() > 64<<10 {
		return nil, errors.New("schema exceeds 65536 bytes")
	}
	definitions := map[string]detailDefinition{}
	decoder := json.NewDecoder(io.LimitReader(file, 64<<10))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&definitions); err != nil {
		return nil, fmt.Errorf("decode schema: %w", err)
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		return nil, errors.New("schema must contain exactly one JSON object")
	}
	return definitions, nil
}

func readStatus(path string) (*applicationStatus, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	if info, err := file.Stat(); err != nil {
		return nil, err
	} else if info.Size() > 64<<10 {
		return nil, errors.New("current status exceeds 65536 bytes")
	}
	var status applicationStatus
	decoder := json.NewDecoder(io.LimitReader(file, 64<<10))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&status); err != nil {
		return nil, err
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		return nil, errors.New("current status must contain exactly one JSON object")
	}
	if status.Revision < 1 {
		return nil, errors.New("current status has an invalid revision")
	}
	return &status, nil
}

func splitDetail(raw string) (string, string, error) {
	name, value, found := strings.Cut(raw, "=")
	if !found || name == "" {
		return "", "", fmt.Errorf("detail %q must use name=value", raw)
	}
	return name, value, nil
}

func addDetail(details map[string]any, definitions map[string]detailDefinition, name string, value any, suppliedType string) error {
	if _, exists := details[name]; exists {
		return fmt.Errorf("detail %q was supplied more than once", name)
	}
	definition, exists := definitions[name]
	if !exists {
		return fmt.Errorf("detail %q is not declared by the template", name)
	}
	expectedType := definition.Type
	if expectedType == "enum" || expectedType == "url" {
		expectedType = "string"
	}
	if suppliedType != expectedType {
		return fmt.Errorf("detail %q requires type %s", name, definition.Type)
	}
	if err := validateDetail(definition, value); err != nil {
		return fmt.Errorf("detail %q: %w", name, err)
	}
	details[name] = value
	return nil
}

func validateDetail(definition detailDefinition, value any) error {
	switch definition.Type {
	case "boolean":
		return nil
	case "integer":
		integer := value.(int64)
		if definition.Minimum != nil && integer < *definition.Minimum {
			return fmt.Errorf("must be at least %d", *definition.Minimum)
		}
		if definition.Maximum != nil && integer > *definition.Maximum {
			return fmt.Errorf("must be at most %d", *definition.Maximum)
		}
		return nil
	case "string", "enum", "url":
		text := value.(string)
		if strings.IndexFunc(text, unicode.IsControl) >= 0 {
			return errors.New("must not contain control characters")
		}
		limit := definition.MaxLength
		if limit == 0 {
			limit = 8192
		}
		if len(text) > limit {
			return fmt.Errorf("must not exceed %d bytes", limit)
		}
		if definition.Type == "enum" && !slices.Contains(definition.Values, text) {
			return fmt.Errorf("must be one of %s", strings.Join(definition.Values, ", "))
		}
		if definition.Type == "url" {
			parsed, err := url.Parse(text)
			if err != nil || parsed.Scheme == "" || !slices.Contains(definition.AllowedSchemes, strings.ToLower(parsed.Scheme)) {
				return errors.New("must use an allowed URL scheme")
			}
		}
		return nil
	case "json":
		return validateBoundedJSON(value, definition.MaxBytes, definition.MaxDepth, definition.MaxItems)
	default:
		return fmt.Errorf("unsupported schema type %q", definition.Type)
	}
}

func validateBoundedJSON(value any, maxBytes, maxDepth, maxItems int) error {
	if maxBytes < 1 || maxBytes > 65536 || maxDepth < 1 || maxDepth > 16 || maxItems < 1 || maxItems > 1024 {
		return errors.New("schema has invalid JSON bounds")
	}
	payload, err := json.Marshal(value)
	if err != nil {
		return errors.New("must be valid JSON")
	}
	if len(payload) > maxBytes {
		return fmt.Errorf("must not exceed %d encoded bytes", maxBytes)
	}
	items := 0
	var visit func(any, int) error
	visit = func(current any, depth int) error {
		if depth > maxDepth {
			return fmt.Errorf("must not exceed nesting depth %d", maxDepth)
		}
		switch typed := current.(type) {
		case nil, bool, string, json.Number, float64:
			return nil
		case []any:
			items += len(typed)
			if items > maxItems {
				return fmt.Errorf("must not exceed %d collection items", maxItems)
			}
			for _, child := range typed {
				if err := visit(child, depth+1); err != nil {
					return err
				}
			}
			return nil
		case map[string]any:
			items += len(typed)
			if items > maxItems {
				return fmt.Errorf("must not exceed %d collection items", maxItems)
			}
			for _, child := range typed {
				if err := visit(child, depth+1); err != nil {
					return err
				}
			}
			return nil
		default:
			return errors.New("must contain only JSON values")
		}
	}
	return visit(value, 1)
}

func validState(state string) bool {
	switch state {
	case "starting", "loading", "ready", "error", "exited":
		return true
	default:
		return false
	}
}

func writeAtomic(path string, payload []byte) error {
	temporary, err := os.CreateTemp(filepath.Dir(path), ".driver-status-*.tmp")
	if err != nil {
		return err
	}
	temporaryName := temporary.Name()
	defer os.Remove(temporaryName)
	if err := temporary.Chmod(0o600); err != nil {
		_ = temporary.Close()
		return err
	}
	if _, err := temporary.Write(payload); err != nil {
		_ = temporary.Close()
		return err
	}
	if err := temporary.Sync(); err != nil {
		_ = temporary.Close()
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	return os.Rename(temporaryName, path)
}
