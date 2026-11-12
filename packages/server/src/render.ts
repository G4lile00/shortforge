import fs from 'fs';
import path from 'path';
import { runFfmpeg, buildAss, ttsToFile, probeDuration } from './ai.js';
import { fetchStockMedia } from './pexels.js';
import { mediaDir, log } from './store.js';
import type { Settings, Video } from './types.js';

const CLIPS_PER_ITEM = 2;
const FPS = 30;

/**
 * Pipeline de render de um video vertical 1080x1920:
 * 1. TTS de cada parte (hook, itens, outro)
 * 2. Busca de midia licenciada (Pexels) por item
 * 3. Montagem FFmpeg: visual por parte -> concat -> audio -> legendas .ass
 */
export async function renderVideo(settings: Settings, video: Video): Promise<Video> {
  const script = video.script;
  if (!script) throw new Error('video sem roteiro');
  const dir = mediaDir(video.id);

  type Part = { text: string; queries: string[] };
  const parts: Part[] = [
    { text: script.hook, queries: [script.items[0]?.query ?? 'nature'] },
    ...script.items.map((it) => ({ text: it.narration, queries: [it.query, it.name] })),
    { text: script.outro, queries: [script.items[0]?.query ?? 'sunset'] },
  ];

  // 1) TTS por parte
  const audioFiles: string[] = [];
  const durations: number[] = [];
  for (const [i, part] of parts.entries()) {
    const audioPath = path.join(dir, `audio-${i}.mp3`);
    await ttsToFile(settings, part.text, audioPath);
    audioFiles.push(path.basename(audioPath));
    durations.push(await probeDuration(audioPath));
  }

  // 2) segmento visual por parte (sem audio, duracao = audio)
  const segmentFiles: string[] = [];
  for (const [i, part] of parts.entries()) {
    const dur = durations[i] + 0.15;
    const segFile = path.join(dir, `seg-${i}.mp4`);
    const clips = await fetchStockMedia(settings, part.queries[0], dir, CLIPS_PER_ITEM);
    const filterClips: string[] = [];
    const inputs: string[] = [];
    const usable: string[] = [];

    for (const clip of clips) {
      const isPhoto = clip.endsWith('.jpg');
      const idx = inputs.length;
      if (isPhoto) {
        // foto com efeito ken burns (zoom lento)
        filterClips.push(
          `[${idx}:v]scale=1080:1920:-1,zoompan=z='min(zoom+0.0012,1.25)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${Math.ceil(dur * FPS)}:s=1080x1920:fps=${FPS},setsar=1[v${idx}]`
        );
      } else {
        filterClips.push(
          `[${idx}:v]scale=-2:1920,crop=1080:1920,fps=${FPS},setsar=1[v${idx}]`
        );
      }
      inputs.push('-i', clip);
      usable.push(`[v${idx}]`);
    }

    if (usable.length === 0) {
      // sem midia: fundo gradiente estilizado com o texto da parte
      inputs.push('-f', 'lavfi', '-i', `color=c=0x1a1a2e:s=1080x1920:d=${dur}:r=${FPS}`);
      filterClips.push(`[0:v]setsar=1[bg0]`);
      usable.push('[bg0]');
    }

    // concatena os visuais e corta na duracao exata da parte
    let filter = filterClips.join(';');
    if (usable.length > 1) {
      filter += `;${usable.join('')}concat=n=${usable.length}:v=1:a=0[vcat];[vcat]trim=duration=${dur},setpts=PTS-STARTPTS[vout]`;
    } else {
      filter += `;${usable[0]}trim=duration=${dur},setpts=PTS-STARTPTS[vout]`;
    }
    // se os clips juntos durarem menos que a parte, loop
    filter = filter.replace('[vout]', '[vpre]');
    filter += `;[vpre]split[a][b];[b]reverse[r];[a][r]concat=n=2:v=1:a=0,trim=duration=${dur},setpts=PTS-STARTPTS[vout]`;

    await runFfmpeg([
      ...inputs,
      '-filter_complex', filter,
      '-map', '[vout]', '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
      '-pix_fmt', 'yuv420p', segFile,
    ], `segmento ${i}`);
    segmentFiles.push(segFile);
  }

  // 3) concatena segmentos visuais
  const visualOut = path.join(dir, 'visual.mp4');
  const concatList = path.join(dir, 'concat.txt');
  fs.writeFileSync(concatList, segmentFiles.map((f) => `file '${f}'`).join('\n'));
  await runFfmpeg(['-f', 'concat', '-safe', '0', '-i', concatList, '-c', 'copy', visualOut], 'concat visual');

  // 4) concatena audios
  const audioOut = path.join(dir, 'audio-full.mp3');
  fs.writeFileSync(path.join(dir, 'concat-audio.txt'), audioFiles.map((f) => `file '${path.join(dir, f)}'`).join('\n'));
  await runFfmpeg(['-f', 'concat', '-safe', '0', '-i', path.join(dir, 'concat-audio.txt'), '-c', 'copy', audioOut], 'concat audio');

  // 5) legendas .ass (timing acumulado por parte)
  const subParts: { text: string; start: number; duration: number }[] = [];
  let acc = 0;
  parts.forEach((p, i) => {
    subParts.push({ text: p.text, start: acc, duration: durations[i] });
    acc += durations[i] + 0.15;
  });
  const assFile = path.join(dir, 'subs.ass');
  buildAss(subParts, assFile);

  // 6) final: visual + audio + legendas
  const outFile = 'final.mp4';
  const outPath = path.join(dir, outFile);
  await runFfmpeg([
    '-i', visualOut,
    '-i', audioOut,
    '-vf', `ass=${assFile}`,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22',
    '-c:a', 'aac', '-b:a', '160k',
    '-shortest', '-movflags', '+faststart',
    outPath,
  ], 'final');

  // 7) thumbnail do primeiro segundo
  const thumbPath = path.join(dir, 'thumb.jpg');
  await runFfmpeg(['-ss', '1', '-i', outPath, '-frames:v', '1', '-q:v', '3', thumbPath], 'thumb');

  const durationSec = await probeDuration(outPath);
  log('success', 'render', `"${script.title}" renderizado (${durationSec.toFixed(1)}s)`);

  return {
    ...video,
    status: 'rendered',
    file: outFile,
    thumb: 'thumb.jpg',
    audioFiles,
    durationSec,
    renderedAt: new Date().toISOString(),
    error: null,
  };
}
