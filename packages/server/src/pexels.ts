import fs from 'fs';
import path from 'path';
import { Settings } from './types.js';
import { log } from './store.js';

interface Candidate {
  url: string;
  isPhoto: boolean;
  // peso: menor = melhor (mais vertical / maior qualidade util)
  score: number;
}

async function downloadTo(url: string, dest: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
}

// ---------- Pixabay ----------

interface PixabayVideo {
  duration: number;
  videos: Record<string, { url: string; width: number; height: number; size: number }>;
}

async function pixabayCandidates(apiKey: string, query: string): Promise<Candidate[]> {
  const out: Candidate[] = [];
  // videos (https://pixabay.com/api/videos/)
  try {
    const res = await fetch(`https://pixabay.com/api/videos/?key=${encodeURIComponent(apiKey)}&q=${encodeURIComponent(query)}&per_page=15&safesearch=true`);
    if (res.ok) {
      const data = (await res.json()) as { hits: PixabayVideo[] };
      for (const hit of data.hits ?? []) {
        // prefere resolucoes medias (1080-ish) para nao pesar o download
        const pick = hit.videos?.large?.width >= 1080 ? hit.videos.large : (hit.videos.medium || hit.videos.large);
        if (pick?.url) out.push({ url: pick.url, isPhoto: false, score: Math.abs(pick.width - pick.height) });
      }
    } else {
      log('warn', 'pixabay', `videos HTTP ${res.status}: ${(await res.text()).slice(0, 150)}`);
    }
  } catch (e) {
    log('warn', 'pixabay', `busca de videos falhou: ${(e as Error).message}`);
  }
  // fotos (https://pixabay.com/api/)
  if (out.length === 0) {
    try {
      const res = await fetch(`https://pixabay.com/api/?key=${encodeURIComponent(apiKey)}&q=${encodeURIComponent(query)}&image_type=photo&orientation=vertical&per_page=15&safesearch=true`);
      if (res.ok) {
        const data = (await res.json()) as { hits: { largeImageURL: string; webformatURL: string }[] };
        for (const hit of data.hits ?? []) {
          if (hit.largeImageURL) out.push({ url: hit.largeImageURL, isPhoto: true, score: 9999 });
        }
      } else {
        log('warn', 'pixabay', `fotos HTTP ${res.status}: ${(await res.text()).slice(0, 150)}`);
      }
    } catch (e) {
      log('warn', 'pixabay', `busca de fotos falhou: ${(e as Error).message}`);
    }
  }
  return out;
}

// ---------- Pexels ----------

interface PexelsVideoFile {
  file_type: string;
  width: number | null;
  height: number | null;
  link: string;
}

async function pexelsCandidates(apiKey: string, query: string): Promise<Candidate[]> {
  const headers = { Authorization: apiKey };
  const out: Candidate[] = [];
  try {
    const res = await fetch(`https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&orientation=portrait&per_page=10&size=medium`, { headers });
    if (res.ok) {
      const data = (await res.json()) as { videos: { video_files: PexelsVideoFile[] }[] };
      for (const v of data.videos ?? []) {
        const best = v.video_files
          .filter((f) => f.file_type === 'video/mp4' && (f.height ?? 0) >= 1080)
          .sort((a, b) => (a.width ?? 0) - (b.width ?? 0))[0];
        if (best) out.push({ url: best.link, isPhoto: false, score: Math.abs((best.width ?? 0) - (best.height ?? 0)) });
      }
    } else {
      log('warn', 'pexels', `videos HTTP ${res.status}`);
    }
  } catch (e) {
    log('warn', 'pexels', `busca de videos falhou: ${(e as Error).message}`);
  }
  if (out.length === 0) {
    try {
      const res = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&orientation=portrait&per_page=10`, { headers });
      if (res.ok) {
        const data = (await res.json()) as { photos: { src: { portrait: string; large: string } }[] };
        for (const p of data.photos ?? []) {
          if (p.src?.portrait) out.push({ url: p.src.portrait || p.src.large, isPhoto: true, score: 9999 });
        }
      } else {
        log('warn', 'pexels', `fotos HTTP ${res.status}`);
      }
    } catch (e) {
      log('warn', 'pexels', `busca de fotos falhou: ${(e as Error).message}`);
    }
  }
  return out;
}

/**
 * Busca e baixa midia licenciada (Pixabay ou Pexels) para a query.
 * Usa o provedor configurado e faz fallback automatico para o outro se estiver configurado.
 * Retorna lista de arquivos locais (videos .mp4 ou fotos .jpg).
 */
export async function fetchStockMedia(settings: Settings, query: string, destDir: string, wanted: number): Promise<string[]> {
  const order: ('pixabay' | 'pexels')[] = settings.stock?.provider === 'pexels' ? ['pexels', 'pixabay'] : ['pixabay', 'pexels'];
  const keys: Record<string, string> = {
    pixabay: settings.pixabay?.apiKey ?? '',
    pexels: settings.pexels?.apiKey ?? '',
  };

  let candidates: Candidate[] = [];
  for (const provider of order) {
    if (candidates.length > 0 || !keys[provider]) continue;
    candidates = provider === 'pixabay'
      ? await pixabayCandidates(keys[provider], query)
      : await pexelsCandidates(keys[provider], query);
    if (candidates.length === 0) log('warn', 'stock', `${provider}: nenhum resultado para "${query}"`);
  }

  candidates.sort((a, b) => a.score - b.score);
  const files: string[] = [];
  for (const [i, c] of candidates.entries()) {
    if (files.length >= wanted) break;
    const ext = c.isPhoto ? '.jpg' : '.mp4';
    const dest = path.join(destDir, `stock-${files.length}${ext}`);
    try {
      await downloadTo(c.url, dest);
      files.push(dest);
    } catch (e) {
      log('warn', 'stock', `falha ao baixar midia ${i}: ${(e as Error).message}`);
    }
  }
  return files;
}
