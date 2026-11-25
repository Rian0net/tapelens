/* TAP-02 (tapnet/1) codec + evaluator — independent JavaScript reimplementation
 * of the format documented in TAPEOUT-FLOW.md section 2 (mirrors circuits/tap02.py).
 *
 * Format recap:
 *  - signal 0 = const 0, signal 1 = const 1, signals 2..2+nIn-1 = inputs (LSB first)
 *  - each element appends its output signal(s) in order
 *  - element record: 1 opcode byte + uint24 big-endian operands
 *      NAND 0x00: a, b        (7 bytes total)
 *      LATCH 0x01: d          (4 bytes total)
 *      REF  0x02: not supported here (TapeGate / curated demos use none)
 *  - circuit outputs = last nOut signals
 *  - bit packing: bit i -> byte i>>3, bit i&7 (LSB-first)
 */
(function (global) {
  "use strict";
  var NAND = 0x00, LATCH = 0x01, REF = 0x02;

  function IllFormed(msg) { this.message = msg; this.name = "IllFormed"; }
  IllFormed.prototype = Object.create(Error.prototype);

  function hexToBytes(hex) {
    if (hex.startsWith("0x")) hex = hex.slice(2);
    var out = new Uint8Array(hex.length / 2);
    for (var i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
    return out;
  }
  function bytesToHex(bytes) {
    var s = "";
    for (var i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, "0");
    return "0x" + s;
  }

  function decode(data, nIn) {
    var els = [], p = 0, nxt = 2 + nIn;
    function take(k) {
      if (p + k > data.length) throw new IllFormed("truncated record at byte " + p);
      var b = data.subarray(p, p + k); p += k; return b;
    }
    function u24() { var b = take(3); return (b[0] << 16) | (b[1] << 8) | b[2]; }
    while (p < data.length) {
      var op = take(1)[0], e;
      if (op === NAND) e = { op: op, ins: [u24(), u24()], nOut: 1 };
      else if (op === LATCH) e = { op: op, ins: [u24()], nOut: 1 };
      else if (op === REF) throw new IllFormed("REF elements not supported by this evaluator");
      else throw new IllFormed("unknown opcode 0x" + op.toString(16) + " at byte " + (p - 1));
      e.firstOut = nxt; nxt += e.nOut; els.push(e);
    }
    return els;
  }

  function checkWellFormed(els, nIn, nOut) {
    var nSig = 2 + nIn + els.reduce(function (s, e) { return s + e.nOut; }, 0);
    if (nSig > (1 << 24)) throw new IllFormed("more than 2^24 signals");
    if (!(nIn >= 0 && nIn <= (1 << 16) && nOut >= 1 && nOut <= (1 << 16)))
      throw new IllFormed("nIn/nOut out of range");
    if (nSig - 2 - nIn < nOut) throw new IllFormed("too few signals for outputs");
    els.forEach(function (e) {
      e.ins.forEach(function (s) {
        var limit = e.op === LATCH ? nSig : e.firstOut;
        if (s >= limit)
          throw new IllFormed("signal " + s + " referenced by element at " + e.firstOut + " not available");
      });
    });
    return nSig;
  }

  /* One evaluation beat (TAP-02 section 4). inputs: array of 0/1, length nIn.
   * state: array of 0/1 for LATCH elements (defaults all-zero). */
  function beat(els, nIn, nOut, inputs, state) {
    var nState = els.filter(function (e) { return e.op === LATCH; }).length;
    if (!state) state = new Array(nState).fill(0);
    var a = [0, 1].concat(inputs.slice());
    var newState = state.slice(), base = 0, i, e;
    for (i = 0; i < els.length; i++) {
      e = els[i];
      if (e.op === NAND) a.push(1 - (a[e.ins[0]] & a[e.ins[1]]));
      else if (e.op === LATCH) { a.push(state[base]); base++; }
    }
    base = 0;
    for (i = 0; i < els.length; i++) {
      e = els[i];
      if (e.op === LATCH) { newState[base] = a[e.ins[0]]; base++; }
    }
    return { state: newState, outputs: a.slice(a.length - nOut) };
  }

  function pack(bits) {
    var out = new Uint8Array(Math.ceil(bits.length / 8));
    bits.forEach(function (v, i) { if (v) out[i >> 3] |= 1 << (i & 7); });
    return out;
  }
  function unpack(data, n) {
    var out = [];
    for (var i = 0; i < n; i++) out.push((i >> 3) < data.length ? (data[i >> 3] >> (i & 7)) & 1 : 0);
    return out;
  }

  /* Evaluate exactly as the on-chain evaluator would: packed bytes in, packed bytes out. */
  function evalPacked(els, nIn, nOut, inputBytes) {
    var r = beat(els, nIn, nOut, unpack(inputBytes, nIn));
    return pack(r.outputs);
  }

  /* Pack an integer value little-endian across nIn bits (ViperX TapeOutSignal pattern). */
  function encodeValue(value, nIn) {
    var bits = [];
    var v = BigInt(value);
    for (var i = 0; i < nIn; i++) { bits.push(Number(v & 1n)); v >>= 1n; }
    return pack(bits);
  }

  var TAP02 = {
    NAND: NAND, LATCH: LATCH, IllFormed: IllFormed,
    hexToBytes: hexToBytes, bytesToHex: bytesToHex,
    decode: decode, checkWellFormed: checkWellFormed, beat: beat,
    pack: pack, unpack: unpack, evalPacked: evalPacked, encodeValue: encodeValue
  };
  global.TAP02 = TAP02;
  if (typeof module !== "undefined" && module.exports) module.exports = TAP02;
})(typeof window !== "undefined" ? window : globalThis);
