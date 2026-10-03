package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"time"
	"unicode"
)

type parameterDefinition struct {
	Type           string          `json:"type"`
	Required       bool            `json:"required,omitempty"`
	Default        json.RawMessage `json:"default,omitempty"`
	Values         []string        `json:"values,omitempty"`
	Minimum        *int64          `json:"minimum,omitempty"`
	Maximum        *int64          `json:"maximum,omitempty"`
	MaxLength      int             `json:"maxLength,omitempty"`
	MaxBytes       int             `json:"maxBytes,omitempty"`
	MaxDepth       int             `json:"maxDepth,omitempty"`
	MaxItems       int             `json:"maxItems,omitempty"`
	AllowedSchemes []string        `json:"allowedSchemes,omitempty"`
}

var safeParameterName = regexp.MustCompile(`^[a-z][A-Za-z0-9]{0,63}$`)

func validateParameterDefinitions(definitions map[string]parameterDefinition) error {
	for name, definition := range definitions {
		if !safeParameterName.MatchString(name) {
			return fmt.Errorf("parameter name %q is invalid", name)
		}
		switch definition.Type {
		case "string", "boolean", "integer", "enum", "url", "file", "json":
		default:
			return fmt.Errorf("%s has unsupported type %q", name, definition.Type)
		}
		if definition.MaxLength < 0 || definition.MaxLength > 65536 {
			return fmt.Errorf("%s maxLength must be between 0 and 65536", name)
		}
		if definition.Type == "json" {
			if definition.MaxBytes < 1 || definition.MaxBytes > 65536 || definition.MaxDepth < 1 || definition.MaxDepth > 16 || definition.MaxItems < 1 || definition.MaxItems > 1024 {
				return fmt.Errorf("%s JSON requires maxBytes 1..65536, maxDepth 1..16, and maxItems 1..1024", name)
			}
		} else if definition.MaxBytes != 0 || definition.MaxDepth != 0 || definition.MaxItems != 0 {
			return fmt.Errorf("%s JSON bounds require type json", name)
		}
		if definition.Minimum != nil && definition.Maximum != nil && *definition.Minimum > *definition.Maximum {
			return fmt.Errorf("%s minimum exceeds maximum", name)
		}
		if definition.Type == "enum" && len(definition.Values) == 0 {
			return fmt.Errorf("%s enum requires values", name)
		}
		if definition.Type == "url" && len(definition.AllowedSchemes) == 0 {
			return fmt.Errorf("%s URL requires allowedSchemes", name)
		}
		if definition.Type == "file" && len(definition.Default) != 0 {
			return fmt.Errorf("%s file parameter cannot declare a host-dependent default", name)
		}
		for _, scheme := range definition.AllowedSchemes {
			if scheme != strings.ToLower(scheme) || scheme == "" {
				return fmt.Errorf("%s has invalid allowed scheme %q", name, scheme)
			}
		}
		if len(definition.Default) != 0 {
			value, err := decodeParameterDefault(definition.Default)
			if err != nil {
				return fmt.Errorf("%s default: %w", name, err)
			}
			if _, err := validateParameterValue(name, definition, value); err != nil {
				return fmt.Errorf("%s default: %w", name, err)
			}
		}
	}
	return nil
}

func decodeParameterDefault(raw json.RawMessage) (any, error) {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	var value any
	if err := decoder.Decode(&value); err != nil {
		return nil, err
	}
	return value, nil
}

func resolveLaunchParameters(definitions map[string]parameterDefinition, supplied map[string]any, documentRoots []string) (map[string]any, error) {
	return resolveLaunchParametersWithFiles(definitions, supplied, documentRoots, true)
}

