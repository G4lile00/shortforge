/* ShortForge - SPA (vanilla JS + Tailwind) */
'use strict';

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function toast(msg, type = 'info') {
  const colors = { info: 'border-forge-border', success: 'border-green-500/60', error: 'border-red-500/60', warn: 'border-yellow-500/60' };
  const el = document.createElement('div');
  el.className = `fadein max-w-sm px-4 py-3 rounded-xl bg-forge-panel border ${colors[type]} shadow-xl text-sm`;
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), 5000);
}

const fmtDate = (iso) => iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '--';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const STATUS = {
  queued: ['Na fila', 'bg-yellow-500/15 text-yellow-400 border-yellow-500/40'],
  scripted: ['Roteiro pronto', 'bg-orange-500/15 text-orange-400 border-orange-500/40'],
  rendering: ['Renderizando', 'bg-purple-500/15 text-purple-300 border-purple-500/40'],
  rendered: ['Pronto', 'bg-green-500/15 text-green-400 border-green-500/40'],
  failed: ['Falhou', 'bg-red-500/15 text-red-400 border-red-500/40'],
};
const badge = (s) => {
  const [label, cls] = STATUS[s] || [s, 'bg-forge-panel text-forge-muted border-forge-border'];
  return `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border ${cls}">${label}</span>`;
};

function copyText(txt, label = 'Copiado!') {
  const fallback = () => {
    const ta = document.createElement('textarea');
    ta.value = txt;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); toast(label, 'success'); }
    catch { toast('Nao consegui copiar - selecione o campo manualmente', 'error'); }
    ta.remove();
  };
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(txt).then(() => toast(label, 'success')).catch(fallback);
  } else fallback();
}

/* ============ PAINEL ============ */
async function renderPainel(el) {
  el.innerHTML = '<div class="text-forge-muted text-sm">Carregando...</div>';
  const [st, logs] = await Promise.all([api('api/status'), api('api/logs')]);
  const cards = [
    { label: 'Temas ativos', value: st.counts.themes, icon: '🎯' },
    { label: 'Em producao', value: st.counts.producing ?? 0, icon: '⏳' },
    { label: 'Prontos para revisao', value: st.counts.rendered, icon: '📥' },
    { label: 'Videos no total', value: st.counts.videos, icon: '🎬' },
  ];
  const deps = [
    ['FFmpeg', st.ffmpeg, 'necessario para renderizar os videos (instale: apt install ffmpeg)'],
    ['Narracao nativa (msedge-tts)', st.ttsBundled, 'vozes neurais pt-BR embutidas, sem Python e sem chave de API'],
    ['Worker automatico', st.worker.enabled, `intervalo de ${st.worker.intervalMin} min - meta: ${st.worker.dailyTarget} videos/dia`],
  ];
  el.innerHTML = `
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
      ${cards.map((c) => `
        <div class="rounded-2xl border border-forge-border bg-forge-panel p-5">
          <div class="text-2xl">${c.icon}</div>
          <div class="mt-2 text-3xl font-extrabold">${c.value}</div>
          <div class="text-xs text-forge-muted mt-1">${c.label}</div>
        </div>`).join('')}
    </div>

    <div class="grid lg:grid-cols-2 gap-4 mt-6">
      <div class="rounded-2xl border border-forge-border bg-forge-panel p-6">
        <h2 class="font-bold mb-4">Saude do sistema</h2>
        <ul class="space-y-3 text-sm">
          ${deps.map(([name, ok, hint]) => `
            <li class="flex items-start gap-3">
              <span class="mt-0.5 w-2.5 h-2.5 rounded-full shrink-0 ${ok ? 'bg-green-500' : 'bg-red-500'}"></span>
              <div><span class="font-semibold">${name}</span>
              <span class="text-forge-muted text-xs block">${esc(hint)}</span></div>
            </li>`).join('')}
        </ul>
        <div class="mt-4 flex flex-wrap gap-2">
          <button data-goto="producao" class="px-4 py-2 rounded-lg bg-forge-accent text-black font-bold text-sm hover:brightness-110 transition">+ Produzir video</button>
          <button data-goto="baixar" class="px-4 py-2 rounded-lg border border-forge-accent/50 text-forge-accent font-bold text-sm hover:bg-forge-accent/10 transition">Baixar & Publicar</button>
          <button data-goto="config" class="px-4 py-2 rounded-lg border border-forge-border font-semibold text-sm hover:border-forge-accent transition">Configurar APIs</button>
        </div>
      </div>
      <div class="rounded-2xl border border-forge-border bg-forge-panel p-6">
        <h2 class="font-bold mb-4">Ultimas atividades</h2>
        <div class="max-h-72 overflow-y-auto space-y-2 pr-1">
          ${logs.slice(0, 12).map((l) => `
            <div class="text-xs flex gap-2 items-start">
              <span class="shrink-0 text-forge-muted">${fmtDate(l.ts)}</span>
              <span class="shrink-0 font-bold ${l.level === 'error' ? 'text-red-400' : l.level === 'success' ? 'text-green-400' : 'text-forge-accent'}">${esc(l.scope)}</span>
              <span class="text-zinc-300">${esc(l.message)}</span>
            </div>`).join('') || '<p class="text-sm text-forge-muted">Nenhuma atividade ainda.</p>'}
        </div>
      </div>
    </div>`;
  updateWorkerChip(st);
}

