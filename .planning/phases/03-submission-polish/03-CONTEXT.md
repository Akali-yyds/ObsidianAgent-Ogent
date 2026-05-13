# Phase 3 Context: Submission Polish & Final Verification

## Goal

Turn the implemented grounded-research feature into a reviewer-friendly submission package: hackathon docs, demo script, repo pointers, and a final pre-submission flow that maintainers can rerun from the repo.

## Locked decisions

- **D-01:** Keep the main `README.md` largely unchanged; add only a small banner that points reviewers to `hackathon/`.
- **D-02:** `hackathon/README.md` is the source of truth for the hackathon story, local MLX setup, eval results, and reviewer flow.
- **D-03:** The submission docs should describe the bundled local-MLX defaults exactly as shipped in `src/packs/defaults/grounded-research.json`.
- **D-04:** The demo script should show both the unchanged Classic path and the opt-in Grounded Research path.
- **D-05:** Final verification is a documented hybrid flow: automated repo gate plus manual Obsidian smoke steps.

## Inputs

- `.planning/ROADMAP.md`
- `.planning/REQUIREMENTS.md`
- `README.md`
- `hackathon/spec.md`
- `src/packs/defaults/grounded-research.json`
- `hackathon/eval/results/`