// Durable configuration loading validates syntax, not live storage. New launch
// and upgrade requests must always perform the file checks before running a Driver.
func resolveLaunchParametersWithFiles(definitions map[string]parameterDefinition, supplied map[string]any, documentRoots []string, checkFiles bool) (map[string]any, error) {
	if supplied == nil {
		supplied = map[string]any{}
	}
	for name := range supplied {
		if _, exists := definitions[name]; !exists {
			return nil, fmt.Errorf("unknown launch parameter %q", name)
		}
	}
	resolved := make(map[string]any, len(definitions))
	for name, definition := range definitions {
		value, exists := supplied[name]
		if !exists && len(definition.Default) != 0 {
			var err error
			value, err = decodeParameterDefault(definition.Default)
			if err != nil {
				return nil, fmt.Errorf("parameter %s: invalid template default: %w", name, err)
			}
			exists = true
		}
		if !exists {
			if definition.Required {
				return nil, fmt.Errorf("launch parameter %q is required", name)
			}
			continue
		}
		normalized, err := validateParameterValue(name, definition, value)
		if err != nil {
			return nil, fmt.Errorf("launch parameter %q: %w", name, err)
		}
		if definition.Type == "file" && checkFiles {
			normalized, err = resolveDocumentFile(normalized.(string), documentRoots)
			if err != nil {
				return nil, fmt.Errorf("launch parameter %q: %w", name, err)
			}
		}
		resolved[name] = normalized
	}
	return resolved, nil
}

func validateParameterValue(_ string, definition parameterDefinition, value any) (any, error) {
	switch definition.Type {
	case "boolean":
		boolean, ok := value.(bool)
		if !ok {
			return nil, errors.New("must be a boolean")
		}
		return boolean, nil
	case "integer":
		integer, ok := parameterInteger(value)
		if !ok {
			return nil, errors.New("must be an integer")
		}
		if definition.Minimum != nil && integer < *definition.Minimum {
			return nil, fmt.Errorf("must be at least %d", *definition.Minimum)
		}
		if definition.Maximum != nil && integer > *definition.Maximum {
			return nil, fmt.Errorf("must be at most %d", *definition.Maximum)
		}
		return integer, nil
	case "string", "enum", "url", "file":
		text, ok := value.(string)
		if !ok {
			return nil, errors.New("must be a string")
		}
		if strings.IndexFunc(text, unicode.IsControl) >= 0 {
			return nil, errors.New("must not contain control characters")
		}
		limit := definition.MaxLength
		if limit == 0 {
			limit = 8192
		}
		if len(text) > limit {
			return nil, fmt.Errorf("must not exceed %d bytes", limit)
		}
		if definition.Type == "enum" && !slices.Contains(definition.Values, text) {
			return nil, fmt.Errorf("must be one of %s", strings.Join(definition.Values, ", "))
		}
		if definition.Type == "url" {
			parsed, err := url.Parse(text)
			if err != nil || parsed.Scheme == "" || !slices.Contains(definition.AllowedSchemes, strings.ToLower(parsed.Scheme)) {
				return nil, fmt.Errorf("must use an allowed URL scheme (%s)", strings.Join(definition.AllowedSchemes, ", "))
			}
			if parsed.Scheme == "about" && text != "about:blank" {
				return nil, errors.New("only about:blank is allowed for the about scheme")
			}
			if (parsed.Scheme == "http" || parsed.Scheme == "https") && parsed.Host == "" {
				return nil, errors.New("HTTP(S) URL must include a host")
			}
		}
		if definition.Type == "file" && !filepath.IsAbs(text) {
			return nil, errors.New("must be an absolute server-side path")
		}
		return text, nil
	case "json":
		if err := validateBoundedJSON(value, definition.MaxBytes, definition.MaxDepth, definition.MaxItems); err != nil {
			return nil, err
		}
		return value, nil
	default:
		return nil, fmt.Errorf("unsupported type %q", definition.Type)
	}
}