/* ============ PRODUCAO ============ */
async function renderProducao(el) {
  const themes = await api('api/themes');
  el.innerHTML = `
    <div class="grid lg:grid-cols-3 gap-6">
      <div class="rounded-2xl border border-forge-border bg-forge-panel p-6 h-fit">
        <h2 class="font-bold mb-1">Novo tema</h2>
        <p class="text-xs text-forge-muted mb-4">Um tema e uma "maquina" de videos. Ex: "Top 10 iscas artificiais para tucunare".</p>
        <form id="themeForm" class="space-y-3 text-sm">
          <div>
            <label class="block text-xs font-semibold mb-1">Nome / titulo do formato</label>
            <input name="name" required placeholder="Top 10 iscas artificiais" class="w-full px-3 py-2 rounded-lg bg-forge-bg border border-forge-border focus:border-forge-accent outline-none" />
          </div>
          <div>
            <label class="block text-xs font-semibold mb-1">Briefing de estilo (nicho, tom, publico)</label>
            <textarea name="brief" rows="3" placeholder="Canal de pesca esportiva, tom curioso e direto, publico masculino 25-45..." class="w-full px-3 py-2 rounded-lg bg-forge-bg border border-forge-border focus:border-forge-accent outline-none"></textarea>
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-xs font-semibold mb-1">Itens (top N)</label>
              <input name="itemCount" type="number" min="3" max="20" value="10" class="w-full px-3 py-2 rounded-lg bg-forge-bg border border-forge-border focus:border-forge-accent outline-none" />
            </div>
            <div>
              <label class="block text-xs font-semibold mb-1">Hashtags fixas (virgula)</label>
              <input name="hashtags" placeholder="#pesca,#iscas" class="w-full px-3 py-2 rounded-lg bg-forge-bg border border-forge-border focus:border-forge-accent outline-none" />
            </div>
          </div>
          <button class="w-full py-2.5 rounded-lg bg-forge-accent text-black font-bold hover:brightness-110 transition">Criar tema</button>
        </form>
      </div>

      <div class="lg:col-span-2 space-y-4">
        <div class="rounded-2xl border border-forge-border bg-forge-panel p-6">
          <h2 class="font-bold mb-4">Produzir agora</h2>
          ${themes.length ? `
            <div class="space-y-3">
              ${themes.map((t) => `
                <div class="flex flex-wrap items-center gap-3 rounded-xl border border-forge-border bg-forge-bg p-4">
                  <div class="min-w-0 flex-1">
                    <div class="font-semibold truncate">${esc(t.name)}</div>
                    <div class="text-xs text-forge-muted mt-0.5">Top ${t.itemCount} - ${esc(t.brief || 'sem briefing')} ${t.active ? '' : '- inativo'}</div>
                  </div>
                  <select data-count-${t.id} class="px-2 py-2 rounded-lg bg-forge-panel border border-forge-border text-xs">
                    <option value="1">1 video</option><option value="2">2 videos</option><option value="3">3 videos</option>
                  </select>
                  <button data-prod="${t.id}" class="px-4 py-2 rounded-lg bg-forge-accent text-black font-bold text-sm hover:brightness-110 transition whitespace-nowrap">Produzir</button>
                  <button data-toggle="${t.id}" data-active="${t.active}" class="px-3 py-2 rounded-lg border border-forge-border text-xs hover:border-forge-accent transition">${t.active ? 'Pausar' : 'Ativar'}</button>
                  <button data-del-theme="${t.id}" class="px-3 py-2 rounded-lg border border-red-500/40 text-red-400 text-xs hover:bg-red-500/10 transition">Excluir</button>
                </div>`).join('')}
            </div>` : '<p class="text-sm text-forge-muted">Nenhum tema ainda. Crie o primeiro ao lado para comecar.</p>'}
        </div>
        <div class="rounded-2xl border border-forge-border bg-forge-panel p-6 text-sm text-forge-muted leading-relaxed">
          <span class="font-semibold text-zinc-300">Como funciona o piloto:</span> para cada video, o sistema gera o roteiro com a IA configurada, narra cada parte com TTS, cria o visual (imagens geradas por IA ou banco licenciado), monta o video vertical 1080x1920 no FFmpeg com legendas queimadas e deixa tudo pronto na aba Baixar & Publicar para voce revisar, baixar e postar onde quiser.
        </div>
      </div>
    </div>`;

  $('#themeForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      await api('api/themes', { method: 'POST', body: {
        name: f.name.value, brief: f.brief.value, itemCount: +f.itemCount.value,
        hashtags: f.hashtags.value.split(',').map((s) => s.trim()).filter(Boolean).map((s) => s.startsWith('#') ? s : '#' + s),
      } });
      toast('Tema criado!', 'success');
      renderProducao(el);
    } catch (err) { toast(err.message, 'error'); }
  });

  $$('[data-prod]', el).forEach((b) => b.addEventListener('click', async () => {
    const id = b.dataset.prod;
    const count = $(`[data-count-${id}]`, el).value;
    try {
      await api('api/videos', { method: 'POST', body: { themeId: id, count: +count } });
      toast(`${count} video(s) em producao - acompanhe na aba Videos`, 'success');
      switchTab('videos');
    } catch (err) { toast(err.message, 'error'); }
  }));

  $$('[data-toggle]', el).forEach((b) => b.addEventListener('click', async () => {
    try {
      await api(`api/themes/${b.dataset.toggle}`, { method: 'PATCH', body: { active: b.dataset.active !== 'true' } });
      renderProducao(el);
    } catch (err) { toast(err.message, 'error'); }
  }));

  $$('[data-del-theme]', el).forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Excluir este tema?')) return;
    try { await api(`api/themes/${b.dataset.delTheme}`, { method: 'DELETE' }); renderProducao(el); }
    catch (err) { toast(err.message, 'error'); }
  }));
}

