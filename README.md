# TapeLens — TapeGate Verify

A read-only explorer, live evaluator and exhaustive claim verifier for **TapeOut**
on-chain circuits on **OKX X Layer** (chainId 196), built for the
*X Layer TapeOut Accelerate* hackathon.

**No wallet. No transactions. No fees.** Every number on the page comes from free
`eth_call` reads against the TapeOut factory and processor contracts, plus a local
TAP-02 evaluator (in `js/tap02.js`) that re-evaluates the exact netlist bytes read
from chain — so circuit behaviour claims can be checked, not trusted.

## Features

1. **Explorer** — live `cpuCount()` / `cpuAt(i)` / `isCPU()` against the TapeOut
   factory `0x1f09daefa827f02cbb40967cc91b259763760761`, with pagination and manual
   circuit loading (`circuitInfo`, `netlist`).
2. **Live Evaluator** — evaluates a selected circuit on-chain (`eval`) and locally
   (TAP-02 in the browser) side by side; includes a curated preset of the four real
   ViperX Risk Guardian circuits (leverage ≤ 2000, slippage ≤ 200, drawdown ≤ 2500,
   cooldown ≥ 10) on processor `0xb57b56034e2dc25161e2512CfC40b24EA3bee1Fb`.
3. **Claim Verifier** — for circuits with nIn ≤ 16, enumerates the *entire* input
   space and proves or refutes claims of the form “output = 1 iff input ≤ K / ≥ K”,
   with a first counterexample when a claim fails.
4. **TapeGate Showcase** — TapeGate is a circuit-gated spending vault for AI agents
   and small teams. Its two circuits (a 16-bit spend-limit comparator, 113 NAND
   gates, verified on 398,352 vectors; and a 2-of-3 guardian majority, 6 gates,
   verified on all 8 inputs) run interactively in the browser from the exact
   netlists that are ready to tape out. The enforcing contract is
   [`TapeGateVault.sol`](TapeGateVault.sol).

## Run locally

```bash
python3 -m http.server 8000 --directory .
# open http://localhost:8000
```

RPC access uses a fallback chain of public X Layer endpoints (see `js/rpc.js`),
entirely from the visitor's browser.

## Honest notes

- The TapeOut factory is currently upgradeable (multisig-controlled, per the
  official tapeout.net disclaimer); TapeLens does not claim immutability.
- The TapeGate circuits are designed and exhaustively verified, ready for
  tape-out; TapeLens itself runs on TapeOut data that is on-chain today.
