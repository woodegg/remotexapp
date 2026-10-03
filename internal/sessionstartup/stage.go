// Package sessionstartup defines content-free diagnostic stages, not readiness
// authority. Public error fields remain strings; no endpoint contract changes.
package sessionstartup

const prefix = "Core session startup: "

func Summary(stage string) string {
	switch stage {
	case "D-Bus startup", "D-Bus readiness", "IBus startup", "IBus readiness", "Unicode startup", "Unicode readiness", "Driver startup", "application readiness":
		return prefix + stage
	default:
		return prefix + "unknown stage"
	}
}

// Failure accepts only our exact content-free summaries. Never expose a raw
// process exception, protocol response, bus address or arbitrary App summary.
func Failure(summary string) string {
	for _, stage := range []string{"D-Bus startup", "D-Bus readiness", "IBus startup", "IBus readiness", "Unicode startup", "Unicode readiness", "Driver startup", "application readiness"} {
		if summary == Summary(stage) {
			return "Core session startup failed at " + stage + "; inspect the session unit journal"
		}
	}
	return ""
}
