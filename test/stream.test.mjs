/**
 * Tests for the DeepSeek SSE parser. Fixtures are trimmed real captures.
 * Run: node test/stream.test.mjs
 */
import { createStreamState, consumeBody, applyFrame, PARSER_SOURCE } from '../lib/stream.mjs';

let pass = 0;
let fail = 0;

function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name}\n        got ${a}\n        want ${e}`); }
}

/* ---- 1. short reply: snapshot + append + finish ------------------------ */
{
  const body = `event: ready
data: {"request_message_id":1,"response_message_id":2,"model_type":"default"}

event: update_session
data: {"updated_at":1792314442.633908}

data: {"v":{"response":{"message_id":2,"thinking_enabled":false,"status":"WIP","fragments":[{"id":2,"type":"RESPONSE","content":"你好"}]}}}

data: {"p":"response/fragments/-1/content","o":"APPEND","v":"呀"}

data: {"p":"response","o":"BATCH","v":[{"p":"accumulated_token_usage","v":38},{"p":"quasi_status","v":"FINISHED"}]}

data: {"p":"response/status","o":"SET","v":"FINISHED"}

event: close
data: {"click_behavior":"none"}
`;
  const st = consumeBody(createStreamState(), body);
  check('short reply text', st.text, '你好呀');
  check('short reply finish', st.finish, 'stop');
  check('short reply responseId', st.responseId, 2);
}

/* ---- 2. bare token frames -- the shape that used to drop the tail ------ */
{
  const body = `data: {"v":{"response":{"message_id":9,"status":"WIP","fragments":[{"type":"RESPONSE","content":"雨"}]}}}

data: {"v":"夜"}

data: {"v":"的"}

data: {"v":"巷"}

data: {"v":"子"}

data: {"p":"response/status","o":"SET","v":"FINISHED"}
`;
  const st = consumeBody(createStreamState(), body);
  check('bare token text', st.text, '雨夜的巷子');
  check('bare token finish', st.finish, 'stop');
}

/* ---- 3. thinking fragments stay separate ------------------------------- */
/* Real captures start the answer with a fresh snapshot carrying a RESPONSE
   fragment, which is what switches the routing target back to text. */
{
  const body = `data: {"v":{"response":{"message_id":1,"status":"WIP","fragments":[{"type":"THINK","content":"用户在问天气"}]}}}

data: {"v":"需要"}

data: {"v":"查"}

data: {"v":{"response":{"message_id":1,"status":"WIP","fragments":[{"type":"THINK","content":"用户在问天气需要查"},{"type":"RESPONSE","content":"今天"}]}}}

data: {"v":"多云"}

data: {"v":"。"}
`;
  const st = consumeBody(createStreamState(), body);
  check('thinking routed to thinking', st.thinking, '用户在问天气需要查');
  check('response routed to text', st.text, '今天多云。');
}

/* ---- 4. deltas are incremental, not cumulative ------------------------- */
{
  const st = createStreamState();
  const deltas = [];
  consumeBody(st, `data: {"v":"一"}\n\ndata: {"v":"二"}\n\ndata: {"v":"三"}\n\n`, d => deltas.push(d.text));
  check('delta stream', deltas, ['一', '二', '三']);
  check('delta total', st.text, '一二三');
}

/* ---- 5. batch form with inline content --------------------------------- */
{
  const st = createStreamState();
  applyFrame(st, { p: 'response', o: 'BATCH', v: [{ p: 'fragments/-1/content', o: 'APPEND', v: '批次' }] });
  check('batch content', st.text, '批次');
}

/* ---- 6. error frame surfaces ------------------------------------------- */
{
  const st = consumeBody(createStreamState(), `data: {"type":"error","code":40003,"msg":"rate limited"}\n\n`);
  const hasError = typeof st.error === 'string' && st.error.includes('40003');
  check('error captured', hasError, true);
}

/* ---- 7. injected source must be valid standalone JS --------------------- */
{
  const { PARSER_SOURCE } = await import('../lib/stream.mjs');
  let ok = true;
  try { new Function(`return ${PARSER_SOURCE}`)(); } catch { ok = false; }
  check('parser source is evaluatable', ok, true);
}
void PARSER_SOURCE;

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