/* ============ VIDEOS ============ */
async function renderVideos(el) {
  el.innerHTML = '<div class="text-forge-muted text-sm">Carregando...</div>';
  const videos = await api('api/videos');
  el.innerHTML = `
    <div class="flex items-center justify-between mb-4">
      <h2 class="font-bold">Biblioteca de videos <span class="text-forge-muted text-sm font-normal">(${videos.length})</span></h2>
      <button id="refreshVideos" class="text-xs px-3 py-2 rounded-lg border border-forge-border hover:border-forge-accent transition">Atualizar</button>
    </div>
    ${videos.length ? `<div class="grid sm:grid-cols-2 xl:grid-cols-3 gap-5">
      ${videos.map((v) => `
        <article class="rounded-2xl border border-forge-border bg-forge-panel overflow-hidden flex flex-col" data-vcard="${v.id}">
          <div class="aspect-[9/16] max-h-80 w-full relative bg-black">
            ${v.status === 'rendered'
              ? `<video src="media/${v.id}/final.mp4" controls preload="metadata" poster="media/${v.id}/thumb.jpg" class="w-full h-full object-cover"></video>`
              : `<div class="w-full h-full grid place-items-center text-center p-6">
                  <div>
                    <div class="text-4xl mb-2">${v.status === 'failed' ? '⚠️' : v.status === 'rendering' ? '⏳' : '🎬'}</div>
                    <p class="text-xs text-forge-muted">${v.status === 'failed' ? esc(v.error || 'falhou') : badge(v.status).replace(/<[^>]+>/g, '')}</p>
                  </div>
                </div>`}
          </div>
          <div class="p-4 flex-1 flex flex-col gap-2">
            <div class="flex items-start justify-between gap-2">
              <h3 class="font-semibold text-sm leading-snug line-clamp-2">${esc(v.title)}</h3>
              ${badge(v.status)}
            </div>
            <p class="text-xs text-forge-muted">${v.script ? `${v.script.items} itens` : 'roteiro pendente'} - ${v.durationSec ? v.durationSec.toFixed(0) + 's' : 'sem render'} - ${fmtDate(v.createdAt)}</p>
            <details class="text-xs">
              <summary class="cursor-pointer text-forge-accent font-semibold">Ver roteiro</summary>
              <div class="mt-2 max-h-40 overflow-y-auto space-y-1.5 pr-1" data-script="${v.id}">carregando...</div>
            </details>
            <div class="mt-auto pt-2 flex flex-wrap gap-2">
              <a href="api/videos/${v.id}/download" class="flex-1 px-3 py-2 rounded-lg bg-forge-accent text-black font-bold text-xs hover:brightness-110 transition text-center ${v.status !== 'rendered' ? 'pointer-events-none opacity-40' : ''}">Baixar</a>
              <button data-goto="baixar" class="px-3 py-2 rounded-lg border border-forge-accent/50 text-forge-accent text-xs font-bold hover:bg-forge-accent/10 transition" ${v.status !== 'rendered' ? 'disabled title="aguardando render"' : ''}>Revisar</button>
              <button data-render="${v.id}" class="px-3 py-2 rounded-lg border border-forge-border text-xs hover:border-forge-accent transition" title="Re-renderizar">Re-render</button>
              <button data-del-video="${v.id}" class="px-3 py-2 rounded-lg border border-red-500/40 text-red-400 text-xs hover:bg-red-500/10 transition">Excluir</button>
            </div>
          </div>
        </article>`).join('')}
    </div>` : '<p class="text-sm text-forge-muted">Nenhum video ainda. Va em Producao e clique em "Produzir".</p>'}`;

  $('#refreshVideos')?.addEventListener('click', () => renderVideos(el));

  // roteiro (lazy)
  $$('[data-script]', el).forEach(async (div) => {
    const id = div.dataset.script;
    try {
      const v = await api(`api/videos/${id}`);
      div.innerHTML = v.script ? `
        <p><b>Hook:</b> ${esc(v.script.hook)}</p>
        ${v.script.items.map((it, i) => `<p><b>${v.script.items.length - i}. ${esc(it.name)}:</b> ${esc(it.narration)}</p>`).join('')}
        <p><b>Encerramento:</b> ${esc(v.script.outro)}</p>` : '<p>Sem roteiro.</p>';
    } catch { div.innerHTML = '<p>erro ao carregar</p>'; }
  });

  $$('[data-render]', el).forEach((b) => b.addEventListener('click', async () => {
    try { await api(`api/videos/${b.dataset.render}/render`, { method: 'POST' }); toast('Render iniciado', 'success'); renderVideos(el); }
    catch (err) { toast(err.message, 'error'); }
  }));

  $$('[data-del-video]', el).forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Excluir video e midias?')) return;
    try { await api(`api/videos/${b.dataset.delVideo}`, { method: 'DELETE' }); renderVideos(el); }
    catch (err) { toast(err.message, 'error'); }
  }));
}