func validateBoundedJSON(value any, maxBytes, maxDepth, maxItems int) error {
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
		case nil, bool, string, json.Number, float64, int, int64:
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

func resolveDocumentRoots(spec, stateDir string) ([]string, error) {
	if strings.IndexFunc(spec, unicode.IsControl) >= 0 {
		return nil, errors.New("document roots must not contain control characters")
	}
	rawRoots := filepath.SplitList(strings.TrimSpace(spec))
	if len(rawRoots) == 0 {
		defaultRoot := filepath.Join(stateDir, "documents")
		if err := os.MkdirAll(defaultRoot, 0o700); err != nil {
			return nil, fmt.Errorf("create default document root: %w", err)
		}
		rawRoots = []string{defaultRoot}
	}
	roots := make([]string, 0, len(rawRoots))
	seen := make(map[string]bool, len(rawRoots))
	for _, raw := range rawRoots {
		if strings.TrimSpace(raw) == "" || !filepath.IsAbs(raw) || strings.IndexFunc(raw, unicode.IsControl) >= 0 {
			return nil, fmt.Errorf("document root must be an absolute path: %q", raw)
		}
		// Keep the explicit allowlist even when a mount is missing or unhealthy.
		// Never replace an unavailable root with its parent or the default root.
		root := filepath.Clean(raw)
		if !seen[root] {
			seen[root] = true
			roots = append(roots, root)
		}
	}
	return roots, nil
}

func resolveAvailableDocumentRoot(root string) (string, error) {
	resolved, err := filepath.EvalSymlinks(root)
	if err != nil {
		return "", fmt.Errorf("resolve document root %q: %w", root, err)
	}
	info, err := os.Stat(resolved)
	if err != nil {
		return "", fmt.Errorf("inspect document root %q: %w", root, err)
	}
	if !info.IsDir() {
		return "", fmt.Errorf("document root is not a directory: %s", root)
	}
	return resolved, nil
}

// One diagnostic per configured root per startup, outside the startup critical
// path. A stalled filesystem cannot hold up HTTP or hide other root errors.
// No retry workers are spawned; a stuck OS lookup is bounded to one per root.
func reportDocumentRootAvailability(roots []string, timeout time.Duration, check func(string) error, report func(string, ...any)) {
	for _, root := range roots {
		go func() {
			result := make(chan error, 1)
			go func() { result <- check(root) }()
			timer := time.NewTimer(timeout)
			defer timer.Stop()
			select {
			case err := <-result:
				if err != nil {
					report("ERROR document root unavailable %q: %v; Manager continues, file access will be checked on demand", root, err)
				}
			case <-timer.C:
				report("ERROR document root check timed out %q; Manager continues, file access will be checked on demand", root)
			}
		}()
	}
}

func documentPathWithin(root, path string) bool {
	relative, err := filepath.Rel(root, path)
	return err == nil && relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator))
}

func resolveDocumentFile(path string, roots []string) (string, error) {
	if len(roots) == 0 {
		return "", errors.New("no document root is configured")
	}
	resolved, err := filepath.EvalSymlinks(filepath.Clean(path))
	if err != nil {
		return "", fmt.Errorf("resolve file: %w", err)
	}
	info, err := os.Stat(resolved)
	if err != nil {
		return "", fmt.Errorf("inspect file: %w", err)
	}
	if !info.Mode().IsRegular() {
		return "", errors.New("must identify a regular file")
	}
	allowed := false
	// Try matching configured paths first, so an unrelated unavailable remote
	// root does not delay a file under an available local root. The fallback
	// retains support for a configured root alias and a canonical file path.
	ordered := append([]string(nil), roots...)
	slices.SortStableFunc(ordered, func(a, b string) int {
		am, bm := documentPathWithin(a, path), documentPathWithin(b, path)
		if am == bm {
			return 0
		}
		if am {
			return -1
		}
		return 1
	})
	for _, root := range ordered {
		canonical, err := resolveAvailableDocumentRoot(root)
		if err != nil {
			continue
		}
		if documentPathWithin(canonical, resolved) {
			allowed = true
			break
		}
	}
	if !allowed {
		return "", errors.New("file is outside the configured document roots")
	}
	file, err := os.Open(resolved)
	if err != nil {
		return "", fmt.Errorf("open file for reading: %w", err)
	}
	if err := file.Close(); err != nil {
		return "", fmt.Errorf("close file after access check: %w", err)
	}
	return resolved, nil
}

func parameterInteger(value any) (int64, bool) {
	switch number := value.(type) {
	case json.Number:
		integer, err := number.Int64()
		return integer, err == nil
	case float64:
		if math.Trunc(number) != number || number < math.MinInt64 || number > math.MaxInt64 {
			return 0, false
		}
		return int64(number), true
	case int:
		return int64(number), true
	case int64:
		return number, true
	default:
		return 0, false
	}
}

func writeLaunchParameters(runtime string, parameters map[string]any) (string, error) {
	payload, err := json.MarshalIndent(parameters, "", "  ")
	if err != nil {
		return "", err
	}
	payload = append(payload, '\n')
	path := filepath.Join(runtime, "launch-parameters.json")
	if err := os.WriteFile(path, payload, 0o600); err != nil {
		return "", err
	}
	if err := os.Chmod(path, 0o600); err != nil {
		return "", err
	}
	return path, nil
}
