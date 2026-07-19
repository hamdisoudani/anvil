package perplexity

// indexHTML is the embedded demo page. Pure vanilla JS.
//
// UI shape (the way the user asked for):
//   - Single column
//   - Chat history at top (scrollable)
//   - Each user message = a question
//   - Each assistant message = the plan + the streaming answer + sources + related
//   - Prompt input at the bottom (sticky, always visible)
//   - Related questions clickable, become new user messages
//
// The wire protocol is what we're testing; the UI just demonstrates it.
// In production, the React SDK replaces this with a real component.
const indexHTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Anvil Perplexity</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    :root {
      --bg: #0e0e10; --panel: #18181b; --border: #27272a; --fg: #e4e4e7; --muted: #71717a;
      --accent: #60a5fa; --accent-2: #3b82f6; --citation: #fbbf24; --user: #1e40af;
      --assistant: #1f2937; --success: #22c55e;
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; height: 100%; }
    body {
      font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
      background: var(--bg); color: var(--fg);
      display: flex; flex-direction: column;
    }
    .header {
      padding: 16px 24px; border-bottom: 1px solid var(--border);
      display: flex; align-items: center; gap: 12px;
      background: var(--panel);
    }
    .header h1 { margin: 0; font-size: 18px; }
    .header .tag { font-size: 11px; color: var(--muted); margin-left: 8px; }

    .messages {
      flex: 1; overflow-y: auto; padding: 24px;
      max-width: 880px; margin: 0 auto; width: 100%;
    }

    .msg { margin-bottom: 28px; }
    .msg-role {
      font-size: 12px; font-weight: 600; color: var(--muted);
      text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px;
    }
    .msg-bubble {
      padding: 14px 18px; border-radius: 14px; line-height: 1.6; font-size: 15px;
      max-width: 90%; word-wrap: break-word;
    }
    .msg.user .msg-bubble {
      background: var(--user); color: white; margin-left: auto;
      max-width: 80%;
    }
    .msg.assistant .msg-bubble {
      background: var(--assistant); color: var(--fg);
    }
    .msg.assistant .bubble-content { white-space: pre-wrap; }
    .msg .citation {
      color: var(--citation); font-weight: 600; cursor: pointer;
    }
    .msg .citation:hover { text-decoration: underline; }

    .plan {
      background: rgba(96, 165, 250, 0.08);
      border-left: 3px solid var(--accent);
      border-radius: 4px;
      padding: 10px 14px; margin: 12px 0; font-size: 13px;
    }
    .plan-title {
      font-size: 11px; text-transform: uppercase; color: var(--accent);
      font-weight: 600; letter-spacing: 0.5px; margin-bottom: 6px;
    }
    .plan-step {
      display: flex; align-items: center; gap: 8px; padding: 3px 0;
      color: var(--muted);
    }
    .plan-step.active { color: var(--fg); }
    .plan-step.done { color: var(--muted); }
    .plan-step .dot {
      width: 8px; height: 8px; border-radius: 50%; background: var(--muted); flex-shrink: 0;
    }
    .plan-step.active .dot { background: var(--accent); animation: pulse 1.2s infinite; }
    .plan-step.done .dot { background: var(--success); }
    @keyframes pulse { 50% { opacity: 0.3; transform: scale(0.8); } }

    .sources {
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid var(--border); border-radius: 8px;
      padding: 12px; margin: 14px 0; font-size: 13px;
    }
    .sources-title {
      font-size: 11px; text-transform: uppercase; color: var(--muted);
      font-weight: 600; letter-spacing: 0.5px; margin-bottom: 8px;
    }
    .source {
      display: flex; gap: 10px; padding: 6px 0;
      border-bottom: 1px solid var(--border);
    }
    .source:last-child { border-bottom: none; }
    .source.highlighted {
      background: rgba(96, 165, 250, 0.15); border-radius: 4px;
      padding-left: 6px; margin-left: -6px;
    }
    .source .num {
      color: var(--citation); font-weight: 600; min-width: 20px; flex-shrink: 0;
    }
    .source .info { flex: 1; min-width: 0; }
    .source .title {
      color: var(--fg); text-decoration: none; display: block;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .source .domain { color: var(--muted); font-size: 11px; }

    .related {
      display: flex; flex-wrap: wrap; gap: 8px; margin: 14px 0 0;
    }
    .related-item {
      background: rgba(96, 165, 250, 0.08);
      border: 1px solid rgba(96, 165, 250, 0.3);
      border-radius: 16px; padding: 6px 14px;
      font-size: 13px; color: var(--accent);
      cursor: pointer; transition: all 0.15s;
    }
    .related-item:hover { background: rgba(96, 165, 250, 0.15); border-color: var(--accent); }

    .cursor {
      display: inline-block; margin-left: 2px;
      animation: blink 1s infinite; color: var(--accent);
    }
    @keyframes blink { 50% { opacity: 0; } }

    .input-bar {
      padding: 16px 24px; border-top: 1px solid var(--border);
      background: var(--panel);
    }
    .input-row {
      max-width: 880px; margin: 0 auto;
      display: flex; gap: 8px; align-items: flex-end;
    }
    .input-box {
      flex: 1; background: var(--bg); color: var(--fg);
      border: 1px solid var(--border); border-radius: 12px;
      padding: 12px 16px; font-size: 15px; font-family: inherit;
      outline: none; resize: none; min-height: 24px; max-height: 200px;
      line-height: 1.4;
    }
    .input-box:focus { border-color: var(--accent); }
    .input-box:disabled { opacity: 0.5; }
    .send-btn {
      background: var(--accent); color: #0e0e10;
      border: none; border-radius: 12px;
      padding: 0 22px; height: 46px; font-weight: 600; cursor: pointer;
      font-size: 14px;
    }
    .send-btn:disabled { background: var(--muted); cursor: not-allowed; }
    .empty {
      text-align: center; padding: 60px 24px; color: var(--muted);
    }
    .empty h2 { color: var(--fg); margin: 0 0 8px; font-size: 28px; }
    .empty p { margin: 0; font-size: 15px; line-height: 1.6; }
    .empty .examples { margin-top: 24px; }
    .empty .example {
      display: inline-block; background: var(--panel); border: 1px solid var(--border);
      border-radius: 16px; padding: 8px 14px; margin: 4px;
      cursor: pointer; font-size: 13px;
    }
    .empty .example:hover { border-color: var(--accent); }
  </style>
</head>
<body>
  <div class="header">
    <span style="font-size: 22px;">🔍</span>
    <h1>Anvil Perplexity</h1>
    <span class="tag">Search · Read · Synthesize · Cite</span>
  </div>

  <div class="messages" id="messages">
    <div class="empty" id="empty">
      <h2>Ask anything</h2>
      <p>The agent will plan the search, read the top sources, and stream a cited answer.</p>
      <div class="examples">
        <span class="example" onclick="ask('What is event sourcing?')">What is event sourcing?</span>
        <span class="example" onclick="ask('Best practices for gRPC in microservices')">Best practices for gRPC in microservices</span>
        <span class="example" onclick="ask('Compare PostgreSQL and MongoDB for time-series data')">Compare PostgreSQL and MongoDB...</span>
      </div>
    </div>
  </div>

  <div class="input-bar">
    <div class="input-row">
      <textarea
        id="input"
        class="input-box"
        placeholder="Ask a question..."
        rows="1"
        autofocus></textarea>
      <button id="send" class="send-btn" onclick="askFromInput()">Search</button>
    </div>
  </div>

  <script>
    const $ = (s) => document.querySelector(s);
    const messagesEl = $('#messages');
    const inputEl = $('#input');
    const sendBtn = $('#send');
    let currentES = null;
    let currentRun = null;  // tracks the in-flight assistant message

    let threadId = null;  // one thread per page load; browser keeps the chat history

    function escapeHtml(s) {
      if (s == null) return '';
      return String(s).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
      }[c]));
    }

    function renderCitations(text) {
      // Wrap [N] in clickable spans; safe — we escape first then add markup
      const safe = escapeHtml(text);
      return safe.replace(/\\[(\\d+)\\]/g, '<span class="citation" data-id="$1">[$1]</span>');
    }

    function autoSize() {
      inputEl.style.height = 'auto';
      inputEl.style.height = Math.min(inputEl.scrollHeight, 200) + 'px';
    }

    function hideEmpty() {
      const e = $('#empty');
      if (e) e.remove();
    }

    function addUserMessage(text) {
      hideEmpty();
      const div = document.createElement('div');
      div.className = 'msg user';
      div.innerHTML =
        '<div class="msg-role">You</div>' +
        '<div class="msg-bubble">' + escapeHtml(text) + '</div>';
      messagesEl.appendChild(div);
      scrollToBottom();
    }

    function startAssistantMessage() {
      hideEmpty();
      const div = document.createElement('div');
      div.className = 'msg assistant';
      div.innerHTML =
        '<div class="msg-role">Anvil</div>' +
        '<div class="msg-bubble">' +
          '<div class="plan" style="display:none"><div class="plan-title">Plan</div><div class="plan-list"></div></div>' +
          '<div class="bubble-content"></div>' +
          '<div class="sources" style="display:none"><div class="sources-title">Sources</div><div class="sources-list"></div></div>' +
          '<div class="related" style="display:none"></div>' +
        '</div>';
      messagesEl.appendChild(div);
      currentRun = {
        el: div,
        planEl: div.querySelector('.plan'),
        planList: div.querySelector('.plan-list'),
        contentEl: div.querySelector('.bubble-content'),
        sourcesEl: div.querySelector('.sources'),
        sourcesList: div.querySelector('.sources-list'),
        relatedEl: div.querySelector('.related'),
        text: '',
        planSteps: {},
        sources: [],
      };
      scrollToBottom();
    }

    function updatePlan(step) {
      if (!currentRun) return;
      const id = step.id;
      if (!currentRun.planSteps[id]) {
        currentRun.planSteps[id] = { intent: step.intent || '', detail: '', status: 'pending' };
      }
      if (step.status) currentRun.planSteps[id].status = step.status;
      if (step.detail) currentRun.planSteps[id].detail = step.detail;
      // Render
      const html = Object.entries(currentRun.planSteps).map(([i, s]) => {
        let icon = '○';
        if (s.status === 'done') icon = '✓';
        else if (s.status === 'running') icon = '◐';
        return '<div class="plan-step ' + s.status + '">' +
          '<span class="dot"></span>' +
          '<span>' + escapeHtml(s.intent) + (s.detail ? ' <span style="opacity:0.6">— ' + escapeHtml(s.detail) + '</span>' : '') + '</span>' +
        '</div>';
      }).join('');
      currentRun.planList.innerHTML = html;
      currentRun.planEl.style.display = 'block';
    }

    function setSources(sources) {
      if (!currentRun) return;
      currentRun.sources = sources;
      const html = sources.map(s =>
        '<div class="source" data-id="' + s.id + '">' +
          '<span class="num">[' + s.id + ']</span>' +
          '<span class="info">' +
            '<a class="title" href="' + escapeHtml(s.url) + '" target="_blank" rel="noopener">' +
              escapeHtml(s.title) + '</a>' +
            '<span class="domain">' + escapeHtml(s.domain) + '</span>' +
          '</span>' +
        '</div>'
      ).join('');
      currentRun.sourcesList.innerHTML = html;
      currentRun.sourcesEl.style.display = 'block';
    }

    function highlightCitation(id) {
      if (!currentRun) return;
      currentRun.sourcesList.querySelectorAll('.source').forEach(el => {
        el.classList.toggle('highlighted', el.dataset.id == id);
      });
    }

    function appendAnswer(text) {
      if (!currentRun) return;
      currentRun.text += text;
      // Highlight any new [N] citations inline
      const rendered = renderCitations(currentRun.text);
      currentRun.contentEl.innerHTML = rendered + '<span class="cursor">▍</span>';
      // Highlight matching source as we go
      const matches = text.match(/\\[(\\d+)\\]/g);
      if (matches) {
        matches.forEach(m => {
          const id = m.replace(/[\\[\\]]/g, '');
          highlightCitation(id);
        });
      }
      scrollToBottom();
    }

    function setRelated(questions) {
      if (!currentRun || !questions || questions.length === 0) return;
      const html = questions.map(q =>
        '<span class="related-item" onclick="ask(\\'' + escapeHtml(q).replace(/'/g, "\\\\'") + '\\')">' +
          escapeHtml(q) + '</span>'
      ).join('');
      currentRun.relatedEl.innerHTML = html;
      currentRun.relatedEl.style.display = 'flex';
    }

    function finishMessage() {
      if (!currentRun) return;
      // Remove streaming cursor
      const cursor = currentRun.contentEl.querySelector('.cursor');
      if (cursor) cursor.remove();
      currentRun = null;
    }

    function showError(message) {
      if (!currentRun) startAssistantMessage();
      if (currentRun) {
        currentRun.contentEl.innerHTML =
          '<span style="color: #ef4444;">⚠ ' + escapeHtml(message) + '</span>';
        finishMessage();
      }
    }

    function scrollToBottom() {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    async function ask(text) {
      text = (text || inputEl.value).trim();
      if (!text) return;
      inputEl.value = '';
      autoSize();
      sendBtn.disabled = true;
      addUserMessage(text);
      startAssistantMessage();

      if (currentES) currentES.close();

      try {
        const r = await fetch('/perplexity/ask', {
          method: 'POST',
          headers: {'content-type': 'application/json'},
          body: JSON.stringify({ question: text, thread_id: threadId })
        });
        const data = await r.json();
        if (data.thread_id) threadId = data.thread_id;  // first call sets it
        const { session_id, stream_url } = data;
        currentES = new EventSource(stream_url);

        currentES.addEventListener('plan.step', (e) => {
          const d = JSON.parse(e.data);
          updatePlan(d.payload);
        });
        currentES.addEventListener('sources.found', (e) => {
          const d = JSON.parse(e.data);
          setSources(d.payload.sources);
        });
        currentES.addEventListener('answer.chunk', (e) => {
          const d = JSON.parse(e.data);
          appendAnswer(d.payload.delta);
        });
        currentES.addEventListener('frontend.call', (e) => {
          const d = JSON.parse(e.data);
          if (d.payload.name === 'render_sources') setSources(d.payload.input.sources);
          if (d.payload.name === 'show_plan_step') {/* plan already shown via plan.step */}
          if (d.payload.name === 'highlight_citation') highlightCitation(d.payload.input.id);
          if (d.payload.name === 'show_related') setRelated(d.payload.input.questions);
        });
        currentES.addEventListener('done', () => {
          finishMessage();
          sendBtn.disabled = false;
          currentES.close();
          inputEl.focus();
        });
        currentES.addEventListener('error', (e) => {
          const data = e.data ? JSON.parse(e.data) : null;
          if (data && data.payload && data.payload.message) {
            showError(data.payload.message);
          } else {
            showError('Connection error');
          }
          finishMessage();
          sendBtn.disabled = false;
          currentES.close();
          inputEl.focus();
        });
      } catch (err) {
        showError(err.message);
        sendBtn.disabled = false;
        inputEl.focus();
      }
    }

    function askFromInput() { ask(); }

    // Enter to send, Shift+Enter for newline
    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        ask();
      }
    });
    inputEl.addEventListener('input', autoSize);
    inputEl.focus();
  </script>
</body>
</html>`
