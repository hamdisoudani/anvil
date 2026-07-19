package perplexity

// indexHTML is the embedded demo page. Pure vanilla JS — no React,
// no build step. The wire protocol is what we're testing; the UI
// just demonstrates it.
//
// In production, the React SDK (sdk/packages/anvil-react) replaces
// this with a real component using the same SSE event format.
const indexHTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Anvil Perplexity</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    :root { --bg: #0e0e10; --panel: #18181b; --border: #27272a; --fg: #e4e4e7; --muted: #71717a; --accent: #60a5fa; --citation: #fbbf24; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: ui-sans-serif, system-ui, sans-serif; background: var(--bg); color: var(--fg); }
    .app { display: grid; grid-template-columns: 1fr 360px; height: 100vh; }
    .main { display: flex; flex-direction: column; padding: 24px; overflow: hidden; }
    .sidebar { background: var(--panel); border-left: 1px solid var(--border); padding: 24px; overflow-y: auto; }
    h1 { margin: 0 0 8px; font-size: 20px; }
    h2 { margin: 0 0 12px; font-size: 14px; text-transform: uppercase; color: var(--muted); letter-spacing: 0.5px; }
    .search-box { display: flex; gap: 8px; margin-bottom: 16px; }
    input { flex: 1; background: var(--panel); color: var(--fg); border: 1px solid var(--border); border-radius: 12px; padding: 14px 18px; font-size: 15px; outline: none; }
    input:focus { border-color: var(--accent); }
    button { background: var(--accent); color: #0e0e10; border: none; border-radius: 12px; padding: 0 24px; font-weight: 600; cursor: pointer; }
    button:disabled { background: var(--muted); cursor: not-allowed; }
    .answer { white-space: pre-wrap; line-height: 1.6; font-size: 15px; padding: 24px; background: var(--panel); border: 1px solid var(--border); border-radius: 12px; flex: 1; overflow-y: auto; min-height: 200px; }
    .answer .citation { color: var(--citation); font-weight: 600; cursor: pointer; }
    .answer .citation:hover { text-decoration: underline; }
    .plan { background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 12px; margin-bottom: 12px; font-size: 13px; color: var(--muted); }
    .plan-step { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
    .plan-step:last-child { margin-bottom: 0; }
    .plan-step .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--muted); flex-shrink: 0; }
    .plan-step.running .dot { background: var(--accent); animation: pulse 1s infinite; }
    .plan-step.done .dot { background: #22c55e; }
    .plan-step .label { font-weight: 500; color: var(--fg); }
    .plan-step .detail { opacity: 0.7; }
    @keyframes pulse { 50% { opacity: 0.4; } }
    .sub-queries { background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 12px; margin-bottom: 12px; font-size: 13px; }
    .sub-query { padding: 6px 0; border-bottom: 1px solid var(--border); }
    .sub-query:last-child { border-bottom: none; }
    .sub-query .id { color: var(--accent); font-weight: 600; margin-right: 8px; }
    .sub-query .q { color: var(--fg); }
    .related { margin-top: 16px; }
    .related-item { background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 12px; margin-bottom: 8px; cursor: pointer; font-size: 14px; }
    .related-item:hover { border-color: var(--accent); }
    .source { display: flex; gap: 12px; padding: 10px; border-radius: 8px; margin-bottom: 6px; font-size: 13px; transition: background 0.2s; }
    .source.highlighted { background: rgba(96, 165, 250, 0.15); border-left: 2px solid var(--accent); padding-left: 8px; }
    .source .num { font-weight: 600; color: var(--accent); min-width: 24px; }
    .source .info { flex: 1; }
    .source .title { color: var(--fg); text-decoration: none; display: block; margin-bottom: 2px; }
    .source .domain { color: var(--muted); font-size: 11px; }
    .source.used { opacity: 0.5; }
    .empty { color: var(--muted); font-style: italic; text-align: center; padding: 24px; }
    .progress { background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 12px; margin-bottom: 12px; color: var(--muted); font-size: 13px; }
  </style>
</head>
<body>
  <div class="app">
    <div class="main">
      <h1>🔍 Anvil Perplexity</h1>
      <div class="search-box">
        <input id="q" placeholder="Ask anything…" autofocus />
        <button id="go">Search</button>
      </div>
      <div id="plan" class="plan" style="display:none"></div>
      <div id="subqueries" class="sub-queries" style="display:none"></div>
      <div id="progress" class="progress" style="display:none"></div>
      <div id="answer" class="answer">
        <div class="empty">Ask a question. The agent will build a search plan, run sub-queries in parallel, read the top sources, and stream a cited answer.</div>
      </div>
      <div id="related" class="related"></div>
    </div>
    <div class="sidebar">
      <h2>Sources</h2>
      <div id="sources"><div class="empty">No sources yet.</div></div>
    </div>
  </div>
  <script>
    const $ = (s) => document.querySelector(s);
    const answer = $('#answer');
    const sources = $('#sources');
    const plan = $('#plan');
    const subqueries = $('#subqueries');
    const progress = $('#progress');
    const related = $('#related');
    let currentEventSource = null;
    let planSteps = {};
    let answerBuffer = '';
    let pendingCitations = [];

    function setPlan(id, intent, status, detail) {
      if (status === 'done') return;  // don't keep showing done steps
      plan.style.display = 'block';
      if (!planSteps[id]) planSteps[id] = { intent, status: 'pending' };
      if (status) planSteps[id].status = status;
      if (detail) planSteps[id].detail = detail;
      renderPlan();
    }

    function renderPlan() {
      plan.innerHTML = '<strong>Plan</strong>' + Object.entries(planSteps).map(([id, s]) =>
        '<div class="plan-step ' + s.status + '"><div class="dot"></div>' +
        '<span class="label">' + escape(s.intent) + '</span>' +
        (s.detail ? ' <span class="detail">— ' + escape(s.detail) + '</span>' : '') +
        '</div>'
      ).join('');
    }

    function setSubQueries(planObj) {
      if (!planObj || !planObj.sub_queries || planObj.sub_queries.length === 0) {
        subqueries.style.display = 'none';
        return;
      }
      subqueries.style.display = 'block';
      subqueries.innerHTML = '<strong>Search plan</strong>' + planObj.sub_queries.map(q =>
        '<div class="sub-query"><span class="id">' + q.id + '</span>' +
        '<span class="q">' + escape(q.query) + '</span>' +
        (q.year ? ' <span style="opacity:0.5">(' + q.year + ')</span>' : '') +
        '</div>'
      ).join('');
    }

    function append(text) {
      if (answer.querySelector('.empty')) answer.innerHTML = '';
      answerBuffer += text;
      // Highlight [N] citations
      const highlighted = answerBuffer.replace(/\\[(\\d+)\\]/g, (m, n) => {
        return '<span class="citation" data-id="' + n + '">' + m + '</span>';
      });
      answer.innerHTML = highlighted;
      // Detect new citations in this chunk
      const matches = text.match(/\\[(\\d+)\\]/g);
      if (matches) {
        matches.forEach(m => {
          const id = m.replace(/[\\[\\]]/g, '');
          pendingCitations.push(parseInt(id));
          highlight(parseInt(id));
        });
      }
      answer.scrollTop = answer.scrollHeight;
    }

    function setSources(list) {
      if (!list || list.length === 0) { sources.innerHTML = '<div class="empty">No sources yet.</div>'; return; }
      sources.innerHTML = list.map(s =>
        '<div class="source" data-id="' + s.id + '" data-url="' + s.url + '">' +
        '<div class="num">[' + s.id + ']</div>' +
        '<div class="info"><a class="title" href="' + s.url + '" target="_blank" rel="noopener">' + escape(s.title) + '</a>' +
        '<div class="domain">' + s.domain + '</div></div></div>'
      ).join('');
    }

    function highlight(id) {
      document.querySelectorAll('.source').forEach(el => el.classList.remove('highlighted'));
      const el = document.querySelector('.source[data-id="' + id + '"]');
      if (el) {
        el.classList.add('highlighted');
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }

    function setRelated(questions) {
      if (!questions || questions.length === 0) return;
      related.innerHTML = '<h2>Related</h2>' + questions.map(q =>
        '<div class="related-item" onclick="$(\\'#q\\').value = \\'' + escape(q).replace(/'/g, "\\\\'") + '\\'; ask();">' + escape(q) + '</div>'
      ).join('');
    }

    function escape(s) {
      if (s == null) return '';
      const d = document.createElement('div'); d.textContent = s; return d.innerHTML;
    }

    function ask() {
      const q = $('#q').value.trim();
      if (!q) return;
      $('#go').disabled = true;
      answer.innerHTML = '';
      answerBuffer = '';
      pendingCitations = [];
      related.innerHTML = '';
      planSteps = {};
      plan.style.display = 'none';
      subqueries.style.display = 'none';
      sources.innerHTML = '<div class="empty">Searching…</div>';
      progress.style.display = 'block';
      progress.textContent = 'Starting…';

      if (currentEventSource) currentEventSource.close();

      fetch('/perplexity/ask', {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({ question: q })
      })
      .then(r => r.json())
      .then(({ session_id, stream_url }) => {
        currentEventSource = new EventSource(stream_url);
        currentEventSource.addEventListener('ready', () => {
          progress.textContent = 'Connected. Agent is planning the search…';
        });
        currentEventSource.addEventListener('plan.step', (e) => {
          const d = JSON.parse(e.data);
          setPlan(d.id, d.intent, d.status, d.detail);
          progress.style.display = 'none';
        });
        currentEventSource.addEventListener('sources.found', (e) => {
          const d = JSON.parse(e.data);
          setSources(d.sources);
        });
        currentEventSource.addEventListener('answer.chunk', (e) => {
          const d = JSON.parse(e.data);
          append(d.delta);
        });
        currentEventSource.addEventListener('frontend.call', (e) => {
          const d = JSON.parse(e.data);
          if (d.name === 'render_sources') setSources(d.input.sources);
          if (d.name === 'show_plan_step') setSubQueries(d.input);
          if (d.name === 'highlight_citation') highlight(d.input.id);
          if (d.name === 'show_related') setRelated(d.input.questions);
        });
        currentEventSource.addEventListener('done', () => {
          $('#go').disabled = false;
          progress.style.display = 'none';
          currentEventSource.close();
        });
        currentEventSource.addEventListener('error', (e) => {
          progress.textContent = 'Connection error';
          $('#go').disabled = false;
        });
      });
    }

    $('#go').onclick = ask;
    $('#q').addEventListener('keydown', (e) => { if (e.key === 'Enter') ask(); });
  </script>
</body>
</html>`
