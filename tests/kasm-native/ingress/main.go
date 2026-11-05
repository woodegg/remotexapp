// Disposable UAT ingress. The allowed edge must verify Cloudflare Access before
// forwarding requests; this fixture deliberately shares one test account.
package main

import (
	"encoding/json"
	"flag"
	"log"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"strings"
	"time"
)

type fixture struct {
	BaseURL        string `json:"baseURL"`
	DocumentFile   string `json:"documentFile"`
	ManagedID      string `json:"managedId"`
	TemplateID     string `json:"templateId"`
	RichTemplateID string `json:"richTemplateId,omitempty"`
}

func handler(target *url.URL, page []byte, config fixture, edge string) http.Handler {
	proxy := httputil.NewSingleHostReverseProxy(target)
	direct := proxy.Director
	proxy.Director = func(r *http.Request) {
		direct(r)
		r.Header.Set("X-RemoteXApp-Test-User", "alpine-uat")
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		peer, _, err := net.SplitHostPort(r.RemoteAddr)
		ip := net.ParseIP(peer)
		if err != nil || ip == nil || (!ip.IsLoopback() && peer != edge) {
			http.Error(w, "untrusted ingress peer", http.StatusForbidden)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		switch {
		case r.URL.Path == "/" && r.Method == http.MethodGet:
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			_, _ = w.Write(page)
		case r.URL.Path == "/fixture-config" && r.Method == http.MethodGet:
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(config)
		case strings.HasPrefix(r.URL.Path, "/rx/"):
			r.URL.Path = strings.TrimPrefix(r.URL.Path, "/rx")
			r.URL.RawPath = ""
			proxy.ServeHTTP(w, r)
		default:
			http.NotFound(w, r)
		}
	})
}

func main() {
	listen := flag.String("listen", "127.0.0.1:8080", "private fixture listener")
	edge := flag.String("trusted-edge", "", "single Access-verifying edge IP; loopback also allowed")
	manager := flag.String("manager", "http://127.0.0.1:1991", "loopback Manager")
	pagePath := flag.String("page", "", "UAT HTML file")
	config := fixture{BaseURL: "/rx"}
	flag.StringVar(&config.DocumentFile, "document", "", "owned test document")
	flag.StringVar(&config.ManagedID, "managed-id", "", "owned managed desktop")
	flag.StringVar(&config.TemplateID, "template", "alpine-mousepad", "test editor template")
	flag.StringVar(&config.RichTemplateID, "rich-template", "", "optional rich clipboard editor template")
	flag.Parse()
	target, err := url.Parse(*manager)
	if err != nil || target.Scheme != "http" || !net.ParseIP(target.Hostname()).IsLoopback() || target.User != nil || target.Path != "" {
		log.Fatal("manager must be a plain loopback HTTP origin")
	}
	if *edge != "" && net.ParseIP(*edge) == nil {
		log.Fatal("trusted-edge must be an IP")
	}
	if config.DocumentFile == "" || config.ManagedID == "" {
		log.Fatal("document and managed-id are required")
	}
	page, err := os.ReadFile(*pagePath)
	if err != nil {
		log.Fatal(err)
	}
	s := &http.Server{Addr: *listen, Handler: handler(target, page, config, *edge), ReadHeaderTimeout: 10 * time.Second}
	log.Fatal(s.ListenAndServe())
}
