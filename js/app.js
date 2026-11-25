/* TapeLens — TapeGate Verify: explorer + live evaluator + claim verifier + TapeGate showcase.
 * Everything is read-only: eth_call reads and local TAP-02 evaluation. No wallet, ever.
 */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var VIPERX = "0xb57b56034e2dc25161e2512CfC40b24EA3bee1Fb";
  var PAGE = 20;

  var S = {
    cpuCount: null, page: 0,
    processor: null,            // selected processor address
    circuit: null               // { id, info, netlistBytes, els }
  };

  function short(a) { return a.slice(0, 8) + "…" + a.slice(-6); }
  function setStatus(txt, cls) { var el = $("net-status"); el.textContent = txt; el.className = "status " + (cls || ""); }
  function bitLamp(bit) { return bit ? "PASS (1)" : "REJECT (0)"; }

  /* ================= Explorer ================= */
  async function initExplorer() {
    try {
      var cid = await XL.chainId();
      S.cpuCount = await XL.cpuCount();
      setStatus("Connected to X Layer (chainId " + Number(cid) + ") via " + XL.endpoint(), "ok");
      $("cpu-count").textContent = "cpuCount: " + S.cpuCount + " processors registered";
      await renderPage();
    } catch (e) {
      setStatus("Could not reach any X Layer RPC endpoint from this browser: " + e.message, "err");
    }
  }

  async function renderPage() {
    var list = $("proc-list");
    list.innerHTML = "Loading processors…";
    var start = S.page * PAGE, end = Math.min(start + PAGE, S.cpuCount);
    $("pg-label").textContent = "processors " + start + "–" + (end - 1) + " of " + S.cpuCount;
    $("pg-prev").disabled = S.page === 0;
    $("pg-next").disabled = end >= S.cpuCount;
    try {
      var addrs = await Promise.all(
        Array.from({ length: end - start }, function (_, i) { return XL.cpuAt(start + i); }));
      list.innerHTML = "";
      addrs.forEach(function (a, i) {
        var b = document.createElement("button");
        b.className = "proc" + (S.processor === a ? " sel" : "");
        b.textContent = "#" + (start + i) + "  " + a;
        b.onclick = function () { selectProcessor(a); };
        list.appendChild(b);
      });
    } catch (e) { list.textContent = "Failed to load: " + e.message; }
  }

  async function selectProcessor(addr) {
    S.processor = addr;
    document.querySelectorAll(".proc").forEach(function (el) {
      el.classList.toggle("sel", el.textContent.indexOf(addr) >= 0);
    });
    $("proc-detail").classList.remove("hidden");
    $("pd-addr").textContent = addr;
    $("pd-iscpu").textContent = "isCPU: checking…";
    $("pd-name").textContent = ""; $("pd-supply").textContent = "";
    try { $("pd-iscpu").textContent = "isCPU: " + (await XL.isCPU(addr)); } catch (e) { $("pd-iscpu").textContent = "isCPU: error"; }
    XL.collectionName(addr).then(function (n) { if (n) $("pd-name").textContent = "name: " + n; }).catch(function () {});
    XL.totalSupply(addr).then(function (n) { $("pd-supply").textContent = "circuits (totalSupply): " + n; }).catch(function () {});
  }

  /* ================= Evaluator ================= */
  async function loadCircuit(proc, id) {
    $("load-msg").textContent = "loading circuit…";
    try {
      var info = await XL.circuitInfo(proc, id);
      var netlistBytes = await XL.netlist(proc, id);
      var els = TAP02.decode(netlistBytes, info.nIn);
      TAP02.checkWellFormed(els, info.nIn, info.nOut);
      S.circuit = { proc: proc, id: id, info: info, netlistBytes: netlistBytes, els: els };
      $("circuit-panel").classList.remove("hidden");
      $("cp-title").textContent = short(proc) + " · circuit #" + id;
      $("cp-info").textContent =
        "nIn=" + info.nIn + " · nOut=" + info.nOut + " · nState=" + info.nState +
        " · gates (circuitInfo)=" + info.gateCount + " · gates (decoded netlist)=" + els.length +
        (els.length === info.gateCount ? " ✓ match" : " ⚠ mismatch") +
        " · netlist " + netlistBytes.length + " bytes · keccak-free local copy ready";
      $("load-msg").textContent = "";
      $("res-onchain").textContent = "—"; $("res-local").textContent = "—"; $("res-match").textContent = "";
      $("verify-out").textContent = info.nIn <= 16
        ? "Circuit loaded with nIn=" + info.nIn + " — exhaustive verification available below."
        : "nIn=" + info.nIn + " > 16 — exhaustive verification not available for this circuit.";
      $("truth-wrap").textContent = "";
      return true;
    } catch (e) {
      $("load-msg").textContent = "Failed: " + e.message;
      return false;
    }
  }

  function parseEvalInput(nIn) {
    var mode = $("input-mode").value, raw = $("eval-input").value.trim();
    if (mode === "bits") {
      var bits = raw.replace(/[^01]/g, "").split("").map(Number);
      while (bits.length < nIn) bits.push(0);
      return TAP02.pack(bits.slice(0, nIn));
    }
    var v = BigInt(raw === "" ? "0" : raw);
    return TAP02.encodeValue(v, nIn);
  }

  function showResult(el, bytes) {
    if (!bytes) { el.textContent = "—"; return; }
    var bit0 = bytes.length ? bytes[0] & 1 : 0;
    el.innerHTML = "";
    el.appendChild(document.createTextNode(TAP02.bytesToHex(bytes) + "  →  bit0 = "));
    var s = document.createElement("strong");
    s.textContent = bitLamp(bit0);
    s.style.color = bit0 ? "var(--ok)" : "var(--bad)";
    el.appendChild(s);
  }

  async function evaluateBoth() {
    if (!S.circuit) return;
    var c = S.circuit, input = parseEvalInput(c.info.nIn);
    $("res-local").textContent = "…"; $("res-onchain").textContent = "…"; $("res-match").textContent = "";
    var local = TAP02.evalPacked(c.els, c.info.nIn, c.info.nOut, input);
    showResult($("res-local"), local);
    try {
      var onchain = await XL.evaluate(c.proc, c.id, input);
      showResult($("res-onchain"), onchain);
      var same = TAP02.bytesToHex(local) === TAP02.bytesToHex(onchain);
      var m = $("res-match");
      m.textContent = same ? "✓ MATCH — local TAP-02 evaluation is identical to the on-chain eval."
                           : "✗ MISMATCH — local and on-chain results differ!";
      m.className = "match " + (same ? "ok" : "bad");
    } catch (e) {
      $("res-onchain").textContent = "on-chain eval failed: " + e.message;
    }
  }

  /* ================= Verifier ================= */
  function runVerify() {
    var out = $("verify-out");
    if (!S.circuit) { out.textContent = "Load a circuit first."; return; }
    var c = S.circuit, nIn = c.info.nIn;
    if (nIn > 16) { out.textContent = "nIn=" + nIn + " > 16 — too large for exhaustive verification."; return; }
    var pattern = $("claim-pattern").value, K = parseInt($("claim-k").value, 10);
    var total = 1 << nIn, ones = 0, bad = 0, firstBad = null, rows = [];
    for (var v = 0; v < total; v++) {
      var res = TAP02.evalPacked(c.els, nIn, c.info.nOut, TAP02.encodeValue(v, nIn));
      var bit = res[0] & 1;
      if (bit) ones++;
      var expected = pattern === "le" ? (v <= K ? 1 : 0) : (v >= K ? 1 : 0);
      if (bit !== expected) { bad++; if (!firstBad) firstBad = { v: v, got: bit, expected: expected }; }
      if (v < 512) rows.push(String(v).padStart(5) + "  " +
        v.toString(2).padStart(nIn, "0").split("").reverse().join("") + "  →  " + bit);
    }
    $("truth-wrap").textContent = rows.join("\n") + (total > 512 ? "\n… (" + total + " rows total)" : "");
    out.innerHTML = "";
    var claim = "output=1 iff input " + (pattern === "le" ? "≤ " : "≥ ") + K;
    if (bad === 0) {
      out.appendChild(document.createTextNode("✓ CLAIM HOLDS over all " + total + " inputs: " + claim +
        "  (" + ones + " inputs output 1)"));
      out.style.color = "var(--ok)";
    } else {
      out.appendChild(document.createTextNode("✗ CLAIM FAILS: " + bad + " of " + total + " inputs disagree. " +
        "First counterexample: input=" + firstBad.v + " → circuit outputs " + firstBad.got +
        ", claim expects " + firstBad.expected + "."));
      out.style.color = "var(--bad)";
    }
  }

  /* ================= TapeGate showcase ================= */
  var TG = { a: null, b: null }; // decoded TapeGate circuits
  async function initTapeGate() {
    try {
      var ja = await (await fetch("data/amount_le_limit16.json")).json();
      var jb = await (await fetch("data/majority_2of3.json")).json();
      TG.a = { meta: ja, els: TAP02.decode(TAP02.hexToBytes(ja.netlist), ja.nIn) };
      TG.b = { meta: jb, els: TAP02.decode(TAP02.hexToBytes(jb.netlist), jb.nIn) };
      $("tg-a-stats").textContent = ja.nIn + " inputs · " + ja.gates + " NAND gates · netlist " +
        (ja.netlist.length - 2) / 2 + " bytes · " + ja.vectorsCheckedOffChain.toLocaleString() + " vectors verified off-chain";
      $("tg-b-stats").textContent = jb.nIn + " inputs · " + jb.gates + " NAND gates · netlist " +
        (jb.netlist.length - 2) / 2 + " bytes · all " + jb.vectorsCheckedOffChain + " inputs verified off-chain";
      updateTapeGate();
    } catch (e) {
      $("tg-a-stats").textContent = "failed to load showcase data: " + e.message;
    }
  }

  function setLamp(el, bit, passTxt, rejTxt) {
    el.textContent = bit ? passTxt : rejTxt;
    el.className = "lamp " + (bit ? "pass" : "reject");
  }

  function updateTapeGate() {
    if (!TG.a || !TG.b) return;
    var amount = Number($("tg-amount").value), limit = Number($("tg-limit").value);
    $("tg-amount-v").textContent = amount; $("tg-limit-v").textContent = limit;
    var inp = new Uint8Array(4);
    inp[0] = amount & 0xff; inp[1] = (amount >> 8) & 0xff;
    inp[2] = limit & 0xff; inp[3] = (limit >> 8) & 0xff;
    var aBit = TAP02.evalPacked(TG.a.els, 32, 1, inp)[0] & 1;
    setLamp($("tg-a-lamp"), aBit, "WITHIN LIMIT (1)", "OVER LIMIT (0)");

    var mask = 0;
    document.querySelectorAll(".tg-appr").forEach(function (cb, i) { if (cb.checked) mask |= (1 << i); });
    var bBit = TAP02.evalPacked(TG.b.els, 3, 1, new Uint8Array([mask]))[0] & 1;
    setLamp($("tg-b-lamp"), bBit, "QUORUM REACHED (1)", "NO QUORUM (0)");

    var v = $("tg-vault");
    if (aBit && bBit) { v.textContent = "✅ SPEND RELEASED — both circuits approved"; v.className = "vault-verdict pass"; }
    else {
      var why = !aBit && !bBit ? "amount over limit and no guardian quorum"
        : !aBit ? "amount over limit" : "guardian quorum not reached";
      v.textContent = "⛔ SPEND BLOCKED — " + why;
      v.className = "vault-verdict reject";
    }
  }

  /* ================= wiring ================= */
  document.addEventListener("DOMContentLoaded", function () {
    initExplorer(); initTapeGate();
    $("pg-prev").onclick = function () { if (S.page > 0) { S.page--; renderPage(); } };
    $("pg-next").onclick = function () { S.page++; renderPage(); };
    $("manual-proc-btn").onclick = function () {
      var a = $("manual-proc").value.trim();
      if (/^0x[0-9a-fA-F]{40}$/.test(a)) selectProcessor(a);
      else alert("That does not look like an address.");
    };
    $("load-circuit").onclick = function () {
      if (!S.processor) { alert("Select a processor first."); return; }
      loadCircuit(S.processor, parseInt($("circuit-id").value, 10) || 1);
    };
    document.querySelectorAll(".preset").forEach(function (b) {
      b.onclick = async function () {
        await selectProcessor(VIPERX);
        $("circuit-id").value = b.dataset.circuit;
        var ok = await loadCircuit(VIPERX, Number(b.dataset.circuit));
        if (ok) {
          $("claim-pattern").value = b.dataset.claim;
          $("claim-k").value = b.dataset.k;
          $("eval-input").value = b.dataset.claim === "le" ? String(Math.floor(Number(b.dataset.k) / 2)) : "15";
          evaluateBoth();
        }
      };
    });
    $("eval-both").onclick = evaluateBoth;
    $("run-verify").onclick = runVerify;
    ["tg-amount", "tg-limit"].forEach(function (id) { $(id).addEventListener("input", updateTapeGate); });
    document.querySelectorAll(".tg-appr").forEach(function (cb) { cb.addEventListener("change", updateTapeGate); });
  });
})();
