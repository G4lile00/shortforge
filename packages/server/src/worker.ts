import { store, log, uid } from './store.js';
import { generateScript } from './ai.js';
import { renderVideo } from './render.js';
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

/** Piloto automatico: gera videos conforme dailyTarget; publicacao e sempre manual (aba Baixar & Publicar). */
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
    log('success', 'worker', `"${video.title}" pronto para revisao na aba Baixar & Publicar`);
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
    await autoPilot();
  } finally {
    running = false;
  }
  return { processed };
}
