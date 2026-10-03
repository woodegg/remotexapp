package main

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"mime"
	"mime/multipart"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"
	"unicode/utf8"
)

const managerClipboardRequestLimit = (80 << 20) + (1 << 20)

func (m *manager) serveClipboard(w http.ResponseWriter, r *http.Request, item *instance, parts []string) {
	if len(parts) < 3 || parts[1] != "clipboard" {
		http.NotFound(w, r)
		return
	}
	if item.State != "server-ready" && item.State != "ready" {
		writeError(w, http.StatusConflict, "instance is not ready")
		return
	}
	if item.SessionState != "running" || item.SessionGeneration < 1 {
		writeError(w, http.StatusConflict, "application session is not active")
		return
	}
	generation, err := strconv.ParseInt(r.Header.Get("X-RemoteXApp-Session-Generation"), 10, 64)
	if err != nil || generation < 1 {
		writeError(w, http.StatusBadRequest, "positive X-RemoteXApp-Session-Generation is required")
		return
	}
	if generation != item.SessionGeneration {
		writeError(w, http.StatusConflict, "stale session generation")
		return
	}
	if (m.cfg.authMode == "" || m.cfg.authMode == "none") && !listenIsLoopback(m.cfg.listen) && !m.cfg.allowInsecure {
		writeError(w, http.StatusForbidden, "clipboard requires authentication or explicit insecure-public testing opt-in")
		return
	}

	internalPath := ""
	switch {
	case len(parts) == 3 && parts[2] == "capabilities" && r.Method == http.MethodGet:
		internalPath = "/v1/capabilities"
	case len(parts) == 3 && parts[2] == "offers" && (r.Method == http.MethodGet || r.Method == http.MethodPost):
		internalPath = "/v1/offers"
	case len(parts) == 4 && parts[2] == "offers" && (r.Method == http.MethodGet || r.Method == http.MethodDelete):
		if !validClipboardOfferID(parts[3]) {
			writeError(w, http.StatusBadRequest, "invalid clipboard offer ID")
			return
		}
		internalPath = "/v1/offers/" + parts[3]
	case len(parts) == 5 && parts[2] == "offers" && parts[4] == "accept" && r.Method == http.MethodPost:
		if !validClipboardOfferID(parts[3]) {
			writeError(w, http.StatusBadRequest, "invalid clipboard offer ID")
			return
		}
		internalPath = "/v1/offers/" + parts[3] + "/accept"
	default:
		methodNotAllowed(w, "GET, POST, DELETE")
		return
	}
	var validation <-chan error
	if r.Method == http.MethodPost && internalPath == "/v1/offers" {
		if !strings.HasPrefix(strings.ToLower(r.Header.Get("Content-Type")), "multipart/form-data;") {
			writeError(w, http.StatusUnsupportedMediaType, "clipboard offer requires multipart/form-data")
			return
		}
		if action := r.Header.Get("X-RemoteXApp-Clipboard-Action"); action != "set" && action != "paste" {
			writeError(w, http.StatusBadRequest, "clipboard action must be set or paste")
			return
		}
		if !validClipboardViewerID(r.Header.Get("X-RemoteXApp-Viewer-ID")) {
			writeError(w, http.StatusBadRequest, "valid clipboard Viewer ID is required")
			return
		}
		if r.ContentLength > managerClipboardRequestLimit {
			writeError(w, http.StatusRequestEntityTooLarge, "clipboard multipart request exceeds platform limit")
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, managerClipboardRequestLimit)
		stream, contentType, result, err := validateManagerClipboardMultipart(r)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		r.Body = stream
		r.Header.Set("Content-Type", contentType)
		r.Header.Del("Content-Length")
		validation = result
	}
	if r.Method == http.MethodDelete && !validClipboardViewerID(r.Header.Get("X-RemoteXApp-Viewer-ID")) {
		writeError(w, http.StatusBadRequest, "valid clipboard Viewer ID is required")
		return
	}
	if err := m.proxyClipboard(w, r, item, internalPath, validation); err != nil {
		status := http.StatusConflict
		var validationErr *clipboardValidationError
		if errors.As(err, &validationErr) {
			status = http.StatusBadRequest
		}
		writeError(w, status, err.Error())
	}
}