/* ============ BAIXAR & PUBLICAR ============ */
const PAYLOAD = {};
async function renderBaixar(el) {
  el.innerHTML = '<div class="text-forge-muted text-sm">Carregando...</div>';
  const videos = (await api('api/videos')).filter((v) => v.status === 'rendered');

  const metaRow = (label, value, what, vid, rows = 0) => `
    <div>
      <div class="flex items-center justify-between mb-1">
        <label class="text-xs font-semibold text-forge-muted">${label}</label>
        <button data-copy="${what}" data-v="${vid}" class="text-[11px] px-2 py-1 rounded border border-forge-border hover:border-forge-accent transition">Copiar</button>
      </div>
      ${rows
        ? `<textarea readonly rows="${rows}" class="w-full px-3 py-2 rounded-lg bg-forge-bg border border-forge-border text-xs resize-none">${esc(value)}</textarea>`
        : `<input readonly value="${esc(value)}" class="w-full px-3 py-2 rounded-lg bg-forge-bg border border-forge-border text-xs" />`}
    </div>`;

  el.innerHTML = `
    <div class="rounded-2xl border border-forge-border bg-forge-panel p-5 mb-5 text-sm text-forge-muted leading-relaxed">
      <span class="font-semibold text-zinc-300">Fluxo de revisao:</span> confira o video, baixe o MP4 e publique manualmente onde quiser (TikTok, Kwai, Instagram, Facebook, YouTube) ou cole no seu agendador (Postiz, Publer, Buffer...). Titulo, descricao e hashtags ja vao montados - use os botoes "Copiar".
    </div>
    ${videos.length ? videos.map((v) => {
      const tags = (v.hashtags || []).join(' ');
      const caption = [String(v.description || '').trim(), tags].filter(Boolean).join('\n\n');
      const full = `${v.title || ''}${caption ? `\n\n${caption}` : ''}`;
      PAYLOAD[v.id] = { title: v.title || '', caption, full };
      return `
      <article class="rounded-2xl border border-forge-border bg-forge-panel p-5 mb-5 grid lg:grid-cols-[230px_1fr] gap-6">
        <div>
          <video src="media/${v.id}/final.mp4" controls preload="metadata" poster="media/${v.id}/thumb.jpg" class="w-full rounded-xl max-h-80 bg-black"></video>
          <a href="api/videos/${v.id}/download" class="mt-3 block text-center px-3 py-2.5 rounded-xl bg-forge-accent text-black font-extrabold hover:brightness-110 transition">Baixar MP4</a>
          <p class="text-[11px] text-forge-muted mt-2 text-center">1080x1920, legendas queimadas, pronto para subir</p>
        </div>
        <div class="space-y-3">
          <div class="flex items-start justify-between gap-3">
            <h3 class="font-bold leading-snug">${esc(v.title)}</h3>
            <span class="text-xs text-forge-muted whitespace-nowrap">${v.durationSec ? v.durationSec.toFixed(0) + 's' : '--'}</span>
          </div>
          ${metaRow('TITULO (YouTube)', v.title || '', 'title', v.id)}
          ${metaRow('DESCRICAO', v.description || '', 'caption', v.id, 3)}
          ${metaRow('HASHTAGS', tags, 'caption', v.id)}
          <div class="flex flex-wrap gap-2 pt-1">
            <button data-copy="caption" data-v="${v.id}" class="px-4 py-2 rounded-lg bg-forge-accent/15 border border-forge-accent/40 text-forge-accent text-xs font-bold hover:bg-forge-accent/25 transition">Copiar legenda (TikTok / Kwai / Reels)</button>
            <button data-copy="full" data-v="${v.id}" class="px-4 py-2 rounded-lg border border-forge-border text-xs font-semibold hover:border-forge-accent transition">Copiar pacote completo</button>
          </div>
        </div>
      </article>`;
    }).join('') : `
    <div class="rounded-2xl border border-forge-border bg-forge-panel p-10 text-center">
      <p class="text-4xl mb-3">📥</p>
      <p class="font-semibold">Nenhum video pronto para revisao</p>
      <p class="text-sm text-forge-muted mt-1">Produza um video na aba Producao - quando o render terminar, ele aparece aqui com tudo montado.</p>
    </div>`}`;

  $$('[data-copy]', el).forEach((b) => b.addEventListener('click', () => {
    const p = PAYLOAD[b.dataset.v];
    if (!p) return;
    if (b.dataset.copy === 'title') copyText(p.title, 'Titulo copiado!');
    else if (b.dataset.copy === 'full') copyText(p.full, 'Pacote completo copiado!');
    else copyText(p.caption, 'Legenda copiada!');
  }));
}

