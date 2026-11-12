import fs from 'fs';
import path from 'path';
import { mediaDir, log } from './store.js';
import type { Post, Settings, Video } from './types.js';

interface MediaInfo {
  filePath: string;
  size: number;
}

function mediaOf(video: Video): MediaInfo {
  if (!video.file) throw new Error('video nao renderizado');
  const filePath = path.join(mediaDir(video.id), video.file);
  return { filePath, size: fs.statSync(filePath).size };
}

function fullDescription(video: Video): string {
  const tags = video.hashtags.length ? `\n\n${video.hashtags.join(' ')}` : '';
  return `${video.description}${tags}`;
}

// ---------- YouTube ----------

async function youtubeAccessToken(settings: Settings): Promise<string> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: settings.youtube.clientId,
      client_secret: settings.youtube.clientSecret,
      refresh_token: settings.youtube.refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) throw new Error(`YouTube token HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

export async function publishYouTube(settings: Settings, video: Video, post: Post): Promise<{ remoteId: string; remoteUrl: string }> {
  const { filePath, size } = mediaOf(video);
  const token = await youtubeAccessToken(settings);

  const metadata = {
    snippet: {
      title: video.title.slice(0, 100),
      description: fullDescription(video).slice(0, 4900),
      tags: video.hashtags.map((h) => h.replace(/^#/, '')),
      categoryId: '22',
    },
    status: {
      privacyStatus: settings.youtube.privacy,
      selfDeclaredMadeForKids: false,
    },
  };

  // upload resumavel: inicia sessao
  const init = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Length': String(size),
      'X-Upload-Content-Type': 'video/mp4',
    },
    body: JSON.stringify(metadata),
  });
  if (!init.ok) throw new Error(`YouTube init HTTP ${init.status}: ${(await init.text()).slice(0, 200)}`);
  const uploadUrl = init.headers.get('location');
  if (!uploadUrl) throw new Error('YouTube nao retornou URL de upload');

  // envia o arquivo
  const buf = fs.readFileSync(filePath);
  const up = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Length': String(size), 'Content-Type': 'video/mp4' },
    body: buf,
  });
  if (!up.ok) throw new Error(`YouTube upload HTTP ${up.status}: ${(await up.text()).slice(0, 200)}`);
  const result = (await up.json()) as { id: string };
  return { remoteId: result.id, remoteUrl: `https://youtube.com/shorts/${result.id}` };
}

// ---------- TikTok ----------

export async function publishTikTok(settings: Settings, video: Video, post: Post): Promise<{ remoteId: string; remoteUrl: string }> {
  const { filePath, size } = mediaOf(video);
  const buf = fs.readFileSync(filePath);
  const chunkSize = Math.min(64 * 1024 * 1024, size);
  const totalChunks = Math.ceil(size / chunkSize);

  const init = await fetch('https://open.tiktokapis.com/v2/post/publish/video/init/', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${settings.tiktok.accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
    },
    body: JSON.stringify({
      post_info: {
        title: `${video.title} ${video.hashtags.slice(0, 4).join(' ')}`.slice(0, 2200),
        privacy_level: settings.tiktok.privacy,
        disable_duet: false,
        disable_comment: false,
        disable_stitch: false,
      },
      source_info: {
        source: 'FILE_UPLOAD',
        video_size: size,
        chunk_size: chunkSize,
        total_chunk_count: totalChunks,
      },
    }),
  });
  if (!init.ok) throw new Error(`TikTok init HTTP ${init.status}: ${(await init.text()).slice(0, 200)}`);
  const initData = (await init.json()) as {
    data: { publish_id: string; upload_url: string };
    error?: { code: string; message: string };
  };
  if (initData.error && initData.error.code !== 'ok') throw new Error(`TikTok: ${initData.error.message}`);
  const { publish_id: publishId, upload_url: uploadUrl } = initData.data;

  // envia chunks
  for (let i = 0; i < totalChunks; i++) {
    const start = i * chunkSize;
    const end = Math.min(start + chunkSize, size);
    const chunkRes = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Range': `bytes ${start}-${end - 1}/${size}`,
      },
      body: buf.subarray(start, end),
    });
    if (!chunkRes.ok) throw new Error(`TikTok chunk ${i} HTTP ${chunkRes.status}`);
  }

  return { remoteId: publishId, remoteUrl: 'https://www.tiktok.com/upload?lang=pt-BR&from=uploader' };
}

// ---------- dispatcher ----------

export async function publishNow(settings: Settings, video: Video, post: Post): Promise<{ remoteId: string; remoteUrl: string }> {
  if (post.platform === 'youtube') return publishYouTube(settings, video, post);
  return publishTikTok(settings, video, post);
}

export function checkPublishConfig(settings: Settings, platform: Post['platform']): string | null {
  if (platform === 'youtube') {
    const y = settings.youtube;
    if (!y.clientId || !y.clientSecret || !y.refreshToken) return 'Configure o YouTube (Client ID, Secret e Refresh Token) nas Configuracoes';
  } else {
    if (!settings.tiktok.accessToken) return 'Configure o Access Token do TikTok nas Configuracoes';
  }
  return null;
}

export { log };
