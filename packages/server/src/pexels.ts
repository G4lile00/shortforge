import fs from 'fs';
import path from 'path';
import { Settings } from './types.js';
import { log } from './store.js';

interface PexelsVideoFile {
  id: number;
  quality: string;
  file_type: string;
  width: number | null;
  height: number | null;
  link: string;
}
interface PexelsVideo {
  id: number;
  duration: number;
  video_files: PexelsVideoFile[];
}
interface PexelsPhoto {
  id: number;
  src: { portrait: string; large: string };
}

async function downloadTo(url: string, dest: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
}

/** Busca e baixa midia licenciada (Pexels) para a query. Retorna lista de arquivos locais (videos .mp4 ou fotos .jpg). */
export async function fetchStockMedia(settings: Settings, query: string, destDir: string, wanted: number): Promise<string[]> {
  const headers = { Authorization: settings.pexels.apiKey };
  const files: string[] = [];

  // 1) tenta videos na vertical
  try {
    const res = await fetch(`https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&orientation=portrait&per_page=10&size=medium`, { headers });
    if (res.ok) {
      const data = (await res.json()) as { videos: PexelsVideo[] };
      const candidates: { link: string; w: number; h: number; dur: number }[] = [];
      for (const v of data.videos ?? []) {
        const best = v.video_files
          .filter((f) => f.file_type === 'video/mp4' && (f.height ?? 0) >= 1080)
          .sort((a, b) => (a.width ?? 0) - (b.width ?? 0))[0];
        if (best) candidates.push({ link: best.link, w: best.width ?? 0, h: best.height ?? 0, dur: v.duration });
      }
      candidates.sort((a, b) => Math.abs(a.w - a.h) - Math.abs(b.w - b.h)); // mais verticais primeiro
      for (const c of candidates) {
        if (files.length >= wanted) break;
        const dest = path.join(destDir, `stock-${files.length}.mp4`);
        try {
          await downloadTo(c.link, dest);
          files.push(dest);
        } catch (e) {
          log('warn', 'pexels', `falha ao baixar clip: ${(e as Error).message}`);
        }
      }
    }
  } catch (e) {
    log('warn', 'pexels', `busca de videos falhou: ${(e as Error).message}`);
  }

  // 2) fallback: fotos verticais
  if (files.length === 0) {
    try {
      const res = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&orientation=portrait&per_page=${wanted}`, { headers });
      if (res.ok) {
        const data = (await res.json()) as { photos: PexelsPhoto[] };
        for (const [i, p] of (data.photos ?? []).entries()) {
          if (files.length >= wanted) break;
          const dest = path.join(destDir, `photo-${i}.jpg`);
          try {
            await downloadTo(p.src.portrait || p.src.large, dest);
            files.push(dest);
          } catch { /* tenta a proxima */ }
        }
      }
    } catch (e) {
      log('warn', 'pexels', `busca de fotos falhou: ${(e as Error).message}`);
    }
  }

  return files;
}