/* ============ CONFIG ============ */
let SETTINGS = null;
async function renderConfig(el) {
  el.innerHTML = '<div class="text-forge-muted text-sm">Carregando...</div>';
  SETTINGS = await api('api/settings');
  const field = (label, name, val, ph = '', type = 'text') => `
    <div>
      <label class="block text-xs font-semibold mb-1">${label}</label>
      <input name="${name}" value="${esc(val)}" placeholder="${esc(ph)}" type="${type}"
        class="w-full px-3 py-2 rounded-lg bg-forge-bg border border-forge-border focus:border-forge-accent outline-none text-sm" />
    </div>`;
  const select = (label, name, val, opts) => `
    <div>
      <label class="block text-xs font-semibold mb-1">${label}</label>
      <select name="${name}" class="w-full px-3 py-2 rounded-lg bg-forge-bg border border-forge-border outline-none text-sm">
        ${opts.map(([v, l]) => `<option value="${v}" ${v === val ? 'selected' : ''}>${l}</option>`).join('')}
      </select>
    </div>`;

  el.innerHTML = `
    <form id="configForm" class="grid lg:grid-cols-2 gap-6">
      <div class="rounded-2xl border border-forge-border bg-forge-panel p-6 space-y-3">
        <h2 class="font-bold">IA - Roteirista (LLM)</h2>
        <p class="text-xs text-forge-muted -mt-2">Qualquer API compativel com OpenAI. No OpenRouter use modelos gratuitos com sufixo ":free" (veja a lista atual em openrouter.ai/models?q=free) e separe varios por virgula - o sistema cicla entre eles a cada geracao e cai para o proximo automaticamente se um bater limite ou falhar. Modelo pago Z.ai: base https://api.z.ai/api/paas/v4 com glm-4.6.</p>
        ${field('Base URL', 'llm_baseUrl', SETTINGS.llm.baseUrl, 'https://openrouter.ai/api/v1')}
        ${field('API Key', 'llm_apiKey', SETTINGS.llm.apiKey, 'sk-or-...')}
        ${field('Modelos (virgula para ciclar)', 'llm_model', SETTINGS.llm.model, 'modelo-a:free,modelo-b:free,modelo-c:free')}
      </div>

      <div class="rounded-2xl border border-forge-border bg-forge-panel p-6 space-y-3">
        <h2 class="font-bold">IA - Narracao (TTS)</h2>
        <p class="text-xs text-forge-muted -mt-2">Padrao: narracao nativa (msedge-tts) com vozes neurais Microsoft em pt-BR, vem embutida no servidor - nao precisa instalar nada. Alternativas: CLI edge-tts em Python (pipx install edge-tts) ou TTS compativel com OpenAI (tts-1, voice: alloy/nova...).</p>
        ${select('Provedor', 'tts_provider', SETTINGS.tts.provider, [['edge', 'Nativo (msedge-tts, sem Python)'], ['edge-tts', 'CLI edge-tts (Python)'], ['openai', 'OpenAI-compativel (pago)']])}
        <div id="ttsFields" class="space-y-3"></div>
      </div>

      <div class="rounded-2xl border border-forge-border bg-forge-panel p-6 space-y-3">
        <h2 class="font-bold">Midia do video (visual)</h2>
        <p class="text-xs text-forge-muted -mt-2">Modo IA (padrao): gera uma imagem exclusiva por parte do video - Pollinations e gratuito e nao precisa de chave. Se a IA falhar, cai automaticamente no banco licenciado (e, se este falhar, em um fundo estilizado). Modo banco: usa apenas Pixabay/Pexels. Z.ai CogView: cogview-3-flash e gratuito com uma API key Z.ai (mesma base do GLM).</p>
        ${select('Modo visual', 'media_mode', SETTINGS.media?.mode || 'ai', [['ai', 'IA generativa (recomendado)'], ['stock', 'Banco licenciado (Pixabay/Pexels)']])}
        ${select('Provedor de IA', 'media_aiProvider', SETTINGS.media?.aiProvider || 'pollinations', [['pollinations', 'Pollinations (gratuito, sem chave)'], ['zai', 'Z.ai CogView (precisa de API key)']])}
        <div class="grid grid-cols-2 gap-3">
          ${field('Modelo IA', 'media_aiModel', SETTINGS.media?.aiModel || '', 'vazio = automatico; cogview-3-flash (z.ai)')}
          ${field('Z.ai API Key', 'media_zaiKey', SETTINGS.media?.zaiKey || '', 'so para o provedor zai')}
        </div>
        ${field('Estilo visual (em ingles)', 'media_aiStyle', SETTINGS.media?.aiStyle || '', 'cinematic vertical photo, dramatic lighting, high detail')}
        <div class="pt-2 border-t border-forge-border space-y-3">
          <p class="text-xs font-semibold text-forge-muted">Banco licenciado (fallback do modo IA ou modo principal)</p>
          ${select('Provedor principal', 'stock_provider', SETTINGS.stock?.provider || 'pixabay', [['pixabay', 'Pixabay (recomendado)'], ['pexels', 'Pexels']])}
          ${field('Pixabay API Key', 'pixabay_apiKey', SETTINGS.pixabay?.apiKey || '', 'sua chave gratuita')}
          ${field('Pexels API Key (fallback, opcional)', 'pexels_apiKey', SETTINGS.pexels.apiKey, 'opcional')}
        </div>
      </div>

      <div class="rounded-2xl border border-forge-border bg-forge-panel p-6 space-y-3">
        <h2 class="font-bold">Piloto automatico</h2>
        <p class="text-xs text-forge-muted -mt-2">O worker roda no servidor em intervalos fixos e gera videos conforme a meta diaria - cada video pronto aparece na aba Baixar & Publicar para voce revisar. A publicacao e sempre manual (voce no controle).</p>
        <div class="grid grid-cols-2 gap-3">
          ${select('Status', 'worker_enabled', String(SETTINGS.worker.enabled), [['true', 'Ligado'], ['false', 'Desligado']])}
          ${field('Intervalo (min)', 'worker_intervalMin', SETTINGS.worker.intervalMin)}
          ${field('Meta de videos/dia', 'worker_dailyTarget', SETTINGS.worker.dailyTarget)}
        </div>
      </div>

      <div class="lg:col-span-2">
        <button class="px-8 py-3 rounded-xl bg-forge-accent text-black font-extrabold hover:brightness-110 transition">Salvar configuracoes</button>
      </div>
    </form>`;

  const ttsFields = $('#ttsFields', el);
  const drawTts = () => {
    const p = $('[name=tts_provider]', el).value;
    if (p === 'edge-tts') {
      ttsFields.innerHTML = field('Voz', 'tts_voice', SETTINGS.tts.voice, 'pt-BR-AntonioNeural');
    } else {
      ttsFields.innerHTML = field('Base URL', 'tts_baseUrl', SETTINGS.tts.baseUrl) + field('API Key', 'tts_apiKey', SETTINGS.tts.apiKey) + field('Modelo', 'tts_model', SETTINGS.tts.model) + field('Voz', 'tts_voice', SETTINGS.tts.voice, 'alloy');
    }
  };
  drawTts();
  $('[name=tts_provider]', el).addEventListener('change', drawTts);

  $('#configForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const v = (n) => f[n] ? f[n].value : undefined;
    const num = (n, d) => { const x = Number(v(n)); return Number.isFinite(x) && x > 0 ? x : d; };
    try {
      await api('api/settings', { method: 'PUT', body: {
        llm: { baseUrl: v('llm_baseUrl'), apiKey: v('llm_apiKey'), model: v('llm_model') },
        tts: { provider: v('tts_provider'), baseUrl: v('tts_baseUrl') || SETTINGS.tts.baseUrl, apiKey: v('tts_apiKey') || SETTINGS.tts.apiKey, model: v('tts_model') || SETTINGS.tts.model, voice: v('tts_voice') },
        pexels: { apiKey: v('pexels_apiKey') },
        pixabay: { apiKey: v('pixabay_apiKey') },
        stock: { provider: v('stock_provider') },
        media: { mode: v('media_mode'), aiProvider: v('media_aiProvider'), aiModel: v('media_aiModel'), aiStyle: v('media_aiStyle'), zaiKey: v('media_zaiKey') },
        worker: { enabled: v('worker_enabled') === 'true', intervalMin: num('worker_intervalMin', 5), dailyTarget: num('worker_dailyTarget', 3) },
      } });
      toast('Configuracoes salvas!', 'success');
      renderConfig(el);
    } catch (err) { toast(err.message, 'error'); }
  });
}

