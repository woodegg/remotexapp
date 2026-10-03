VERSION := $(shell cat VERSION)
COMMIT := $(shell git rev-parse --short=12 HEAD 2>/dev/null || printf unknown)
SOURCE_DATE_EPOCH ?= $(shell git log -1 --format=%ct 2>/dev/null || date +%s)
BUILD_DATE := $(shell date -u -d '@$(SOURCE_DATE_EPOCH)' +%Y-%m-%dT%H:%M:%SZ)
LDFLAGS := -s -w -X main.version=$(VERSION) -X main.commit=$(COMMIT) -X main.buildDate=$(BUILD_DATE)
COVERAGE_DIR ?= dist/coverage
SOAK_COUNT ?= 20
FUZZ_TIME ?= 10s
GO_TOOLCHAIN := go1.26.8

.PHONY: novnc-check web-assets build app-catalog check test test-race vet coverage-check soak-check fuzz-check integration-check live-e2e nightly-portable toolchain-check module-check vuln-check binary-vuln-check performance-docs-check sensitive-data-check evidence-check current-state-check workflow-check release-metadata-check release-check release-ci package-release install-user install-system deployment-check system-stage-test backend-build backend-test backend-test-race

toolchain-check:
	@test "$$(go env GOVERSION)" = "$(GO_TOOLCHAIN)" || { \
		echo "Go toolchain mismatch: got $$(go env GOVERSION), want $(GO_TOOLCHAIN)" >&2; exit 1; \
	}

module-check: toolchain-check
	go mod verify
	go mod tidy -diff

novnc-check:
	node scripts/check-novnc-vendor.mjs

web-assets: novnc-check
	node scripts/build-web-assets.mjs

build: toolchain-check web-assets
	mkdir -p bin
	go build -buildvcs=true -trimpath -ldflags '$(LDFLAGS)' -o bin/remotexappd ./cmd/remotexappd
	go build -buildvcs=true -trimpath -ldflags '-s -w' -o bin/novnc-input ./cmd/novnc-input
	go build -buildvcs=true -trimpath -ldflags '-s -w' -o bin/remotexapp-status ./cmd/remotexapp-status
	go build -buildvcs=true -trimpath -ldflags '-s -w' -o bin/remotexapp-operator-helper ./cmd/remotexapp-operator-helper

app-catalog: build
	mkdir -p .runtime/apps .runtime/apps-enabled
	./scripts/install-shipped-apps.sh "$(CURDIR)/bin/remotexappd" "$(CURDIR)/.runtime/apps" "$(CURDIR)/.runtime/apps-enabled"

performance-docs-check:
	node scripts/check-performance-docs.mjs

deployment-check:
	git ls-files -z '*.sh' | xargs -0 -r bash -n
	node scripts/check-deployment.mjs

system-stage-test: build
	./scripts/test-stage-system-release.sh

release-metadata-check:
	node scripts/check-release.mjs

sensitive-data-check:
	./scripts/check-sensitive-data.sh

evidence-check:
	node scripts/check-evidence.mjs

current-state-check:
	node scripts/generate-current-state.mjs --check

workflow-check:
	node scripts/check-workflows.mjs

test: web-assets performance-docs-check
	go test ./...
	node --test cmd/remotexappd/web/sdk/*.test.mjs
	node --test tests/app-package/*.test.mjs
	node --test tests/evidence/*.test.mjs
	node --test apps/*/tests/*.test.mjs

vet:
	go vet ./...

coverage-check:
	mkdir -p "$(COVERAGE_DIR)"
	go test -coverprofile="$(COVERAGE_DIR)/go.out" ./...
	go tool cover -func="$(COVERAGE_DIR)/go.out" | tee "$(COVERAGE_DIR)/go.txt"
	node scripts/check-go-coverage.mjs "$(COVERAGE_DIR)/go.txt" 56.8
	node --test --experimental-test-coverage \
		--test-coverage-exclude='**/*.test.mjs' \
		--test-coverage-lines=83.60 --test-coverage-branches=69.87 --test-coverage-functions=77.04 \
		cmd/remotexappd/web/sdk/*.test.mjs

soak-check:
	go test -shuffle=on -count=$(SOAK_COUNT) ./...
	@node_log="$$(mktemp)"; trap 'rm -f "$$node_log"' EXIT; \
	for iteration in $$(seq 1 $(SOAK_COUNT)); do \
		if ! node --test cmd/remotexappd/web/sdk/*.test.mjs tests/app-package/*.test.mjs tests/evidence/*.test.mjs apps/*/tests/*.test.mjs >"$$node_log" 2>&1; then \
			echo "Node soak iteration $$iteration failed" >&2; cat "$$node_log" >&2; exit 1; \
		fi; \
	done
	@echo "soak check passed: $(SOAK_COUNT) Go and Node iterations"

fuzz-check:
	go test ./cmd/novnc-input -run='^$$' -fuzz='^FuzzValidateClipboardPNG$$' -fuzztime=$(FUZZ_TIME)
	go test ./cmd/remotexappd -run='^$$' -fuzz='^FuzzManagerClipboardMultipart$$' -fuzztime=$(FUZZ_TIME)
	go test ./cmd/remotexappd -run='^$$' -fuzz='^FuzzBoundedJSONParameter$$' -fuzztime=$(FUZZ_TIME)

integration-check: build
	tests/app-package/run-local-e2e.sh

live-e2e: build
	tests/app-package/run-shipped-local-e2e.sh
	node tests/app-package/run-document-local-e2e.mjs
	node tests/app-package/run-upgrade-kde-local-e2e.mjs
	node tests/app-package/run-lightview-local-e2e.mjs

vuln-check: toolchain-check
	go tool govulncheck ./...

binary-vuln-check: build toolchain-check
	@for binary in remotexappd novnc-input remotexapp-status remotexapp-operator-helper; do \
		echo "scanning bin/$$binary"; \
		go tool govulncheck -mode binary "bin/$$binary" || exit 1; \
	done

check: toolchain-check module-check sensitive-data-check evidence-check current-state-check workflow-check test vet deployment-check

test-race:
	go test -race ./...

nightly-portable: check coverage-check vuln-check test-race soak-check fuzz-check

release-check: release-metadata-check check coverage-check vuln-check build binary-vuln-check test-race system-stage-test integration-check live-e2e
	./scripts/preflight.sh

release-ci: release-metadata-check check coverage-check vuln-check build binary-vuln-check test-race system-stage-test package-release

package-release: build
	./scripts/package-release.sh

install-user: build
	./scripts/install-user.sh

install-system:
	./scripts/install-system.sh

# Compatibility aliases retained for existing automation.
backend-build: build
backend-test: test
backend-test-race: test-race
