// tiny-stack-vm: an interpreter for make.fun's tiny stack ISA (version 1).
// One run answers all 40 instances of a set: it reads /input/<id>/program.bin
// and /input/<id>/input.bin, executes the program, and writes the exact bytes
// it produced to /output/<id>/stdout.bin and its exit code (a trap's code
// included) to /output/<id>/exit.txt. Machine: 32-bit wrapping integers, a
// data stack of at most 256 values, 64 return addresses, 256 memory words,
// at most 1,000,000 steps and 65,536 output bytes.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

// Data-stack effect of the low opcodes HALT..ROT.
const POP0 = [0, 0, 0, 1, 1, 2, 2, 3];
const PSH0 = [0, 1, 1, 0, 2, 2, 3, 3];

function solve(P: Uint8Array, N: Uint8Array): [Uint8Array, number] {
  const S = new Int32Array(256); // data stack
  const R = new Int32Array(64); // return addresses
  const M = new Int32Array(256); // memory, zeroed
  const buf = new Uint8Array(65536); // output bytes
  const n = P.length;
  let sp = 0, rp = 0, pc = 0, used = 0, ip = 0, steps = 0;
  const end = (c: number): [Uint8Array, number] => [buf.slice(0, used), c];

  for (;;) {
    if (steps === 1000000) return end(10); // step limit
    if (pc < 0 || pc >= n) return end(9); // pc outside the program
    const op = P[pc];
    // Immediate size; a byte no opcode names traps 5 before anything else.
    let imm = 0;
    if (op === 1) imm = 1;
    else if (op === 2) imm = 4;
    else if (op >= 0x30 && op <= 0x33) imm = 2;
    else if (!(op <= 7 || (op >= 0x10 && op <= 0x22) || op === 0x34 || op === 0x40 || op === 0x41 || (op >= 0x50 && op <= 0x53))) return end(5);
    if (pc + imm >= n) return end(9); // immediate cut off by the program's end
    steps++;
    const nx = pc + 1 + imm; // the next instruction's address

    // Stack needs are checked before the instruction's own traps.
    let pops = 0, pushes = 0;
    if (op < 8) { pops = POP0[op]; pushes = PSH0[op]; }
    else if (op >= 0x10 && op <= 0x22) { pops = op === 0x17 || op === 0x1b ? 1 : 2; pushes = 1; } // NEG/NOT unary
    else if (op === 0x31 || op === 0x32 || op === 0x50 || op === 0x51 || op === 0x53) pops = 1;
    else if (op === 0x40) { pops = 1; pushes = 1; }
    else if (op === 0x41) pops = 2;
    else if (op === 0x52) pushes = 1;
    if (sp < pops) return end(2); // stack underflow
    if (sp - pops + pushes > 256) return end(3); // stack overflow
    pc = nx;

    switch (op) {
      case 0x00: return end(0); // HALT
      case 0x01: S[sp++] = (P[nx - 1] << 24) >> 24; break; // PUSH8, sign-extended
      case 0x02: S[sp++] = P[nx - 4] | (P[nx - 3] << 8) | (P[nx - 2] << 16) | (P[nx - 1] << 24); break; // PUSH32
      case 0x03: sp--; break; // POP
      case 0x04: S[sp] = S[sp - 1]; sp++; break; // DUP
      case 0x05: { const t = S[sp - 1]; S[sp - 1] = S[sp - 2]; S[sp - 2] = t; break; } // SWAP
      case 0x06: S[sp] = S[sp - 2]; sp++; break; // OVER
      case 0x07: { const a = S[sp - 3]; S[sp - 3] = S[sp - 2]; S[sp - 2] = S[sp - 1]; S[sp - 1] = a; break; } // ROT
      case 0x17: S[sp - 1] = -S[sp - 1] | 0; break; // NEG, wrapping
      case 0x1b: S[sp - 1] = ~S[sp - 1]; break; // NOT
      case 0x30: case 0x31: case 0x32: { // JMP / JZ / JNZ, offset from nx
        const rel = ((P[nx - 2] | (P[nx - 1] << 8)) << 16) >> 16;
        let go = op === 0x30;
        if (!go) { const v = S[--sp]; go = op === 0x31 ? v === 0 : v !== 0; }
        if (go) pc = nx + rel;
        break;
      }
      case 0x33: // CALL, the immediate is an absolute address
        if (rp === 64) return end(7);
        R[rp++] = nx; pc = P[nx - 2] | (P[nx - 1] << 8); break;
      case 0x34: // RET
        if (rp === 0) return end(8);
        pc = R[--rp]; break;
      case 0x40: { // LOAD
        const a = S[sp - 1];
        if (a < 0 || a > 255) return end(6);
        S[sp - 1] = M[a]; break;
      }
      case 0x41: { // STORE ( v addr -- )
        const a = S[sp - 1];
        if (a < 0 || a > 255) return end(6);
        M[a] = S[sp - 2]; sp -= 2; break;
      }
      case 0x50: { // PRINT, decimal ASCII; a trap writes none of its bytes
        const s = String(S[sp - 1]);
        if (used + s.length > 65536) return end(11);
        sp--;
        for (let i = 0; i < s.length; i++) buf[used++] = s.charCodeAt(i);
        break;
      }
      case 0x51: // PUTC, the low byte of the value
        if (used === 65536) return end(11);
        buf[used++] = S[--sp] & 255; break;
      case 0x52: S[sp++] = ip < N.length ? N[ip++] : -1; break; // IN, -1 past the end
      case 0x53: return end(S[--sp] & 255); // EXIT, the code is the low byte
      default: { // binary operators: 0x10-0x16, 0x18-0x1a, 0x1c-0x1e, 0x20-0x22
        const b = S[sp - 1], a = S[sp - 2];
        let r: number;
        switch (op) {
          case 0x10: r = (a + b) | 0; break; // ADD
          case 0x11: r = (a - b) | 0; break; // SUB
          case 0x12: r = Math.imul(a, b); break; // MUL, low 32 bits of the exact product
          case 0x13: if (b === 0) return end(4); r = (a / b) | 0; break; // DIV, toward zero
          case 0x14: if (b === 0) return end(4); r = (a % b) | 0; break; // MOD, sign of a; x % -1 is 0
          case 0x15: if (b === 0) return end(4); r = Math.floor((a >>> 0) / (b >>> 0)) | 0; break; // DIVU
          case 0x16: if (b === 0) return end(4); r = ((a >>> 0) % (b >>> 0)) | 0; break; // MODU
          case 0x18: r = a & b; break; // AND
          case 0x19: r = a | b; break; // OR
          case 0x1a: r = a ^ b; break; // XOR
          case 0x1c: r = a << (b & 31); break; // SHL
          case 0x1d: r = a >> (b & 31); break; // SHR, arithmetic
          case 0x1e: r = (a >>> (b & 31)) | 0; break; // SHRU, logical
          case 0x20: r = a === b ? 1 : 0; break; // EQ
          case 0x21: r = a < b ? 1 : 0; break; // LT, signed
          default: r = (a >>> 0) < (b >>> 0) ? 1 : 0; break; // LTU, unsigned
        }
        S[sp - 2] = r; sp--;
      }
    }
  }
}

const I = process.env.MAKEFUN_INPUT_DIR ?? "/input";
const O = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";
for (let k = 1; k <= 40; k++) {
  const id = "i" + String(k).padStart(3, "0");
  const [bytes, code] = solve(readFileSync(`${I}/${id}/program.bin`), readFileSync(`${I}/${id}/input.bin`));
  mkdirSync(`${O}/${id}`, { recursive: true });
  writeFileSync(`${O}/${id}/stdout.bin`, bytes);
  writeFileSync(`${O}/${id}/exit.txt`, code + "\n");
}
