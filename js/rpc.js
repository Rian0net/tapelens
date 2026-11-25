/* Minimal read-only JSON-RPC client for X Layer (chainId 196).
 * Read-only by design: this app never asks for a wallet and never sends a transaction.
 * Endpoints are tried in order until one answers; the working endpoint is then reused.
 */
(function (global) {
  "use strict";
  var ENDPOINTS = [
    "https://xlayer.drpc.org",
    "https://rpc.xlayer.tech",
    "https://xlayerrpc.okx.com",
    "https://1rpc.io/xlayer"
  ];
  var working = null; // sticky endpoint that answered last
  var cache = {};     // simple in-memory cache keyed by method+params

  function rpc(method, params, useCache) {
    var key = method + ":" + JSON.stringify(params);
    if (useCache && cache[key]) return cache[key];
    var p = (async function () {
      var order = working ? [working].concat(ENDPOINTS.filter(function (e) { return e !== working; })) : ENDPOINTS;
      var lastErr = null;
      for (var i = 0; i < order.length; i++) {
        var ep = order[i];
        try {
          var ctrl = new AbortController();
          var t = setTimeout(function () { ctrl.abort(); }, 15000);
          var res = await fetch(ep, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: method, params: params }),
            signal: ctrl.signal
          });
          clearTimeout(t);
          if (!res.ok) throw new Error("HTTP " + res.status);
          var j = await res.json();
          if (j.error) throw new Error(j.error.message || JSON.stringify(j.error));
          working = ep;
          return j.result;
        } catch (e) { lastErr = e; }
      }
      throw new Error("All X Layer RPC endpoints failed (" + (lastErr && lastErr.message) + ")");
    })();
    if (useCache) cache[key] = p;
    return p;
  }

  function ethCall(to, data) {
    return rpc("eth_call", [{ to: to, data: data }, "latest"], true);
  }

  /* --- tiny ABI helpers (only what TapeOut reads need) --- */
  function u256(n) { return BigInt(n).toString(16).padStart(64, "0"); }
  function addrWord(a) { return a.toLowerCase().replace("0x", "").padStart(64, "0"); }
  function wordAt(hex, i) { return hex.slice(2 + i * 64, 2 + (i + 1) * 64); }
  function uintAt(hex, i) { return Number(BigInt("0x" + wordAt(hex, i))); }
  function addressAt(hex, i) { return "0x" + wordAt(hex, i).slice(24); }
  function decodeBytes(hex) {
    var len = uintAt(hex, 1);
    var dataHex = hex.slice(2 + 128, 2 + 128 + len * 2);
    return TAP02.hexToBytes("0x" + dataHex);
  }
  function decodeString(hex) {
    try {
      var b = decodeBytes(hex);
      return new TextDecoder().decode(b);
    } catch (e) { return ""; }
  }

  var SEL = {
    cpuCount: "0xa94da8a7",
    cpuAt: "0x4bc7cbbd",
    isCPU: "0x5f5a364f",
    circuitInfo: "0x084d60f1",
    netlist: "0x3fc4be56",
    eval: "0x934d06ea",
    totalSupply: "0x18160ddd",
    name: "0x06fdde03"
  };

  var FACTORY = "0x1f09daefa827f02cbb40967cc91b259763760761";

  var XL = {
    ENDPOINTS: ENDPOINTS, FACTORY: FACTORY, SEL: SEL,
    endpoint: function () { return working; },
    chainId: function () { return rpc("eth_chainId", [], false); },
    ethCall: ethCall,
    u256: u256, addrWord: addrWord, uintAt: uintAt, addressAt: addressAt,
    decodeBytes: decodeBytes, decodeString: decodeString,
    cpuCount: function () { return ethCall(FACTORY, SEL.cpuCount).then(function (h) { return uintAt(h, 0); }); },
    cpuAt: function (i) { return ethCall(FACTORY, SEL.cpuAt + u256(i)).then(function (h) { return addressAt(h, 0); }); },
    isCPU: function (a) { return ethCall(FACTORY, SEL.isCPU + addrWord(a)).then(function (h) { return uintAt(h, 0) === 1; }); },
    circuitInfo: function (proc, id) {
      return ethCall(proc, SEL.circuitInfo + u256(id)).then(function (h) {
        return { nIn: uintAt(h, 0), nOut: uintAt(h, 1), nState: uintAt(h, 2), gateCount: uintAt(h, 3) };
      });
    },
    netlist: function (proc, id) {
      return ethCall(proc, SEL.netlist + u256(id)).then(function (h) { return decodeBytes(h); });
    },
    evaluate: function (proc, id, inputBytes) {
      var data = SEL.eval + u256(id) + u256(64) + u256(inputBytes.length) +
        TAP02.bytesToHex(inputBytes).slice(2).padEnd(Math.ceil(inputBytes.length / 32) * 64 || 64, "0");
      return ethCall(proc, data).then(function (h) { return decodeBytes(h); });
    },
    totalSupply: function (proc) { return ethCall(proc, SEL.totalSupply).then(function (h) { return uintAt(h, 0); }); },
    collectionName: function (proc) { return ethCall(proc, SEL.name).then(function (h) { return decodeString(h); }); }
  };
  global.XL = XL;
})(typeof window !== "undefined" ? window : globalThis);
