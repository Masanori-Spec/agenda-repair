# Verification scope

## Successful evidence run

[GitHub Actions run 37100372657](https://github.com/Masanori-Spec/agenda-repair/actions/runs/37100372657) passed for application commit `79185cb4f69484704070f013dfe0d166a4eac5eb` on 2026-10-03. This document records that exact run, not a promise about future revisions.

- 223 Node tests passed, including 2,150 independently enumerated seeded inputs and separate constraint verification
- Actual Node worker-thread message/cancellation tests passed
- 21 Chromium browser scenarios passed using Chromium 151.0.7922.34
- Viewports: 1440×1100, 390×844 and 320×740
- No runtime page errors or CSP violations were recorded; no non-local requests were observed during the instrumented primary real UI flows
- Exact browser checks, capture state and timestamps: [browser-results.json](browser-results.json)
- Run/application revision and evidence hashes: [ci-evidence.json](ci-evidence.json)
- Local Node run output: [node-test-results.txt](node-test-results.txt)
- Local and CI benchmark environments are separately preserved in [MEASUREMENTS.md](MEASUREMENTS.md)

The browser suite was executed in the supported GitHub CI environment. It was not executed inside the original development container, where browser sandbox/loopback restrictions applied; no workaround was used there.

## UI and page-navigation coverage

The browser suite exercises all three synthetic demos, exact demo change counts, independently verified audit exports, pin editing, zero-change restoration, invalid blackout handling, strict nonmutating import, keyboard dialog dismissal, inert HTML-shaped labels, baseline downloads, cancelled asynchronous file reads, real browser-worker cancellation, stale results, page lifecycle recovery, keyboard skip navigation and narrow-screen containment.

Runtime-error, CSP and request listeners instrument the primary test page only; auxiliary/mock pages are not fully instrumented. The absence-of-error/network observations above are limited to the primary real UI flows.

Worker stale-result and pending-navigation cases use controlled Worker mocks. The real Back/Forward scenario passed but restored through a fresh page load: `bfcacheObserved` was false. Therefore actual BFCache restoration is **not verified** by this run. Explicit persisted page-transition events and five DOM-independent Node lifecycle tests cover the intended recovery path without claiming it occurred naturally.

The recovery behavior clears an unfinished proposal/progress and invalidates the running worker when leaving a page. On restoration it explains the interruption and permits an explicit retry. Completed proposals are preserved during idle page transitions.

## Screenshot review

- [Desktop screenshot](screenshots/desktop.png): 1440px viewport width
- [Mobile screenshot](screenshots/mobile.png): 390px viewport width

Both are unedited full-page captures of synthetic inputs from the linked CI run and were visually inspected. No unintended page-level horizontal overflow was detected in the tested states; the timelines intentionally scroll within their own containers. Captures were made at scroll position 0 after layout settled. The skip link is fully hidden when unfocused and is revealed by keyboard focus; its geometry/opacity checks and capture diagnostics are in the report.

## Remaining limitations

No physical-device, Firefox, Safari/WebKit, screen-reader, comprehensive WCAG, real-user usability or demand validation has been completed. Automated viewport and keyboard checks do not establish physical mobile usability or full accessibility. No production reliability guarantee. Timings describe individual synthetic workloads on the named machines and are not service-level guarantees.

The independent oracle establishes agreement over its declared tiny seeded cases; it is not a formal proof of the implementation for every possible input. Solver `optimal` / `infeasible` statuses are claims about the finite input model, with the correctness assurance level above. Larger benchmark witnesses are independently checked, but their claimed optimality, when any, relies on the production search completing rather than on the tiny exhaustive oracle.