/* ============ LOGS ============ */
async function renderLogs(el) {
  el.innerHTML = '<div class="text-forge-muted text-sm">Carregando...</div>';
  const logs = await api('api/logs');
  const colors = { info: 'text-sky-300', warn: 'text-yellow-400', error: 'text-red-400', success: 'text-green-400' };
  el.innerHTML = `
    <div class="rounded-2xl border border-forge-border bg-forge-panel p-6">
      <h2 class="font-bold mb-4">Logs do sistema (${logs.length})</h2>
      <div class="space-y-1.5 font-mono text-xs max-h-[60vh] overflow-y-auto pr-2">
        ${logs.map((l) => `<div class="flex gap-2"><span class="text-forge-muted shrink-0">${fmtDate(l.ts)}</span><span class="${colors[l.level]} font-bold shrink-0 uppercase">${l.level}</span><span class="text-forge-accent shrink-0">[${esc(l.scope)}]</span><span class="text-zinc-300 break-all">${esc(l.message)}</span></div>`).join('') || '<p class="font-sans">Sem logs.</p>'}
      </div>
    </div>`;
}

/* ============ router ============ */
const RENDERERS = { painel: renderPainel, producao: renderProducao, videos: renderVideos, baixar: renderBaixar, config: renderConfig, logs: renderLogs };

