# Verification and measurement report

Measured: 2026-10-03T05:02:44.302Z. These are actual local Node results on synthetic inputs.

## Reproduce

```sh
npm run check
npm run benchmark
```

`npm run check` runs syntax checks for JavaScript files and the entire Node test suite. `npm run benchmark` runs the benchmark, writes `docs/benchmark-results.json`, and prints the same report to standard output. That [raw benchmark output](benchmark-results.json) always reflects its latest run, including CI; this Markdown document is a dated measurement snapshot. Complete objective vectors and environment details are included in the JSON.

## Test result

- 223 Node test cases passed; zero failed, skipped, or cancelled
- 2,150 distinct seeded oracle inputs were checked: 150 individual tests for seeds 1–150 and one batched test for seeds 150001–152000
- The oracle inputs comprise 852 feasible and 1,298 infeasible cases
- The independent oracle enumerated 87,951 complete Cartesian-product leaves in total; the largest one-input enumeration had 1,296 leaves
- The oracle imports no production model, solver, verifier, overlap helpers, or scoring helpers. It checks every complete candidate independently, scores all objective components, and compares the solver’s exact optimum including the deterministic tie-break
- Returned assignments are additionally checked by the production independent verifier
- Regression coverage includes moving an initially unaffected session, objective priority order, ASCII tie-breaking, room and shared-equipment conflicts, touching half-open intervals, non-grid blackout endpoints and durations, pinned obstructions, zero-change baselines, collection reordering, deterministic search prefixes, increasing budgets, early cutoff, cancellation with an incumbent, malformed imports, prototype keys, and inert malicious-looking text
- The suite also includes independent verifier-negative cases, Node worker-thread tests for results, malformed input, cancellation and superseded requests, and five DOM-independent page lifecycle recovery tests
- A C1-control-character acceptance defect was discovered during adversarial input testing, fixed in the model, and retained as a regression test

The test-case count and the oracle-input count measure different things. Most regression tests exercise multiple assertions or input mutations. Node worker-thread tests do not establish browser-worker compatibility or UI behavior.

Node tests were rerun on 2026-10-03 after the page-navigation recovery fix; benchmark algorithm and the dated measurement data below are unchanged.

## Benchmark environment and method

- Node v24.19.0; linux x64; kernel 6.18.44
- Reported CPU: AMD EPYC 9V74 80-Core Processor
- One run per workload and budget, with cooperative yielding every 512 search nodes
- Elapsed times include timer yields and are descriptive single-run observations, not latency percentiles or performance guarantees
- Search stopping uses deterministic node budgets, never a wall-clock deadline
- All benchmark inputs are synthetic, contain no personal data, and remain within the documented model limits

## Recorded runs

Objective columns are changed sessions / total shift minutes / room changes. Complete tie-break vectors remain in the raw JSON.

| Workload | Sessions | Node budget | Result | Nodes | Objective | Elapsed ms |
| --- | ---: | ---: | --- | ---: | --- | ---: |
| room-closure | 6 | 200,000 | optimal (complete) | 30 | 2 / 30 / 2 | 1.551 |
| equipment-blackout | 6 | 200,000 | optimal (complete) | 15 | 2 / 120 / 0 | 0.555 |
| pinned-obstruction | 4 | 200,000 | infeasible (complete) | 0 | — | 0.129 |
| seeded-light-20261003 | 4 | 256 | optimal (complete) | 204 | 2 / 30 / 1 | 4.859 |
| seeded-light-20261003 | 4 | 4,096 | optimal (complete) | 204 | 2 / 30 / 1 | 2.548 |
| seeded-light-20261003 | 4 | 50,000 | optimal (complete) | 204 | 2 / 30 / 1 | 2.012 |
| seeded-medium-72817 | 6 | 256 | feasible (budget) | 256 | 3 / 90 / 1 | 2.213 |
| seeded-medium-72817 | 6 | 4,096 | optimal (complete) | 1,042 | 2 / 135 / 1 | 11.043 |
| seeded-medium-72817 | 6 | 50,000 | optimal (complete) | 1,042 | 2 / 135 / 1 | 11.487 |
| seeded-tight-92389 | 8 | 256 | unknown (budget) | 256 | — | 0.748 |
| seeded-tight-92389 | 8 | 4,096 | unknown (budget) | 4,096 | — | 18.526 |
| seeded-tight-92389 | 8 | 50,000 | unknown (budget) | 50,000 | — | 214.941 |
| seeded-max120-120120 | 8 | 200,000 | feasible (budget) | 200,000 | 7 / 540 / 0 | 1930.631 |
| seeded-full20-120120 | 20 | 200,000 | feasible (budget) | 200,000 | 7 / 540 / 0 | 4658.104 |

## What the results establish

- The two repairable demos reach a proved optimum; the pinned-obstruction demo is proved infeasible from an empty legal domain
- The medium seed finds a valid incumbent within 256 nodes and a better optimum at 1,042 nodes. Its optimum changes fewer sessions even though it shifts more total minutes, as required by the objective priority
- The tight single-room case has a separately constructed and independently verified feasible assignment, but the solver finds no incumbent by 50,000 nodes. Returning `unknown` is intentional; it must never be presented as an infeasibility proof
- The maximum-domain workload has eight movable sessions, six rooms, 120 nominal choices for every movable session, and one exclusive shared equipment item. At the default 200,000-node budget it returns a verified feasible incumbent, not a proof of optimality
- The full-capacity workload keeps the same eight movable 120-choice sessions and adds twelve valid, nonconflicting pinned sessions later in the day. At 20 total sessions it returns a verified feasible incumbent at the 200,000-node limit, with no optimality proof. Both maximum-domain workloads have separately constructed and independently verified feasible witnesses
- Nominal model limits bound input size; they do not guarantee completion, an incumbent, or acceptable elapsed time on every device

## Scope and limits

This report contains Node correctness tests and local algorithm measurements only. Browser interaction, rendering, accessibility, deployment, and real-world scheduling outcomes require separate evidence. The tiny exhaustive oracle bank gives strong differential regression coverage, not a mathematical proof that the implementation is correct for every supported input. Benchmark feasibility is checked independently; optimality for the larger benchmark cases relies on exhaustive completion by the production search, not on the tiny oracle.
