# Contributing

Read [AGENTS.md](AGENTS.md) for repository layout, commands, coding style, and
change-record rules. Keep changes focused and add tests beside the behavior
they protect.

Use [Issues](https://github.com/woodegg/remotexapp/issues) for problems,
acceptance criteria and implementation progress. Use short-lived branches and
pull requests for changes; do not push development commits directly to `main`.
The [development workflow](docs/development-workflow.md) defines ownership,
release milestones and the distinction between merge, UAT and publication.
Small documentation fixes may go directly to a PR without a separate Issue.

Before marking a pull request ready for review, run:

```bash
make check
```

Pull-request CI additionally enforces `make coverage-check` and
`make vuln-check`. For release or concurrency-sensitive changes, also run
`make test-race`. Follow the measured test tiers and build-once candidate flow
in [development-quality-process.md](docs/development-quality-process.md).
Describe behavior, compatibility, security and deployment impact in the pull
request. Link the relevant requirement or design decision and include visible
UI evidence when applicable. Never commit credentials, runtime state, user
profiles, or generated artifacts outside their established tracked paths.

By contributing, you agree that your contribution is licensed under the
Apache License 2.0 in [LICENSE](LICENSE).