function updateWorkerChip(st) {
  const chip = $('#statusWorker');
  if (!chip || !st) return;
  chip.innerHTML = `Worker: ${st.worker.enabled ? `<b class="text-green-400">ON</b> (${st.worker.intervalMin}min)` : '<b class="text-red-400">OFF</b>'}`;
}

async function switchTab(name) {
  $$('.tabbtn').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  $$('.tabpane').forEach((p) => p.classList.toggle('hidden', p.id !== `tab-${name}`));
  try { await RENDERERS[name]($(`#tab-${name}`)); }
  catch (err) { toast(`Erro ao carregar aba: ${err.message}`, 'error'); }
}
$$('.tabbtn').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));
document.addEventListener('click', (e) => {
  const goto = e.target.closest('[data-goto]');
  if (goto) switchTab(goto.dataset.goto);
});

$('#btnTick').addEventListener('click', async () => {
  $('#btnTick').textContent = 'Rodando...';
  try { await api('api/worker/tick', { method: 'POST' }); toast('Worker executado', 'success'); switchTab('painel'); }
  catch (err) { toast(err.message, 'error'); }
  $('#btnTick').textContent = 'Rodar agora';
});

// polling leve nas abas dinamicas
setInterval(() => {
  const active = $$('.tabbtn').find((b) => b.classList.contains('active'));
  if (active && ['painel', 'videos', 'baixar'].includes(active.dataset.tab)) switchTab(active.dataset.tab);
}, 30000);

switchTab('painel');
