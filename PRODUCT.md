# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Two users, about equally (confirmed by the project owner, November 2026):

- A lab member catching up before a meeting: what was decided, what they owe, what changed since last time.
- A lab lead or project manager checking progress across people and approving decisions and commitments.

## Product Purpose

Chronicler keeps a research team's decisions, the reasons behind them, commitments and open questions traceable across meetings. It reads recordings and documents, lets a person check them, and answers questions with links to the original evidence. Success is a person recovering "what did we commit to, what changed, why, and what is next" without rewatching a meeting.

## Positioning

An inspectable chain from original evidence, through a proposed change and a human review, to a later cited answer. Nothing becomes project state without a person approving it, and a reported completion stays "claimed" until someone verifies it.

## Operating Context

- Weekly research meetings, recorded as video, often in Mandarin with English terms; slides and PDFs alongside.
- People prepare for the next meeting by reviewing the previous one or two.
- Self-hosted; speech recognition runs on a local GPU, reasoning on a configured model gateway.

## Capabilities and Constraints

- Works today: upload and transcription, transcript correction, adding sources to a project, cited question answering, two-meeting comparison, approve / edit / reject of proposed changes, review history.
- Not built: a next-meeting brief, per-person accounts and roles, automatic comparison when a meeting is added.
- One shared workspace behind a shared sign-in.
- Entry point for questions: a chat is the primary way to ask (owner's direction, November 2026). Whether chat is the home screen or a panel beside project pages is undecided; both are being mocked.
- Adding files: by dropping them into the chat or with an add-meeting button; no separate inbox screen (owner's direction).
- Terms shown to users should be plain: project, meeting, decision, commitment, review. Internal terms (staging, push, snapshot, segment, revision) stay out of the main interface.

## Brand Commitments

- Name: Chronicler. Existing mark: a ribbon "C" with a blue fold (`apps/web/static/favicon.svg`).
- Existing interface: Geist, warm off-white canvas, near-black ink, one blue accent (`apps/web/src/lib/styles/workspace.css`).

## Evidence on Hand

- Synthetic lab scenario (two fictional meetings, Microscopy Segmentation Model Comparison) in the parent workspace under `deliverables/preliminary-demo/synthetic-inputs/`. Fictional; not a user trial.
- Two written user interviews summarized in the project handoff. No measured time savings or accuracy figures exist; do not state any.

## Product Principles

1. Answers point at evidence; a claim without a source is labelled as inference or unknown.
2. People decide; the system proposes.
3. Unknown stays unknown: no invented owners, dates or criteria.
4. Show less by default; history and provenance are one step away, never the first thing on screen.
5. One place to ask, wherever the person is.