func (m *manager) proxyClipboard(w http.ResponseWriter, r *http.Request, item *instance, internalPath string, validation <-chan error) error {
	socketPath := filepath.Join(item.SocketRuntime, "clipboard.sock")
	if err := validateClipboardSocket(socketPath); err != nil {
		return fmt.Errorf("clipboard is unavailable for this pinned runtime: %w", err)
	}
	request, err := http.NewRequestWithContext(r.Context(), r.Method, "http://remotexapp.internal"+internalPath, r.Body)
	if err != nil {
		return err
	}
	for _, name := range []string{
		"Content-Type", "X-RemoteXApp-Session-Generation",
		"X-RemoteXApp-Clipboard-Action", "X-RemoteXApp-Viewer-ID",
		"X-RemoteXApp-Clipboard-Sequence",
	} {
		if value := r.Header.Get(name); value != "" {
			request.Header.Set(name, value)
		}
	}
	response, err := clipboardHTTPClient(socketPath).Do(request)
	if err != nil {
		if validation != nil {
			if validationErr := <-validation; validationErr != nil {
				return validationErr
			}
		}
		return fmt.Errorf("private gateway clipboard request failed: %w", err)
	}
	defer response.Body.Close()
	if validation != nil {
		if validationErr := <-validation; validationErr != nil {
			return validationErr
		}
	}
	for _, name := range []string{"Content-Type", "Cache-Control", "X-RemoteXApp-Clipboard-Offer-ID"} {
		if value := response.Header.Get(name); value != "" {
			w.Header().Set(name, value)
		}
	}
	w.WriteHeader(response.StatusCode)
	_, _ = io.Copy(w, io.LimitReader(response.Body, managerClipboardRequestLimit))
	return nil
}

type clipboardValidationError struct{ message string }

func (e *clipboardValidationError) Error() string { return e.message }

func validateManagerClipboardMultipart(r *http.Request) (io.ReadCloser, string, <-chan error, error) {
	_, parameters, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || parameters["boundary"] == "" {
		return nil, "", nil, errors.New("invalid clipboard multipart boundary")
	}
	reader, writer := io.Pipe()
	source := r.Body
	result := make(chan error, 1)
	go func() {
		defer source.Close()
		validationErr := validateManagerClipboardParts(multipart.NewReader(io.TeeReader(source, writer), parameters["boundary"]))
		if validationErr != nil {
			validationErr = &clipboardValidationError{message: validationErr.Error()}
			_ = writer.CloseWithError(validationErr)
		} else {
			_ = writer.Close()
		}
		result <- validationErr
		close(result)
	}()
	return reader, r.Header.Get("Content-Type"), result, nil
}

func validateManagerClipboardParts(reader *multipart.Reader) error {
	limits := map[string]int64{"text/plain": 4 << 20, "text/html": 4 << 20, "text/rtf": 16 << 20, "image/png": 64 << 20}
	seen := make(map[string]bool)
	populated := make(map[string]bool)
	var total int64
	for {
		part, err := reader.NextPart()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return fmt.Errorf("read clipboard multipart: %w", err)
		}
		mediaType := managerClipboardType(part.Header.Get("Content-Type"))
		limit, ok := limits[mediaType]
		if !ok || seen[mediaType] {
			_ = part.Close()
			return fmt.Errorf("unsupported or duplicate clipboard representation %q", mediaType)
		}
		prefix := make([]byte, 24)
		seen[mediaType] = true
		prefixBytes, prefixErr := io.ReadFull(part, prefix)
		if errors.Is(prefixErr, io.EOF) && prefixBytes == 0 {
			_ = part.Close()
			continue
		}
		if prefixErr != nil && !errors.Is(prefixErr, io.ErrUnexpectedEOF) {
			_ = part.Close()
			return fmt.Errorf("read %s clipboard representation: %w", mediaType, prefixErr)
		}
		remaining := io.LimitReader(part, limit-int64(prefixBytes)+1)
		var count int64
		if mediaType == "text/plain" || mediaType == "text/html" {
			valueReader := bufio.NewReader(io.MultiReader(bytes.NewReader(prefix[:prefixBytes]), remaining))
			for {
				character, size, readErr := valueReader.ReadRune()
				if errors.Is(readErr, io.EOF) {
					break
				}
				if readErr != nil {
					_ = part.Close()
					return fmt.Errorf("read %s clipboard representation: %w", mediaType, readErr)
				}
				if character == utf8.RuneError && size == 1 {
					_ = part.Close()
					return fmt.Errorf("%s clipboard representation is not valid UTF-8", mediaType)
				}
				count += int64(size)
				if count > limit {
					break
				}
			}
			count -= int64(prefixBytes)
		} else {
			count, err = io.Copy(io.Discard, remaining)
		}
		_ = part.Close()
		if err != nil {
			return fmt.Errorf("read %s clipboard representation: %w", mediaType, err)
		}
		size := int64(prefixBytes) + count
		if size < 1 || size > limit {
			return fmt.Errorf("%s clipboard representation exceeds its platform limit", mediaType)
		}
		total += size
		if total > 80<<20 {
			return errors.New("clipboard offer exceeds the platform total limit")
		}
		if mediaType == "image/png" {
			if prefixBytes < 24 || string(prefix[:8]) != "\x89PNG\r\n\x1a\n" || string(prefix[12:16]) != "IHDR" {
				return errors.New("image/png clipboard representation has an invalid signature or IHDR")
			}
			width := int64(prefix[16])<<24 | int64(prefix[17])<<16 | int64(prefix[18])<<8 | int64(prefix[19])
			height := int64(prefix[20])<<24 | int64(prefix[21])<<16 | int64(prefix[22])<<8 | int64(prefix[23])
			if width < 1 || height < 1 || width > 32768 || height > 32768 || width*height > 100_000_000 {
				return errors.New("image/png clipboard dimensions exceed the platform limit")
			}
		}
		populated[mediaType] = true
	}
	if len(seen) == 0 {
		return errors.New("clipboard offer has no representations")
	}
	if populated["text/html"] && !populated["text/plain"] {
		return errors.New("text/html clipboard representation requires text/plain fallback")
	}
	return nil
}

