import { execFile } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import type { Script, Settings } from './types.js';
import { log } from './store.js';

const execFileAsync = promisify(execFile);

const SYSTEM_PROMPT = `Voce e um roteirista especialista em videos curtos virais de nicho (Shorts/TikTok) em portugues do Brasil.
Responda SEMPRE apenas com JSON valido, sem markdown, no formato:
{
  "title": "titulo curto e chamativo (max 80 chars)",
  "description": "descricao para o video (2-3 frases)",
  "hashtags": ["#tag1", "#tag2", ...5 a 8 tags],
  "hook": "frase de abertura curta (max 15 palavras) que prende a atencao",
  "items": [
    { "name": "nome do item", "narration": "1 a 2 frases curiosas sobre o item", "query": "descritor visual curto em INGLES do item, usado para buscar midia licenciada e/ou gerar imagem por IA (ex: glowing fishing lure underwater at night)" }
  ],
  "outro": "frase de encerramento chamando para seguir a conta (max 12 palavras)"
}`;

// contador global para distribuir as geracoes entre os modelos da lista
let modelCursor = 0;

export async function generateScript(settings: Settings, themeName: string, brief: string, itemCount: number, extraHashtags: string[]): Promise<Script> {
  const userPrompt = `Crie o roteiro de um video "${themeName}" no formato top ${itemCount}.
Contexto e estilo do canal: ${brief || 'conteudo interessante e curioso'}.
Os "items" devem ser exatamente ${itemCount}, ordenados do ${itemCount}º para o 1º (contagem regressiva), com narracao fluida para narracao em voz.
As hashtags devem incluir estas: ${extraHashtags.join(' ') || '(nenhuma fixa)'}`;

  // ciclo de modelos: campo aceita lista separada por virgula (rotação entre modelos gratuitos)
  const models = settings.llm.model.split(',').map((m) => m.trim()).filter(Boolean);
  if (models.length === 0) throw new Error('Nenhum modelo LLM configurado');
  modelCursor = (modelCursor + 1) % models.length;
  const order = [...models.slice(modelCursor), ...models.slice(0, modelCursor)];

  let lastErr: Error | null = null;
  for (const model of order) {
    try {
      const script = await tryModel(settings, model, userPrompt);
      log('info', 'llm', `roteiro gerado com ${model}`);
      return script;
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      log('warn', 'llm', `${model} falhou (${lastErr.message.slice(0, 150)}) - tentando proximo modelo`);
    }
  }
  throw lastErr ?? new Error('LLM indisponivel');
}

async function tryModel(settings: Settings, model: string, userPrompt: string): Promise<Script> {
  const res = await fetch(`${settings.llm.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.llm.apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.8,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`LLM HTTP ${res.status}: ${body.slice(0, 300)}`);
  }

  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  let content = data.choices?.[0]?.message?.content ?? '';
  // remove cercas de markdown se o modelo insistir
  content = content.replace(/```(?:json)?/g, '').trim();
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('LLM nao retornou JSON valido');
  const script = JSON.parse(content.slice(start, end + 1)) as Script;
  if (!Array.isArray(script.items) || script.items.length === 0) throw new Error('Roteiro sem itens');
  script.hashtags = (script.hashtags ?? []).slice(0, 10);
  return script;
}

