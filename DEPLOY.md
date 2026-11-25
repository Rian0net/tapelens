# Deploy & verification log — 2026-11-25

- **Live URL:** https://rian0net.github.io/tapelens/ (HTTP 200 verified 2026-11-25, assets 200)
- **Repo:** https://github.com/Rian0net/tapelens (public, branch `main`, Pages source `main` `/`)

## Live read path found (from the build sandbox)

`https://xlayer.drpc.org` answers (the other endpoints timed out or errored from the
sandbox: rpc.xlayer.tech timeout, xlayerrpc.okx.com timeout, 1rpc.io/xlayer
"unknown network"). The app keeps all four as a browser-side fallback chain,
dRPC first.

## Live on-chain verification performed with the app's own code (js/rpc.js + js/tap02.js, Node harness)

- chainId 196 via dRPC; factory `cpuCount()` = **449**; `cpuAt(0)` =
  `0x839bdd6fa7a66416a609a735e11de5411b98574e`; `isCPU(ViperX guardian)` = true.
- ViperX Risk Guardian circuits 1–4: `circuitInfo` = (16,1,0, 38/41/37/42 gates);
  decoded netlist gate counts match exactly.
- On-chain `eval` vs local TAP-02 eval: identical on 16 spot inputs per circuit.
- Exhaustive claim checks (all 65,536 inputs, local): circuit 1 = (x ≤ 2000),
  circuit 2 = (x ≤ 200), circuit 3 = (x ≤ 2500), circuit 4 = (x ≥ 10) —
  **all hold, 0 counterexamples**.

## JS evaluator vs Python reference (circuits/tap02.py)

417 vectors compared (all sample vectors in the TapeGate circuit JSONs incl.
their expected outputs, + 400 seeded random inputs): **identical, 0 failures**.

## Local serving test

`python3 -m http.server` over `app/`: index, CSS, all JS, both data JSONs,
TapeGateVault.sol and README all HTTP 200.
