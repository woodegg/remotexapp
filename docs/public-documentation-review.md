# Public documentation cleanup

Completed source review: 2026-10-04. Baseline: `f893644`, Core `0.14.3`,
SDK `0.29.1`. This record describes documentation and release-gate changes;
it is not a claim that historical Git objects or released artifacts were erased.

## Scope

The initial review covered 123 tracked readable documents: 66 technical guides,
31 test READMEs, eight App READMEs, seven third-party README/license files and
eleven product/contributor/example documents. Third-party notices and license
text remain intact. The existing credential/private-address scanner passed;
additional review found operational records and outdated status wording that
needed cleanup even without an obvious credential.

## Completed changes

- README leads with Citrix-style remote Linux applications, the bundled service
  and JavaScript SDK, practical uses and a short embedding example.
- Handover, release policy, release-train navigation and live-validation guidance
  replace captured deployment diaries. They link to current source identity,
  technical contracts and reproducible acceptance harnesses.
- Historical technical summaries retain requirement IDs, dates, decisions,
  measured results and qualification limits. Captured host/runtime identifiers,
  account/storage layouts, private review paths and downstream workflow names
  have been generalized. Historical status is explicitly distinguished from
  the state of a current installation.
- Host-application package and Coordinator guides preserve provider/consumer
  ownership, protocol distinctions, exact dependency locks, generation fencing
  and cleanup. Old guide paths redirect to the generic guides.
- Current operations and reproduction examples use generic accounts, the shipped
  App versions and loopback listeners. Historical wildcard test configurations
  remain labeled as historical evidence, rather than recommended deployment.
- App README versions agree with manifests; LightView documents its Viewer hooks.
  Contributor guidance no longer asserts obsolete private-repository status.
- `make public-docs-check` rejects known operational disclosures and missing or
  escaping local links, including new untracked readable files. It supplements
  the credential scanner and runs under `make check`.
- Release packaging checks the staged readable documents. Links to included
  files stay local; omitted source references point to the full source commit.
  No private deployment diary is added to the archive to make a link work.

## Verification and limits

Focused tests exercise disclosure rejection, permitted generic examples,
archive-local and source-commit links, and missing/out-of-tree link rejection.
Verification completed on the edited source: `make check` passed using the
pinned Go 1.26.8 toolchain; the source documentation gate passed for 126 readable
files; `make package-release` and the extracted-archive documentation gate passed
for 48 readable files. All existing stable requirement IDs and 237 dated design
entries were retained, with one new cleanup decision. Third-party source and
licenses are unchanged. The local archive is a working-tree validation build,
not a new formal release. Live runtime behavior is unchanged; no deployment or
runtime restart is part of this cleanup.

Public history and previously published immutable assets can retain earlier
content. Do not infer their cleanliness from updated source or overwrite their
tags/assets. Assess existing exposure separately and publish corrected
documentation only through a new reviewed immutable release. Pattern checks
are regression controls, not proof that arbitrary prose contains no sensitive
information.
