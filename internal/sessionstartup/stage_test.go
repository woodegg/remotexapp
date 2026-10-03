package sessionstartup

import (
	"strings"
	"testing"
)

func TestBoundedKnownStagesOnly(t *testing.T) {
	for _, stage := range []string{"D-Bus startup", "D-Bus readiness", "IBus startup", "IBus readiness", "Unicode startup", "Unicode readiness", "Driver startup", "application readiness"} {
		if got := Failure(Summary(stage)); !strings.Contains(got, stage) || len(got) > 128 {
			t.Fatalf("invalid stage failure %q", got)
		}
	}
	for _, raw := range []string{"", "unix:path=/private/bus", prefix + "IBus readiness\nsecret", strings.Repeat("x", 65536)} {
		if Failure(raw) != "" || Failure(Summary(raw)) != "" {
			t.Fatal("arbitrary diagnostic accepted")
		}
	}
}