func managerClipboardType(value string) string {
	value = strings.ToLower(strings.TrimSpace(strings.Split(value, ";")[0]))
	if value == "application/rtf" {
		return "text/rtf"
	}
	return value
}

func clipboardHTTPClient(socketPath string) *http.Client {
	transport := &http.Transport{
		DisableKeepAlives: true,
		DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
			return (&net.Dialer{Timeout: time.Second}).DialContext(ctx, "unix", socketPath)
		},
	}
	return &http.Client{Transport: transport, Timeout: 90 * time.Second}
}

func validateClipboardSocket(path string) error {
	info, err := os.Lstat(path)
	if err != nil {
		return err
	}
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok || info.Mode()&os.ModeSocket == 0 || info.Mode().Perm() != 0o600 || int(stat.Uid) != os.Getuid() {
		return errors.New("private socket must be owner-only and owned by the service UID")
	}
	return nil
}

func validClipboardViewerID(value string) bool {
	value = strings.TrimSpace(value)
	if len(value) < 10 || len(value) > 96 || !strings.HasPrefix(value, "viewer_") {
		return false
	}
	for _, character := range value[len("viewer_"):] {
		if (character < 'a' || character > 'z') && (character < 'A' || character > 'Z') &&
			(character < '0' || character > '9') && character != '-' && character != '_' {
			return false
		}
	}
	return true
}

func validClipboardOfferID(value string) bool {
	if len(value) != len("clp_")+32 || !strings.HasPrefix(value, "clp_") {
		return false
	}
	for _, character := range value[len("clp_"):] {
		if (character < '0' || character > '9') && (character < 'a' || character > 'f') {
			return false
		}
	}
	return true
}

func (m *manager) setGatewayClipboardSession(item *instance, generation int64, active bool) error {
	if item == nil || item.SocketRuntime == "" {
		return nil
	}
	socketPath := filepath.Join(item.SocketRuntime, "clipboard.sock")
	if _, err := os.Lstat(socketPath); errors.Is(err, os.ErrNotExist) {
		// A retained pre-0.4 gateway is intentionally compatible but does not
		// acquire clipboard support until its runtime is naturally recreated.
		return nil
	} else if err != nil {
		return err
	}
	if err := validateClipboardSocket(socketPath); err != nil {
		return err
	}
	body := strings.NewReader(fmt.Sprintf(`{"generation":%d,"active":%t}`, generation, active))
	request, err := http.NewRequest(http.MethodPost, "http://remotexapp.internal/v1/session", body)
	if err != nil {
		return err
	}
	request.Header.Set("Content-Type", "application/json")
	response, err := clipboardHTTPClient(socketPath).Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("gateway clipboard session returned HTTP %d", response.StatusCode)
	}
	return nil
}
