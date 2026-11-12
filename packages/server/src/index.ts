import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { store, DEFAULT_SETTINGS, log, uid, MEDIA_DIR, WEB_DIR } from './store.js';
import type { Settings, Theme, Post, Video } from './types.js';
import { workerTick, produceVideo } from './worker.js';
import { renderVideo } from './render.js';
import { publishNow, checkPublishConfig } from './publish.js';

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
    let ffmpeg = false, edgeTts = false;
    try { await execFileAsync('ffmpeg', ['-version']); ffmpeg = true; } catch { /* ausente */ }
    try { await execFileAsync('edge-tts', ['--list-voices']); edgeTts = true; } catch { /* ausente */ }
    const settings = store.settings();
    return {
      ffmpeg,
      edgeTts,
      worker: settings.worker,
      counts: {
        themes: store.themes().filter((t) => t.active).length,
        videos: store.videos().length,
        rendered: store.videos().filter((v) => v.status === 'rendered').length,
        scheduled: store.posts().filter((p) => p.status === 'scheduled').length,
        posted: store.posts().filter((p) => p.status === 'posted').length,
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

// ---------- posts ----------
app.get('/api/posts', (_req, res) => {
  const posts = store.posts();
  const videos = store.videos();
  res.json(posts.map((p) => ({
    ...p,
    videoTitle: videos.find((v) => v.id === p.videoId)?.title ?? '(video removido)',
    videoThumb: videos.find((v) => v.id === p.videoId)?.thumb ?? null,
  })));
});

app.post('/api/posts', (req, res) => {
  respond(res, () => {
    const { videoId, platform, scheduledAt } = req.body as { videoId: string; platform: Post['platform']; scheduledAt: string };
    const video = store.videos().find((v) => v.id === videoId);
    if (!video) throw new Error('video nao encontrado');
    if (video.status !== 'rendered') throw new Error('video precisa estar renderizado');
    const cfgErr = checkPublishConfig(store.settings(), platform);
    if (cfgErr) throw new Error(cfgErr);
    const post: Post = {
      id: uid(),
      videoId,
      platform,
      scheduledAt: scheduledAt || new Date().toISOString(),
      status: 'scheduled',
      remoteId: null,
      remoteUrl: null,
      error: null,
      createdAt: new Date().toISOString(),
      postedAt: null,
    };
    const posts = store.posts();
    posts.push(post);
    store.savePosts(posts);
    return post;
  });
});

app.post('/api/posts/:id/publish', (req, res) => {
  respond(res, async () => {
    const posts = store.posts();
    const post = posts.find((p) => p.id === req.params.id);
    if (!post) throw new Error('post nao encontrado');
    const video = store.videos().find((v) => v.id === post.videoId);
    if (!video) throw new Error('video nao encontrado');
    post.status = 'publishing';
    store.savePosts(posts);
    const result = await publishNow(store.settings(), video, post);
    post.status = 'posted';
    post.remoteId = result.remoteId;
    post.remoteUrl = result.remoteUrl;
    post.postedAt = new Date().toISOString();
    store.savePosts(posts);
    log('success', 'publish', `${post.platform}: ${video.title} publicado manualmente`);
    return result;
  });
});

app.delete('/api/posts/:id', (req, res) => {
  respond(res, () => {
    store.savePosts(store.posts().filter((p) => p.id !== req.params.id));
    return { ok: true };
  });
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
