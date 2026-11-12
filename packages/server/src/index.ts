import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { store, DEFAULT_SETTINGS, log, uid, MEDIA_DIR, WEB_DIR } from './store.js';
import type { Settings, Theme, Video } from './types.js';
import { workerTick, produceVideo } from './worker.js';
import { renderVideo } from './render.js';

const execFileAsync = promisify(execFile);
const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));

const PORT = Number(process.env.PORT || 3010);

// ---------- helpers ----------
function respond(res: express.Response, fn: () => unknown) {
  Promise.resolve()
    .then(fn)
    .then((data) => res.json(data ?? { ok: true }))
    .catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      log('error', 'api', msg);
      if (!res.headersSent) res.status(400).json({ error: msg });
    });
}

// ---------- status ----------
app.get('/api/status', (_req, res) => {
  respond(res, async () => {
    let ffmpeg = false;
    try { await execFileAsync('ffmpeg', ['-version']); ffmpeg = true; } catch { /* ausente */ }
    const settings = store.settings();
    return {
      ffmpeg,
      ttsBundled: true, // msedge-tts vem embutido no servidor (sem Python)
      worker: settings.worker,
      counts: {
        themes: store.themes().filter((t) => t.active).length,
        videos: store.videos().length,
        rendered: store.videos().filter((v) => v.status === 'rendered').length,
        producing: store.videos().filter((v) => v.status === 'queued' || v.status === 'scripted' || v.status === 'rendering').length,
      },
    };
  });
});

// ---------- settings ----------
app.get('/api/settings', (_req, res) => {
  const settings = store.settings();
  // mascara: nunca devolve segredos completos
  const masked = JSON.parse(JSON.stringify(settings)) as Settings;
  const mask = (v: string) => (v ? `${v.slice(0, 4)}...${v.slice(-4)}` : '');
  masked.llm.apiKey = mask(settings.llm.apiKey);
  masked.tts.apiKey = mask(settings.tts.apiKey);
  masked.pexels.apiKey = mask(settings.pexels.apiKey);
  masked.pixabay.apiKey = mask(settings.pixabay?.apiKey ?? '');
  masked.media = {
    ...settings.media,
    zaiKey: mask(settings.media?.zaiKey ?? ''),
  } as typeof masked.media;
  masked.youtube.clientSecret = mask(settings.youtube.clientSecret);
  masked.youtube.refreshToken = mask(settings.youtube.refreshToken);
  masked.tiktok.accessToken = mask(settings.tiktok.accessToken);
  res.json(masked);
});

app.put('/api/settings', (req, res) => {
  respond(res, () => {
    const current = store.settings();
    const inc = req.body as Partial<Settings>;
    // merge preservando segredos mascarados
    const merged: Settings = {
      ...current,
      ...inc,
      llm: { ...current.llm, ...inc.llm },
      tts: { ...current.tts, ...inc.tts },
      pexels: { ...current.pexels, ...inc.pexels },
      pixabay: { apiKey: inc.pixabay?.apiKey ?? '' },
      media: { ...current.media, ...inc.media },
      stock: { provider: inc.stock?.provider ?? current.stock?.provider ?? 'pixabay' },
      youtube: { ...current.youtube, ...inc.youtube },
      tiktok: { ...current.tiktok, ...inc.tiktok },
      worker: { ...current.worker, ...inc.worker },
    };
    const keep = (a: string, b?: string) => (b && b.includes('...') && !b.startsWith(b.slice(0, 4)) ? a : b ?? a);
    // se veio valor mascarado (contem "..."), mantem o atual
    const keepSecret = (cur: string, next: string) => (/^\S{4}\.\.\.\S{4}$/.test(next) ? cur : next);
    void keep;
    merged.llm.apiKey = keepSecret(current.llm.apiKey, merged.llm.apiKey);
    merged.tts.apiKey = keepSecret(current.tts.apiKey, merged.tts.apiKey);
    merged.pexels.apiKey = keepSecret(current.pexels.apiKey, merged.pexels.apiKey);
    merged.pixabay = merged.pixabay ?? { apiKey: '' };
    merged.pixabay.apiKey = keepSecret(current.pixabay?.apiKey ?? '', merged.pixabay.apiKey);
    merged.media = merged.media ?? {
      mode: 'ai', aiProvider: 'pollinations', aiModel: 'flux', aiStyle: '', zaiKey: '',
    };
    merged.media.zaiKey = keepSecret(current.media?.zaiKey ?? '', merged.media.zaiKey);
    merged.youtube.clientSecret = keepSecret(current.youtube.clientSecret, merged.youtube.clientSecret);
    merged.youtube.refreshToken = keepSecret(current.youtube.refreshToken, merged.youtube.refreshToken);
    merged.tiktok.accessToken = keepSecret(current.tiktok.accessToken, merged.tiktok.accessToken);
    store.saveSettings(merged);
    startWorker();
    log('info', 'settings', 'configuracoes atualizadas');
    return { ok: true };
  });
});

// ---------- themes ----------
app.get('/api/themes', (_req, res) => res.json(store.themes()));

