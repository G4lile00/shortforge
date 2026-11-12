import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { Settings, Video, Post, Theme, LogEntry } from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..', '..', '..');
export const DATA_DIR = path.join(ROOT, 'data');
export const MEDIA_DIR = path.join(ROOT, 'media');
export const WEB_DIR = path.join(ROOT, 'packages', 'web');

for (const dir of [DATA_DIR, MEDIA_DIR]) fs.mkdirSync(dir, { recursive: true });

function readJson<T>(file: string, fallback: T): T {
  const p = path.join(DATA_DIR, file);
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as T;
  } catch {
    return fallback;
  }
}

function writeJson(file: string, data: unknown) {
  const p = path.join(DATA_DIR, file);
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, p);
}

export const DEFAULT_SETTINGS: Settings = {
  llm: {
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKey: '',
    model: 'openrouter/free,google/gemma-4-31b-it:free,nvidia/nemotron-3.5-lightning:free,baidu/ernie-5.5-flash-preview:free',
  },
  tts: {
    provider: 'edge',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'gpt-4o-mini-tts',
    voice: 'pt-BR-AntonioNeural',
  },
  media: {
    mode: 'ai',
    aiProvider: 'pollinations',
    aiModel: '',
    aiStyle: 'cinematic vertical composition, dramatic lighting, rich colors, high detail, photorealistic, dark moody atmosphere',
    zaiKey: '',
  },
  stock: { provider: 'pixabay' },
  pixabay: { apiKey: '' },
  pexels: { apiKey: '' },
  youtube: { clientId: '', clientSecret: '', refreshToken: '', privacy: 'public' },
  tiktok: { accessToken: '', privacy: 'SELF_ONLY' },
  worker: {
    enabled: true,
    intervalMin: 5,
    dailyTarget: 3,
  },
};

export const store = {
  settings(): Settings {
    return { ...DEFAULT_SETTINGS, ...readJson('settings.json', {}) as Partial<Settings> } as Settings;
  },
  saveSettings(s: Settings) {
    writeJson('settings.json', s);
  },
  themes(): Theme[] {
    return readJson<Theme[]>('themes.json', []);
  },
  saveThemes(list: Theme[]) {
    writeJson('themes.json', list);
  },
  videos(): Video[] {
    return readJson<Video[]>('videos.json', []);
  },
  saveVideos(list: Video[]) {
    writeJson('videos.json', list);
  },
  posts(): Post[] {
    return readJson<Post[]>('posts.json', []);
  },
  savePosts(list: Post[]) {
    writeJson('posts.json', list);
  },
  logs(): LogEntry[] {
    return readJson<LogEntry[]>('logs.json', []);
  },
};

export function log(level: LogEntry['level'], scope: string, message: string) {
  const entries = store.logs();
  entries.unshift({
    id: Math.random().toString(36).slice(2),
    ts: new Date().toISOString(),
    level,
    scope,
    message: message.slice(0, 500),
  });
  writeJson('logs.json', entries.slice(0, 300));
  console.log(`[${level}] ${scope}: ${message}`);
}

export function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function mediaDir(videoId: string): string {
  const dir = path.join(MEDIA_DIR, videoId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
