// Package perplexity — index page
//
// The embedded HTML uses Tailwind via CDN and shadcn-style components
// (built directly in the HTML with Tailwind classes — no manual CSS).
// The shadcn/ui "components" here follow the same class recipes as
// shadcn/ui for React. The real shadcn/ui is used in the React SDK
// (sdk/packages/anvil-react/) — these match it visually.
package perplexity

const indexHTML = `<!doctype html>
<html lang="en" class="dark">
<head>
  <meta charset="utf-8" />
  <title>Anvil Perplexity</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      darkMode: 'class',
      theme: {
        extend: {
          colors: {
            border: 'hsl(var(--border))',
            input: 'hsl(var(--input))',
            ring: 'hsl(var(--ring))',
            background: 'hsl(var(--background))',
            foreground: 'hsl(var(--foreground))',
            primary: { DEFAULT: 'hsl(var(--primary))', foreground: 'hsl(var(--primary-foreground))' },
            secondary: { DEFAULT: 'hsl(var(--secondary))', foreground: 'hsl(var(--secondary-foreground))' },
            muted: { DEFAULT: 'hsl(var(--muted))', foreground: 'hsl(var(--muted-foreground))' },
            accent: { DEFAULT: 'hsl(var(--accent))', foreground: 'hsl(var(--accent-foreground))' },
            destructive: { DEFAULT: 'hsl(var(--destructive))', foreground: 'hsl(var(--destructive-foreground))' },
            card: { DEFAULT: 'hsl(var(--card))', foreground: 'hsl(var(--card-foreground))' },
          },
          borderRadius: { lg: 'var(--radius)', md: 'calc(var(--radius) - 2px)', sm: 'calc(var(--radius) - 4px)' },
        },
      },
    }
  </script>
  <style>
    :root {
      --background: 0 0% 7%;
      --foreground: 0 0% 91%;
      --card: 0 0% 9%;
      --card-foreground: 0 0% 91%;
      --popover: 0 0% 9%;
      --popover-foreground: 0 0% 91%;
      --primary: 217 91% 60%;
      --primary-foreground: 0 0% 7%;
      --secondary: 0 0% 14%;
      --secondary-foreground: 0 0% 91%;
      --muted: 0 0% 14%;
      --muted-foreground: 0 0% 45%;
      --accent: 217 91% 60%;
      --accent-foreground: 0 0% 7%;
      --destructive: 0 84% 60%;
      --destructive-foreground: 0 0% 91%;
      --border: 0 0% 15%;
      --input: 0 0% 15%;
      --ring: 217 91% 60%;
      --radius: 0.75rem;
    }
  </style>
</head>
<body class="h-full bg-background text-foreground font-sans antialiased">
  <div class="flex h-screen flex-col">
    <!-- Header -->
    <header class="flex h-14 items-center gap-3 border-b px-6 bg-card">
      <span class="text-xl">🔍</span>
      <h1 class="text-base font-semibold">Anvil Perplexity</h1>
      <span class="text-xs text-muted-foreground">Search · Read · Synthesize · Cite</span>
    </header>

    <!-- Messages -->
    <main id="messages" class="flex-1 overflow-y-auto">
      <div class="mx-auto max-w-3xl px-6 py-8 space-y-6">
        <!-- Empty state -->
        <div id="empty" class="flex flex-col items-center justify-center min-h-[60vh] text-center space-y-3">
          <h2 class="text-3xl font-bold tracking-tight">Ask anything</h2>
          <p class="text-muted-foreground max-w-md">
            The agent will plan the search, read the top sources, and stream a cited answer.
          </p>
          <div class="flex flex-wrap justify-center gap-2 pt-6">
            <button onclick="ask('What is event sourcing?')" class="rounded-full border bg-card px-4 py-2 text-xs hover:border-primary hover:text-primary transition-colors">What is event sourcing?</button>
            <button onclick="ask('Best practices for gRPC in microservices')" class="rounded-full border bg-card px-4 py-2 text-xs hover:border-primary hover:text-primary transition-colors">Best practices for gRPC in microservices</button>
            <button onclick="ask('Compare PostgreSQL and MongoDB for time-series data')" class="rounded-full border bg-card px-4 py-2 text-xs hover:border-primary hover:text-primary transition-colors">Compare PostgreSQL and MongoDB…</button>
          </div>
        </div>
      </div>
    </main>

    <!-- Input -->
    <div class="border-t bg-card p-4">
      <form id="ask-form" class="mx-auto max-w-3xl flex items-end gap-2">
        <textarea
          id="input"
          placeholder="Ask a question..."
          rows="1"
          autofocus
          class="flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50 max-h-48"></textarea>
        <button type="submit" id="send" class="inline-flex items-center justify-center rounded-md bg-primary text-primary-foreground h-10 px-5 text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:pointer-events-none">
          Search
        </button>
      </form>
    </div>
  </div>

  <script>
    const $ = (s) => document.querySelector(s);
    const messagesEl = $('#messages');
    const inputEl = $('#input');
    const sendBtn = $('#send');
    const formEl = $('#ask-form');
    let currentES = null;
    let currentRun = null;
    let threadId = null;

    function escapeHtml(s) {
      if (s == null) return '';
      return String(s).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
      }[c]));
    }

    function renderCitations(text) {
      const safe = escapeHtml(text);
      return safe.replace(/\[(\d+)\]/g, '<button type="button" onclick="highlightCitation($1)" class="text-yellow-500 font-semibold hover:underline mx-0.5 cursor-pointer" data-id="$1">[$1]</button>');
    }

    function autoSize() {
      inputEl.style.height = 'auto';
      inputEl.style.height = Math.min(inputEl.scrollHeight, 192) + 'px';
    }

    function hideEmpty() {
      const e = $('#empty');
      if (e) e.remove();
    }

    function addUserMessage(text) {
      hideEmpty();
      const wrap = document.createElement('div');
      wrap.className = 'flex justify-end';
      wrap.innerHTML =
        '<div class="max-w-[80%] rounded-2xl rounded-br-sm bg-primary text-primary-foreground px-4 py-2.5 text-sm whitespace-pre-wrap">' +
          escapeHtml(text) +
        '</div>';
      messagesEl.querySelector('div').appendChild(wrap);
      scrollToBottom();
    }

    function startAssistantMessage() {
      hideEmpty();
      const wrap = document.createElement('div');
      wrap.className = 'flex justify-start';
      wrap.innerHTML =
        '<div class="max-w-[90%] space-y-3">' +
          '<div class="text-xs font-medium text-muted-foreground uppercase tracking-wide">Anvil</div>' +
          // Plan card
          '<div id="plan-card" class="hidden rounded-md border border-primary/30 bg-primary/5 p-3 text-xs">' +
            '<div class="font-semibold text-primary uppercase tracking-wide mb-2">Plan</div>' +
            '<div id="plan-list" class="space-y-1 text-muted-foreground"></div>' +
          '</div>' +
          // Answer
          '<div class="rounded-2xl rounded-bl-sm bg-card border px-4 py-3 text-sm whitespace-pre-wrap" id="bubble-content"></div>' +
          // Sources
          '<div id="sources-card" class="hidden rounded-md border bg-card p-3 text-xs">' +
            '<div class="font-semibold uppercase tracking-wide text-muted-foreground mb-2">Sources</div>' +
            '<div id="sources-list" class="space-y-1.5"></div>' +
          '</div>' +
          // Related
          '<div id="related-card" class="hidden flex flex-wrap gap-2"></div>' +
        '</div>';
      messagesEl.querySelector('div').appendChild(wrap);
      currentRun = {
        el: wrap,
        planCard: wrap.querySelector('#plan-card'),
        planList: wrap.querySelector('#plan-list'),
        contentEl: wrap.querySelector('#bubble-content'),
        sourcesCard: wrap.querySelector('#sources-card'),
        sourcesList: wrap.querySelector('#sources-list'),
        relatedCard: wrap.querySelector('#related-card'),
        text: '',
        planSteps: {},
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
      const html = Object.entries(currentRun.planSteps).map(([i, s]) => {
        let cls = 'flex items-start gap-2';
        if (s.status === 'done') cls += ' text-muted-foreground';
        else if (s.status === 'running') cls += ' text-foreground';
        let dotCls = 'mt-1 h-1.5 w-1.5 rounded-full flex-shrink-0 ';
        if (s.status === 'done') dotCls += 'bg-green-500';
        else if (s.status === 'running') dotCls += 'bg-primary animate-pulse';
        else dotCls += 'bg-muted-foreground';
        return '<div class="' + cls + '">' +
          '<span class="' + dotCls + '"></span>' +
          '<span>' + escapeHtml(s.intent) + (s.detail ? ' <span class="opacity-60">— ' + escapeHtml(s.detail) + '</span>' : '') + '</span>' +
        '</div>';
      }).join('');
      currentRun.planList.innerHTML = html;
      currentRun.planCard.classList.remove('hidden');
    }

    function setSources(sources) {
      if (!currentRun) return;
      const html = sources.map(s =>
        '<div data-id="' + s.id + '" class="flex gap-2 py-1 border-b border-border last:border-0 transition-colors rounded px-1 -mx-1 source-row">' +
          '<span class="font-semibold text-yellow-500 min-w-[1.5rem]">[' + s.id + ']</span>' +
          '<div class="min-w-0 flex-1">' +
            '<a href="' + escapeHtml(s.url) + '" target="_blank" rel="noopener" class="block truncate hover:text-primary transition-colors">' +
              escapeHtml(s.title) + '</a>' +
            '<div class="text-muted-foreground text-[10px]">' + escapeHtml(s.domain) + '</div>' +
          '</div>' +
        '</div>'
      ).join('');
      currentRun.sourcesList.innerHTML = html;
      currentRun.sourcesCard.classList.remove('hidden');
    }

    window.highlightCitation = function(id) {
      if (!currentRun) return;
      currentRun.sourcesList.querySelectorAll('.source-row').forEach(el => {
        if (el.dataset.id == id) {
          el.classList.add('bg-primary/15', 'border-primary/50');
        } else {
          el.classList.remove('bg-primary/15', 'border-primary/50');
        }
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
    };

    function appendAnswer(text) {
      if (!currentRun) return;
      currentRun.text += text;
      currentRun.contentEl.innerHTML = renderCitations(currentRun.text) +
        '<span class="inline-block w-1.5 h-3 bg-primary ml-0.5 animate-pulse align-middle"></span>';
      const matches = text.match(/\[(\d+)\]/g);
      if (matches) {
        matches.forEach(m => {
          const id = m.replace(/[\[\]]/g, '');
          highlightCitation(id);
        });
      }
      scrollToBottom();
    }

    function setRelated(questions) {
      if (!currentRun || !questions || questions.length === 0) return;
      const html = questions.map(q =>
        '<button type="button" onclick="ask(\'' + escapeHtml(q).replace(/'/g, "\\'") + '\')" class="rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs text-primary hover:bg-primary/20 transition-colors">' +
          escapeHtml(q) +
        '</button>'
      ).join('');
      currentRun.relatedCard.innerHTML = html;
      currentRun.relatedCard.classList.remove('hidden');
    }

    function finishMessage() {
      if (!currentRun) return;
      const cursor = currentRun.contentEl.querySelector('.animate-pulse');
      if (cursor) cursor.remove();
      currentRun = null;
    }

    function showError(message) {
      if (!currentRun) startAssistantMessage();
      if (currentRun) {
        currentRun.contentEl.innerHTML =
          '<div class="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-destructive text-xs">⚠ ' + escapeHtml(message) + '</div>';
        finishMessage();
      }
    }

    function scrollToBottom() {
      const inner = messagesEl.querySelector('div');
      inner.scrollTop = inner.scrollHeight;
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
        if (data.thread_id) threadId = data.thread_id;
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

    formEl.addEventListener('submit', (e) => {
      e.preventDefault();
      ask();
    });
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
