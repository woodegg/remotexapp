# Issue, pull request and release workflow

Issues own problem statements, acceptance criteria and implementation progress.
Pull requests own proposed changes, review and CI evidence. Milestones group
work for a release. Repository requirements and design records retain durable
technical contracts. Avoid copying a complete progress diary into all four.

## From request to reviewed implementation

1. Create a public-safe Issue describing the problem, expected behavior and
   observable acceptance. Keep private incident evidence in its owning project.
   A small documentation correction can start directly with a PR.
2. Assign a release Milestone when scope is selected. A Milestone expresses a
   target, not proof of release. Record stable requirement IDs and substantial
   lifecycle, compatibility or trust-boundary decisions in repository docs.
   Large changes can start with a design PR; routine fixes need no separate RFC.
3. Create a short-lived branch from current `main`, such as
   `feat/2-managed-desktop-recovery`, and open a linked Draft PR. Draft status
   permits early CI and visible work without claiming readiness for merge.
4. Implement focused changes and tests. Run the affected checks, then
   `make check`; retain coverage and vulnerability gates. Update change records
   with the implementation. Move the PR to ready when its scope is reviewable.
5. Review the final diff, compatibility and operations impact, and CI. Merge
   through the PR after required checks pass. Main requires a PR, the GitHub
   Actions `check` result on an up-to-date branch, and resolved conversations.
   No second-person approval is mandatory for this small team; owner/agent
   review and test evidence must still be explicit. Do not self-approve a PR
   or claim independent human review.

Use `Refs #N` for design or partial implementation PRs. Use `Closes #N` only
when all implementation acceptance criteria are met. Split implementation and
release qualification into separate Issues when their completion boundaries
differ. An implementation Issue may close at merge while its release-tracking
Issue stays open through UAT and publication.

Issue/PR state is authoritative for work progress. Release plans link those
records and describe scope and acceptance; they need no repeated running diary.
Do not rewrite historical evidence or accepted design entries to update status.

## From merged source to immutable release

The merge commit differs from a PR's head or temporary test merge. Build the
candidate from the exact post-merge commit intended for publication. PR CI is
an input to review, not a substitute for that candidate's release gate.

Follow the existing [release process](release-process.md): hosted
`make release-ci`, exact-archive target-like E2E, local human UAT, then annotated
tag and unchanged-byte publication. Bind evidence to full commit and SHA-256.
If source changes after qualification, qualify the new candidate; do not claim
that the old artifact validates the new commit. Documentation-only follow-ups
may reference the qualified commit without changing that artifact's identity.

Keep one release qualification Issue in the Milestone with candidate identity,
E2E, human acceptance, publication and handoff checkboxes. Close the Milestone
after required work and publication complete. Publication and downstream
deployment are separate states; deployment belongs to the target's project.
Historical/current qualification trackers are [0.15.0 #3](https://github.com/woodegg/remotexapp/issues/3)
and [0.14.5 #4](https://github.com/woodegg/remotexapp/issues/4).

For the selected managed-recovery work, [implementation Issue #2](https://github.com/woodegg/remotexapp/issues/2)
belongs to [Milestone 0.15.0](https://github.com/woodegg/remotexapp/milestone/1).
The existing [0.14.5 toolchain train](go-toolchain-0.14.5-release.md) remains
separate and retains its pending human UAT/publication state.

## Parallel release trains

When an older release still awaits qualification and main is about to take a
new version's behavior, retain a protected release branch at the reviewed
pre-change main commit. The current toolchain train uses release/0.14.5; the managed recovery train completed as 0.15.0. Future transport evaluation
is tracked separately under the proposed 0.16.0 milestone. Keep required PR/check rules
on the release branch, accept only its scoped fixes there, and qualify the
exact selected commit through the same candidate workflow. Branch creation
alone does not create a candidate, approve UAT or publish a release. Merge new
feature work through its PR to main; avoid copying that work into the older
release train. Issues and Milestones retain each train's acceptance state.

## Repository configuration

Main protection requires pull requests and the GitHub Actions `check` context
with strict up-to-date status checks, resolves review conversations, and blocks
force pushes and deletion. It applies to administrators and requires zero
external approvals. Keep manual candidate and release workflows separate from
merge checks. If a required check fails, fix or retry the cause through the PR;
do not weaken the gate to merge. Emergency protection changes require an
explicitly recorded owner decision.

Templates and this workflow are introduced through
[workflow Issue #1](https://github.com/woodegg/remotexapp/issues/1). GitHub
settings are configured separately from the files; a PR alone does not prove
that branch protection is active.

## Next selected investigation

[Issue #24](https://github.com/woodegg/remotexapp/issues/24) owns the
[proposed 0.16.0 KasmVNC evaluation](kasmvnc-0.16.0-evaluation.md).
Use the evaluation/go-no-go gate before creating implementation slices or
changing the default transport. Core 0.15.0 is published; its completed
candidate/UAT history above is not a pending release gate.
