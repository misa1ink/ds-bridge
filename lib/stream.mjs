/**
 * DeepSeek SSE stream parser.
 *
 * chat.deepseek.com emits four frame shapes on /api/v0/chat/completion:
 *
 *   1. snapshot  {"v":{"response":{...,"fragments":[{type:"RESPONSE",content:"..."}]}}}
 *   2. patch     {"p":"response/fragments/-1/content","o":"APPEND","v":"..."}
 *   3. bare      {"v":"团"}                       <- one token, no path
 *   4. batch     {"p":"response","o":"BATCH","v":[{...}]}
 *
 * Shape 3 is the common case for streamed answers and is easy to miss:
 * drop it and every reply loses its tail.
 */

export function createStreamState() {
  return {
    text: '',
    thinking: '',
    finish: '',
    error: null,
    responseId: null,
    fragmentType: 'RESPONSE',
  };
}

/**
 * Applies one `data:` payload to the state and returns this frame's deltas.
 *
 * Self-contained on purpose: this function is serialized with toString() and
 * evaluated inside the browser page, so Node and the page share one parser.
 */
export function applyFrame(state, payload) {
  const beforeText = state.text;
  const beforeThink = state.thinking;

  if (!payload || typeof payload !== 'object') {
    return { text: '', thinking: '' };
  }

  const target = () => (String(state.fragmentType).toUpperCase() === 'THINK' ? 'thinking' : 'text');

  const putFragment = frag => {
    const type = String((frag && frag.type) || '').toUpperCase();
    const content = typeof (frag && frag.content) === 'string' ? frag.content : '';
    if (!content) return;
    if (type === 'THINK' || type === 'REASONING') {
      state.fragmentType = 'THINK';
      state.thinking = content;
    } else if (type === 'RESPONSE' || type === 'ANSWER') {
      state.fragmentType = 'RESPONSE';
      state.text = content;
    }
  };

  const write = (value, mode) => {
    if (typeof value !== 'string') return;
    const key = target();
    if (mode === 'SET') state[key] = value;
    else state[key] += value;
  };

  // ---- shape 1: full/partial snapshot -------------------------------------
  if (payload.v && typeof payload.v === 'object' && payload.v.response) {
    const resp = payload.v.response;
    if (resp.message_id) state.responseId = resp.message_id;
    if (Array.isArray(resp.fragments)) {
      for (const frag of resp.fragments) putFragment(frag);
    }
    if (resp.status === 'FINISHED') state.finish = 'stop';
  }

  // ---- shape 3: bare token push ------------------------------------------
  if (typeof payload.v === 'string' && !payload.p) {
    write(payload.v, 'APPEND');
  }

  // ---- shapes 2 and 4: paths and batches ---------------------------------
  if (typeof payload.p === 'string') {
    const { p, o, v } = payload;

    if (/^response\/status$/.test(p) && v === 'FINISHED') state.finish = 'stop';
    if (/^response\/quasi_status$/.test(p) && v === 'FINISHED') state.finish = 'stop';

    if (Array.isArray(v)) {
      for (const item of v) {
        if (!item || typeof item !== 'object') continue;
        const key = String(item.p || '');
        if (key === 'quasi_status' && item.v === 'FINISHED') state.finish = 'stop';
        if (key === 'status' && item.v === 'FINISHED') state.finish = 'stop';
        if (/content$/.test(key)) {
          state.fragmentType = /think/i.test(key) ? 'THINK' : 'RESPONSE';
          write(item.v, item.o);
        }
      }
    } else if (/content$/.test(p)) {
      state.fragmentType = /think/i.test(p) ? 'THINK' : 'RESPONSE';
      write(v, o);
    } else if (/^response\/fragments\/-?\d+$/.test(p) && v && typeof v === 'object') {
      putFragment(v);
    }
  }

  // ---- explicit error -----------------------------------------------------
  if (payload.type === 'error' || (payload.code && payload.code !== 0)) {
    state.error = JSON.stringify(payload).slice(0, 600);
  }

  return {
    text: state.text.slice(beforeText.length),
    thinking: state.thinking.slice(beforeThink.length),
  };
}

/**
 * Feeds a decoded SSE body into the state, in order.
 * Used by tests and the non-streaming path. Also runs inside the page.
 */
export function consumeBody(state, body, onFrame) {
  const blocks = String(body).split(/\r?\n\r?\n/);
  for (const block of blocks) {
    const lines = block.split(/\r?\n/);
    let event = '';
    const dataLines = [];
    for (const line of lines) {
      if (line.indexOf('event:') === 0) event = line.slice(6).trim();
      else if (line.indexOf('data:') === 0) dataLines.push(line.slice(5).trim());
    }
    if (!dataLines.length) continue;
    const raw = dataLines.join('\n');
    if (!raw || raw === '[DONE]') continue;

    let payload;
    try { payload = JSON.parse(raw); } catch (e) { continue; }

    if (event === 'close') { if (!state.finish) state.finish = 'stop'; continue; }
    if (event === 'ready') {
      if (payload.response_message_id) state.responseId = payload.response_message_id;
      continue;
    }
    if (event === 'title' || event === 'update_session') continue;

    const delta = applyFrame(state, payload);
    if (onFrame && (delta.text || delta.thinking)) onFrame(delta);
  }
  if (!state.finish) state.finish = 'stop';
  return state;
}

/** Source form injected into the page so both sides share one parser. */
export const PARSER_SOURCE = `{
  applyFrame: ${applyFrame.toString()},
  consumeBody: ${consumeBody.toString()}
}`;
