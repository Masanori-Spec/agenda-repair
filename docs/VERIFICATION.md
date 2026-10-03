# Verification scope

## Current local verification

- Node syntax and 223 tests passed locally; the test bank includes 2,150 independently enumerated seeded inputs. Full successful Node output is in `node-test-results.txt` and the exact oracle counts are in `benchmark-results.json`. This includes real Node worker-thread message/cancellation tests, not browser execution.
- Benchmarks: synthetic cases, machine metadata and exact counters in `benchmark-results.json`
- Browser suite: 20 scenarios authored and syntax-checked, **not yet run** for this project in the development container. Browser sandbox / loopback constraints prevented supported UI execution in the surrounding environment; no bypass was attempted
- CI configuration: prepared, **not yet executed for a published revision**

The `test:browser` suite is reproducible in supported Node/Chromium environments and is required in GitHub CI. Publication must not be described as browser-verified until the specific revision's run and resulting evidence have been inspected.

## Remaining limitations

No physical-device, Firefox, Safari/WebKit, screen-reader, comprehensive WCAG, real-user usability or demand validation has been completed. Automated viewport checks do not establish physical mobile usability or full accessibility. No production reliability guarantee. Timings describe synthetic workloads on the named machine and are not service-level guarantees.

The independent oracle establishes agreement only over its declared tiny seeded cases; it is not a formal proof of the implementation for every possible input. Solver `optimal` / `infeasible` statuses are claims about the finite input model, with the correctness assurance level above.

## Page-navigation recovery regression

Leaving a page during a running search now invalidates the pending request and clears unfinished proposal/progress state. On restoration the interface explains the interruption and enables an explicit retry. Completed proposals are preserved during idle page transitions. Five DOM-independent lifecycle tests pass in Node. Browser scenarios cover controlled persisted page-transition events, stale worker delivery after hiding, and actual Back/Forward navigation; the report records whether that browser actually used BFCache or reloaded. These browser scenarios remain unrun until CI evidence is available.
