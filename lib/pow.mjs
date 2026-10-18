import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WASM_PATH = process.env.DS_WASM || path.join(__dirname, '..', 'wasm', 'sha3_wasm_bg.wasm');

let cached = null;

/**
 * Loads the sha3 wasm once and keeps a reusable instance.
 * The module has no imports, so instantiation is sync-safe after the first load.
 */
async function getInstance() {
  if (cached) return cached;
  const bytes = fs.readFileSync(WASM_PATH);
  const { instance } = await WebAssembly.instantiate(bytes, {});
  cached = instance.exports;
  return cached;
}

function writeStr(ex, text) {
  const enc = new TextEncoder().encode(text);
  const ptr = ex.__wbindgen_export_0(enc.length, 1);
  new Uint8Array(ex.memory.buffer, ptr, enc.length).set(enc);
  return [ptr, enc.length];
}

/**
 * Runs wasm_solve. Returns the answer nonce, or null when the solver gives up.
 * Memory can grow inside wasm_solve, so every view is created after the call.
 */
function solveOnce(ex, { challenge, salt, expire_at, difficulty }) {
  const prefix = `${salt}_${expire_at}_`;
  const retptr = ex.__wbindgen_add_to_stack_pointer(-16);
  try {
    const [cp, cl] = writeStr(ex, challenge);
    const [pp, pl] = writeStr(ex, prefix);
    ex.wasm_solve(retptr, cp, cl, pp, pl, difficulty);
    const view = new DataView(ex.memory.buffer);
    const status = view.getInt32(retptr, true);
    if (status === 0) return null;
    return Math.trunc(view.getFloat64(retptr + 8, true));
  } finally {
    ex.__wbindgen_add_to_stack_pointer(16);
  }
}

/**
 * Turns a create_pow_challenge payload into the x-ds-pow-response header value.
 * @param {{algorithm:string, challenge:string, salt:string, difficulty:number,
 *          expire_at:number, signature:string, target_path:string}} cfg
 */
export async function solveChallenge(cfg) {
  const ex = await getInstance();
  const answer = solveOnce(ex, cfg);
  if (answer === null) throw new Error('pow: no solution found');
  const payload = {
    algorithm: cfg.algorithm,
    challenge: cfg.challenge,
    salt: cfg.salt,
    answer,
    signature: cfg.signature,
    target_path: cfg.target_path,
  };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
}

export const POW_WASM_PATH = WASM_PATH;