app.post('/api/themes', (req, res) => {
  respond(res, () => {
    const { name, brief, itemCount, hashtags, active } = req.body as Partial<Theme>;
    if (!name) throw new Error('nome do tema obrigatorio');
    const theme: Theme = {
      id: uid(),
      name,
      brief: brief ?? '',
      itemCount: Number(itemCount) || 10,
      hashtags: Array.isArray(hashtags) ? hashtags : [],
      active: active ?? true,
      createdAt: new Date().toISOString(),
    };
    const themes = store.themes();
    themes.push(theme);
    store.saveThemes(themes);
    return theme;
  });
});

app.patch('/api/themes/:id', (req, res) => {
  respond(res, () => {
    const themes = store.themes();
    const t = themes.find((x) => x.id === req.params.id);
    if (!t) throw new Error('tema nao encontrado');
    Object.assign(t, req.body as Partial<Theme>, { id: t.id });
    store.saveThemes(themes);
    return t;
  });
});

app.delete('/api/themes/:id', (req, res) => {
  respond(res, () => {
    store.saveThemes(store.themes().filter((t) => t.id !== req.params.id));
    return { ok: true };
  });
});

// ---------- videos ----------
app.get('/api/videos', (_req, res) => {
  const videos = store.videos();
  res.json(videos.map((v) => ({ ...v, script: v.script ? { title: v.script.title, items: v.script.items.length } : null, audioFiles: [] })));
});

app.get('/api/videos/:id', (req, res) => {
  const video = store.videos().find((v) => v.id === req.params.id);
  if (!video) return res.status(404).json({ error: 'video nao encontrado' });
  return res.json(video);
});

app.post('/api/videos', (req, res) => {
  respond(res, async () => {
    const { themeId, count } = req.body as { themeId: string; count?: number };
    const theme = store.themes().find((t) => t.id === themeId);
    if (!theme) throw new Error('tema nao encontrado');
    const n = Math.min(Number(count) || 1, 5);
    // async: produz em background, UI acompanha via polling
    void (async () => {
      for (let i = 0; i < n; i++) {
        try { await produceVideo(theme); } catch { /* registrado no log */ }
      }
    })();
    return { ok: true, producing: n };
  });
});

app.post('/api/videos/:id/render', (req, res) => {
  respond(res, async () => {
    const video = store.videos().find((v) => v.id === req.params.id);
    if (!video || !video.script) throw new Error('video sem roteiro para renderizar');
    const videos = store.videos();
    const target = videos.find((v) => v.id === video.id)!;
    target.status = 'rendering';
    store.saveVideos(videos);
    void renderVideo(store.settings(), target)
      .then((rendered) => {
        const list = store.videos();
        const i = list.findIndex((v) => v.id === rendered.id);
        if (i >= 0) list[i] = rendered;
        store.saveVideos(list);
      })
      .catch((err) => {
        const list = store.videos();
        const i = list.findIndex((v) => v.id === target.id);
        if (i >= 0) { list[i].status = 'failed'; list[i].error = err.message; }
        store.saveVideos(list);
      });
    return { ok: true };
  });
});

app.delete('/api/videos/:id', (req, res) => {
  respond(res, () => {
    const id = req.params.id;
    store.saveVideos(store.videos().filter((v) => v.id !== id));
    store.savePosts(store.posts().filter((p) => p.videoId !== id));
    fs.rmSync(path.join(MEDIA_DIR, id), { recursive: true, force: true });
    return { ok: true };
  });
});

// download do MP4 renderizado (nome de arquivo amigavel baseado no titulo)
app.get('/api/videos/:id/download', (req, res) => {
  const video = store.videos().find((v) => v.id === req.params.id);
  if (!video || video.status !== 'rendered') return res.status(404).json({ error: 'video renderizado nao encontrado' });
  const file = path.join(MEDIA_DIR, video.id, video.file || 'final.mp4');
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'arquivo do video ausente' });
  const slug = video.title.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'shortforge';
  res.download(file, `${slug}.mp4`);
});

// ---------- worker ----------
app.post('/api/worker/tick', (_req, res) => {
  respond(res, async () => workerTick());
});

// ---------- logs ----------
app.get('/api/logs', (_req, res) => res.json(store.logs().slice(0, 100)));

// ---------- media estatica ----------
app.use('/media', express.static(MEDIA_DIR, { maxAge: '1h' }));

// ---------- front estatico ----------
// <base> configuravel para rodar sob sub-caminho (ex.: proxy /forge)
const BASE_PATH = process.env.BASE_PATH || '/';
function sendIndex(res: express.Response) {
  const html = fs.readFileSync(path.join(WEB_DIR, 'index.html'), 'utf-8')
    .replace('<!--BASE-->', `<base href="${BASE_PATH}">`);
  res.type('html').send(html);
}
app.use(express.static(WEB_DIR, { index: false }));
app.get(/^\/(?!api|media).*/, (_req, res) => sendIndex(res));

// ---------- worker interval ----------
let timer: NodeJS.Timeout | null = null;
function startWorker() {
  if (timer) clearInterval(timer);
  const settings = store.settings();
  const ms = Math.max(1, settings.worker.intervalMin) * 60 * 1000;
  timer = setInterval(() => void workerTick(), ms);
  log('info', 'worker', `ativo a cada ${settings.worker.intervalMin} min`);
}
startWorker();
void DEFAULT_SETTINGS;

app.listen(PORT, () => {
  log('info', 'server', `ShortForge no ar em http://localhost:${PORT}`);
});
