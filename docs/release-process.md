# Release process

Releases are immutable, reviewable artifacts promoted from one exact candidate
build. Publishing is deliberate; a merge to `main` never creates a release.

## Prepare

1. Update `VERSION`, the `Unreleased` target in `CHANGELOG.md`, and SDK or
   driver versions when their respective contracts changed.
2. Update requirements, design decisions, operations, license notices, and
   migration guidance affected by the release.
3. Run `make check` locally, push the reviewed commit, and dispatch the
   `Release candidate` workflow. It performs the portable gate and uploads one
   archive, `SHA256SUMS`, and `candidate-evidence.json` under an artifact named
   `release-candidate-<full-commit>`.
4. Download that candidate and run `scripts/test-release-candidate.sh` on the
   dedicated Ubuntu/X11 test host. It verifies and runs synthetic ABI plus
   shipped-App E2E from the archive's binaries and App catalog. Then complete
   human UAT on those exact bytes for
   application launch, input, reconnect, logout/exit, shutdown, and upgrade or
   rollback paths in scope.
5. Review source status, candidate evidence, and artifact contents. The source
   tree must contain no generated diff or secret. Do not rebuild after UAT.

## Publish

Create and push an annotated tag matching `VERSION`:

```bash
version=$(<VERSION)
git tag -a "v$version" -m "RemoteXApp $version"
git push origin "v$version"
```

The tag workflow does not rebuild. It rejects a lightweight or mismatched tag,
a tag previously observed at another commit, or a commit without a successful
candidate workflow. It downloads that same commit's artifact, verifies the
checksum, v1 evidence, Go toolchain, all four binaries' embedded VCS identity,
and clean-build bit, then publishes the unchanged archive, checksum, and
candidate evidence. Versions containing a suffix such as `-rc.10` are marked
prerelease. Candidate artifacts are retained for 30 days. Never move or reuse
a tag or version.

An independently released App Package uses an annotated
`<app-id>-v<driverVersion>` tag on its accepted source commit. Publish only the
deterministic `dist/apps/<app-id>-<driverVersion>.tar.gz` and matching
`.sha256` assets, use `--verify-tag`, and state the compatible App Package ABI
and core version in the release notes. Verify the downloaded checksum and
manifest identity after publication. A core release may embed the same exact
App archive without changing the App's tag or version.

## Verify and roll back

Download the archive, checksum, and candidate evidence, then run:

```bash
scripts/verify-release-candidate.sh \
  remotexapp-VERSION-linux-amd64.tar.gz SHA256SUMS \
  candidate-evidence.json FULL_40_CHARACTER_COMMIT
```

Install it as a new immutable release rather than overwriting an existing directory.
Activate it using the documented installer and repeat health, readiness, and
smoke checks. Rollback selects the retained previous application and driver
releases. A breaking major downgrade first restores the exact pre-upgrade
root/Home state snapshot; never ask an older manager to read forward-written
incompatible state. Existing compatible runtime snapshots must not be
rewritten.

Live host preflight is intentionally separate from portable hosted CI. Run the
target-like checks against the downloaded candidate before deployment. See
[`development-quality-process.md`](development-quality-process.md) for the
test tiers and evidence contract.

For a multi-endpoint rollout, follow the repeatable
[formal release alignment process](release-alignment-process.md). It requires
one independently verified formal artifact, stage-before-select activation,
per-endpoint exact identity checks, runtime-adoption checks, and a recorded
drift result.