export async function ttsToFile(settings: Settings, text: string, outFile: string): Promise<void> {
  if (settings.tts.provider === 'edge' || settings.tts.provider === 'edge-tts') {
    // ritmo opcional (ex '-10%' ou '+15%'); valor invalido e ignorado
    const rateRaw = (settings.tts as { rate?: string }).rate || '';
    const rate = /^[+-]?\d{1,3}%$/.test(rateRaw.trim()) ? rateRaw.trim() : '';
    if (settings.tts.provider === 'edge') {
      // narracao nativa via msedge-tts (npm, sem Python) - a conexao com o servico
      // da Microsoft as vezes cai no meio da sintese, entao tentamos ate 3x
      const { MsEdgeTTS, OUTPUT_FORMAT } = await import('msedge-tts');
      let lastErr: unknown;
      for (let attempt = 1; attempt <= 3; attempt++) {
        const tts = new MsEdgeTTS();
        try {
          await tts.setMetadata(settings.tts.voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
          const tmpDir = outFile + '.d';
          fs.rmSync(tmpDir, { recursive: true, force: true });
          fs.mkdirSync(tmpDir, { recursive: true });
          await tts.toFile(tmpDir, text, rate ? { rate } : undefined);
          const generated = path.join(tmpDir, 'audio.mp3');
          if (!fs.existsSync(generated)) throw new Error('msedge-tts nao gerou o audio');
          fs.renameSync(generated, outFile);
          fs.rmSync(tmpDir, { recursive: true, force: true });
          return;
        } catch (err) {
          lastErr = err;
          if (attempt < 3) await new Promise((r) => setTimeout(r, 3000 * attempt));
        } finally {
          tts.close();
        }
      }
      throw lastErr;
    }
    // CLI edge-tts (Python) - mantido como alternativa; cai para o nativo se o binario nao existir
    try {
      const args = ['--voice', settings.tts.voice, '--text', text, '--write-media', outFile];
      if (rate) args.push(`--rate=${rate}`);
      await execFileAsync('edge-tts', args, { timeout: 120000 });
      if (!fs.existsSync(outFile)) throw new Error('edge-tts nao gerou o arquivo de audio (instale com: pipx install edge-tts)');
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('ENOENT')) {
        log('warn', 'tts', 'CLI edge-tts nao encontrado - usando narracao nativa (msedge-tts). Mude o provedor para "Nativo" nas Configuracoes para sumir com este aviso.');
        const fallback: Settings = { ...settings, tts: { ...settings.tts, provider: 'edge' } };
        return ttsToFile(fallback, text, outFile);
      }
      throw err;
    }
  }
  const res = await fetch(`${settings.tts.baseUrl.replace(/\/$/, '')}/audio/speech`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.tts.apiKey}` },
    body: JSON.stringify({ model: settings.tts.model, voice: settings.tts.voice, input: text, response_format: 'mp3' }),
  });
  if (!res.ok) throw new Error(`TTS HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  fs.writeFileSync(outFile, Buffer.from(await res.arrayBuffer()));
}

export async function probeDuration(file: string): Promise<number> {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file,
  ]);
  return parseFloat(stdout.trim());
}

/** Divide a narracao em linhas de legenda (3-5 palavras) e gera arquivo .ass estilizado. */
export function buildAss(parts: { text: string; start: number; duration: number }[], outFile: string): void {
  const fmt = (s: number) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = (s % 60).toFixed(2).padStart(5, '0');
    return `${h}:${String(m).padStart(2, '0')}:${sec}`;
  };
  const lines: string[] = [];
  let idx = 0;
  for (const part of parts) {
    const words = part.text.split(/\s+/).filter(Boolean);
    const chunkSize = 4;
    const chunks: string[] = [];
    for (let i = 0; i < words.length; i += chunkSize) chunks.push(words.slice(i, i + chunkSize).join(' '));
    const per = part.duration / Math.max(chunks.length, 1);
    chunks.forEach((c, i) => {
      const start = part.start + i * per;
      lines.push(`Dialogue: 0,${fmt(start)},${fmt(Math.min(start + per, part.start + part.duration))},Padrao,,0,0,0,,${c.replace(/[{}]/g, '')}`);
      idx++;
    });
  }
  const ass = `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Padrao,DejaVu Sans,72,&H00FFFFFF,&H000000FF,&H00101010,&H80000000,-1,0,0,0,100,100,1,0,1,4,2,2,60,60,300,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${lines.join('\n')}
`;
  fs.writeFileSync(outFile, ass);
  void idx;
}

export async function runFfmpeg(args: string[], label: string): Promise<void> {
  try {
    await execFileAsync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { timeout: 30 * 60 * 1000, maxBuffer: 10 * 1024 * 1024 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log('error', 'ffmpeg', `${label}: ${msg.slice(0, 300)}`);
    throw new Error(`${label} falhou: ${msg.slice(0, 200)}`);
  }
}

export function tmpFile(ext: string): string {
  return path.join(os.tmpdir(), `sf-${Math.random().toString(36).slice(2)}${ext}`);
}
