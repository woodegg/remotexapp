package main

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha1" // coturn's timestamped TURN REST credentials use HMAC-SHA1.
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

type turnLeaseToken struct{}

type turnConfiguration struct {
	URL        string `json:"url"`
	SecretFile string `json:"secretFile"`
	secret     []byte
}

func (c *turnConfiguration) load() error {
	address, ok := strings.CutPrefix(c.URL, "turn:")
	host, port, err := net.SplitHostPort(address)
	n, portErr := strconv.Atoi(strings.TrimSuffix(port, "?transport=udp"))
	if !ok || err != nil || host == "" || strings.ContainsAny(host, "/?#@ \t\r\n") || portErr != nil || n < 1 || n > 65535 {
		return errors.New("TURN URL must specify a host and UDP listener port")
	}
	if !filepath.IsAbs(c.SecretFile) || filepath.Clean(c.SecretFile) != c.SecretFile {
		return errors.New("TURN secret requires an absolute file path")
	}
	file, err := os.Open(c.SecretFile)
	if err != nil {
		return errors.New("cannot open TURN secret")
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Mode().Perm()&0077 != 0 || info.Size() > 128 {
		return errors.New("TURN secret must be a private regular file")
	}
	raw, err := io.ReadAll(io.LimitReader(file, 129))
	c.secret = bytes.TrimSpace(raw)
	if err != nil || len(c.secret) < 32 || len(c.secret) > 128 {
		return errors.New("invalid TURN secret")
	}
	return nil
}

type turnIceServer struct {
	URLs       string `json:"urls"`
	Username   string `json:"username"`
	Credential string `json:"credential"`
}

func (c *turnConfiguration) credentials(token string, now time.Time) turnIceServer {
	digest := sha256.Sum256([]byte(token))
	// Only the grant's anonymous digest appears in the TURN username.
	username := fmt.Sprintf("%d:%x", now.Add(15*time.Minute).Unix(), digest[:12])
	mac := hmac.New(sha1.New, c.secret)
	mac.Write([]byte(username))
	return turnIceServer{c.URL, username, base64.StdEncoding.EncodeToString(mac.Sum(nil))}
}

func (c *turnConfiguration) enrich(r *http.Response, token string) error {
	raw, err := io.ReadAll(io.LimitReader(r.Body, 4097))
	r.Body.Close()
	if err != nil || len(raw) > 4096 {
		return errors.New("invalid Viewer grant response")
	}
	var data map[string]any
	if err := json.Unmarshal(raw, &data); err != nil || data == nil {
		return errors.New("invalid Viewer grant response")
	}
	delete(data, "turn")
	if mode, _ := data["webRTCMode"].(string); mode == "turn" {
		if token == "" {
			token, _ = data["token"].(string)
		}
		if !digestPattern.MatchString(token) {
			return errors.New("invalid Viewer grant credential")
		}
		data["turn"] = c.credentials(token, time.Now())
	}
	raw, err = json.Marshal(data)
	if err != nil {
		return err
	}
	r.ContentLength = int64(len(raw))
	r.Header.Set("Content-Length", strconv.Itoa(len(raw)))
	r.Body = io.NopCloser(bytes.NewReader(raw))
	return nil
}
