import fs from 'fs';
import path from 'path';
import type { Settings } from './types.js';
import { log } from './store.js';

/**
 * Visual gerado por IA para o video.
 * Provedores: Pollinations (gratuito, sem chave) e Z.ai CogView (usa API key).
 * Toda imagem sai vertical (proporcao 9:16) e recebe seed aleatoria para variar a cena.
 */

const TIMEOUT_MS = 180000;
const RETRY_DELAYS_MS = [0, 8000, 25000, 60000]; // 402/429 = limite de ritmo do tier gratuito: espera e tenta de novo
const IMAGE_SPACING_MS = 10000; // pausa entre imagens para respeitar a cota anonima

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isImage(buf: Buffer): boolean {
  if (buf.length < 12) return false;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true; // JPEG
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return true; // PNG
  return buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP';
}

async function fetchTimeout(url: string, opts: RequestInit, ms: number): Promise<Response> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ac.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function pollinationsImage(model: string, prompt: string, dest: string): Promise<void> {
  const seed = Math.floor(Math.random() * 1e9);
  const params = new URLSearchParams({ width: '1080', height: '1920', nologo: 'true', seed: String(seed), referrer: 'shortforge' });
  if (model) params.set('model', model);
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?${params}`;
  let lastErr = 'desconhecido';
  for (const delay of RETRY_DELAYS_MS) {
    if (delay) await sleep(delay);
    try {
      const res = await fetchTimeout(url, {}, TIMEOUT_MS);
      if (res.status === 402 || res.status === 429) {
        lastErr = `pollinations HTTP ${res.status} (limite de ritmo do tier gratuito)`;
        continue;
      }
      if (!res.ok) throw new Error(`pollinations HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (!isImage(buf)) throw new Error('pollinations devolveu conteudo que nao e imagem');
      fs.writeFileSync(dest, buf);
      return;
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
    }
  }
  throw new Error(lastErr);
}

async function zaiImage(settings: Settings, prompt: string, dest: string): Promise<void> {
  const base = 'https://api.z.ai/api/paas/v4';
  const res = await fetchTimeout(`${base}/images/generations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.media.zaiKey}` },
    body: JSON.stringify({
      model: settings.media.aiModel || 'cogview-3-flash',
      prompt,
      size: '1080x1920',
      response_format: 'url',
    }),
  }, TIMEOUT_MS);
  if (!res.ok) throw new Error(`z.ai HTTP ${res.status}: ${(await res.text()).slice(0, 150)}`);
  const data = (await res.json()) as { data?: { url?: string; b64_json?: string }[] };
  const item = data.data?.[0];
  if (item?.b64_json) {
    fs.writeFileSync(dest, Buffer.from(item.b64_json, 'base64'));
    return;
  }
  if (item?.url) {
    const img = await fetchTimeout(item.url, {}, TIMEOUT_MS);
    if (!img.ok) throw new Error(`z.ai download HTTP ${img.status}`);
    const buf = Buffer.from(await img.arrayBuffer());
    if (!isImage(buf)) throw new Error('z.ai devolveu arquivo que nao e imagem');
    fs.writeFileSync(dest, buf);
    return;
  }
  throw new Error('z.ai respondeu sem imagem');
}

/**
 * Gera `wanted` imagens IA verticais para o assunto informado.
 * O prompt final = assunto (descritor visual do roteiro) + estilo global configurado.
 */
export async function fetchAiMedia(settings: Settings, subject: string, destDir: string, wanted: number): Promise<string[]> {
  const cfg = settings.media;
  const prompt = [subject.trim(), (cfg.aiStyle || '').trim()].filter(Boolean).join('. ');
  const files: string[] = [];
  for (let i = 0; i < wanted; i++) {
    if (i > 0) await sleep(IMAGE_SPACING_MS);
    const dest = path.join(destDir, `ai-${i}-${Math.random().toString(36).slice(2, 7)}.jpg`);
    try {
      if (cfg.aiProvider === 'zai') await zaiImage(settings, prompt, dest);
      else await pollinationsImage(cfg.aiModel || '', prompt, dest);
      files.push(dest);
      log('info', 'ia-imagem', `imagem ${files.length}/${wanted} gerada para "${subject.slice(0, 60)}"`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log('warn', 'ia-imagem', `falhou para "${subject.slice(0, 50)}": ${msg}`);
    }
  }
  return files;
}
