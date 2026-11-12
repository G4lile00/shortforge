import { store, log, uid } from './store.js';
import { generateScript } from './ai.js';
import { renderVideo } from './render.js';
import { publishNow, checkPublishConfig } from './publish.js';
import type { Theme, Video } from './types.js';

/** Gera roteiro + render de 1 video a partir de um tema. */
export async function produceVideo(theme: Theme): Promise<Video> {
  const settings = store.settings();
  const videos = store.videos();
  const video: Video = {
    id: uid(),
    themeId: theme.id,
    title: theme.name,
    description: '',
    hashtags: theme.hashtags,
    script: null,
    status: 'queued',
    error: null,
    durationSec: null,
    file: null,
    thumb: null,
    audioFiles: [],
    createdAt: new Date().toISOString(),
    renderedAt: null,
  };
  videos.unshift(video);
  store.saveVideos(videos);

  try {
    log('info', 'pipeline', `gerando roteiro: ${theme.name}`);
    const script = await generateScript(settings, theme.name, theme.brief, theme.itemCount, theme.hashtags);
    video.script = script;
    video.title = script.title;
    video.description = script.description;
    video.hashtags = script.hashtags.length ? script.hashtags : theme.hashtags;
    video.status = 'rendering';
    save(video);
    log('success', 'pipeline', `roteiro pronto: ${script.title}`);

    const rendered = await renderVideo(settings, video);
    save(rendered);
    return rendered;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    video.status = 'failed';
    video.error = msg;
    save(video);
    log('error', 'pipeline', msg);
    throw err;
  }
}

function save(v: Video) {
  const videos = store.videos();
  const i = videos.findIndex((x) => x.id === v.id);
  if (i >= 0) videos[i] = v;
  store.saveVideos(videos);
}

/** Processa postagens agendadas vencidas. */
async function processDuePosts(): Promise<void> {
  const settings = store.settings();
  const now = Date.now();
  const posts = store.posts();
  const due = posts.filter((p) => p.status === 'scheduled' && new Date(p.scheduledAt).getTime() <= now);
  for (const post of due) {
    post.status = 'publishing';
    store.savePosts(posts);
    const video = store.videos().find((v) => v.id === post.videoId);
    try {
      if (!video || video.status !== 'rendered') throw new Error('video ainda nao renderizado');
      const cfgErr = checkPublishConfig(settings, post.platform);
      if (cfgErr) throw new Error(cfgErr);
      const res = await publishNow(settings, video, post);
      post.status = 'posted';
      post.remoteId = res.remoteId;
      post.remoteUrl = res.remoteUrl;
      post.postedAt = new Date().toISOString();
      log('success', 'publish', `${post.platform}: ${video.title} publicado`);
    } catch (err) {
      post.status = 'failed';
      post.error = err instanceof Error ? err.message : String(err);
      log('error', 'publish', `${post.platform}: ${post.error}`);
    }
    store.savePosts(posts);
  }
}

/** Piloto automatico: gera videos conforme dailyTarget e agenda postagens nos horarios. */
async function autoPilot(): Promise<void> {
  const settings = store.settings();
  if (!settings.worker.enabled || settings.worker.dailyTarget <= 0) return;

  const videos = store.videos();
  const dayAgo = Date.now() - 24 * 3600 * 1000;
  const producedToday = videos.filter((v) => new Date(v.createdAt).getTime() > dayAgo && v.status !== 'failed').length;
  const themes = store.themes().filter((t) => t.active);
  if (themes.length === 0) return;
  if (producedToday >= settings.worker.dailyTarget) return;

  // evita sobrepor um video ja em producao
  const busy = videos.some((v) => v.status === 'queued' || v.status === 'rendering');
  if (busy) return;

  const theme = themes[producedToday % themes.length];
  try {
    const video = await produceVideo(theme);
    // agenda postagens nos proximos horarios configurados
    const now = new Date();
    const hours = settings.worker.scheduleHours.split(',').map((h) => h.trim()).filter(Boolean);
    for (const platform of ['youtube', 'tiktok'] as const) {
      const posts = store.posts();
      let when: Date | null = null;
      for (const h of hours) {
        const [hh, mm] = h.split(':').map(Number);
        const candidate = new Date(now);
        candidate.setHours(hh, mm, 0, 0);
        if (candidate.getTime() > now.getTime() + 60 * 1000) { when = candidate; break; }
      }
      if (!when) when = new Date(now.getTime() + 3600 * 1000);
      posts.push({
        id: uid(),
        videoId: video.id,
        platform,
        scheduledAt: when.toISOString(),
        status: 'scheduled',
        remoteId: null,
        remoteUrl: null,
        error: null,
        createdAt: new Date().toISOString(),
        postedAt: null,
      });
      store.savePosts(posts);
      log('info', 'worker', `${platform} agendado para ${when.toLocaleString('pt-BR')}`);
    }
  } catch {
    /* erro ja registrado */
  }
}

let running = false;
export async function workerTick(): Promise<{ processed: number }> {
  if (running) return { processed: 0 };
  running = true;
  let processed = 0;
  try {
    await processDuePosts();
    await autoPilot();
  } finally {
    running = false;
  }
  return { processed };
}
