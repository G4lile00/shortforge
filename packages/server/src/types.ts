export type VideoStatus =
  | 'queued'        // aguardando geracao de roteiro
  | 'scripted'      // roteiro pronto, sem render
  | 'rendering'
  | 'rendered'
  | 'failed';

export type PostStatus = 'scheduled' | 'publishing' | 'posted' | 'failed';
export type Platform = 'youtube' | 'tiktok';

export interface ScriptItem {
  name: string;
  narration: string;
  query: string; // termos para busca de midia no banco licenciado
}

export interface Script {
  title: string;
  description: string;
  hashtags: string[];
  hook: string;
  items: ScriptItem[];
  outro: string;
}

export interface Video {
  id: string;
  themeId: string;
  title: string;
  description: string;
  hashtags: string[];
  script: Script | null;
  status: VideoStatus;
  error: string | null;
  durationSec: number | null;
  file: string | null;      // nome do arquivo mp4 em media/<id>/
  thumb: string | null;
  audioFiles: string[];     // nomes dos mp3 por parte
  createdAt: string;
  renderedAt: string | null;
}

export interface Post {
  id: string;
  videoId: string;
  platform: Platform;
  scheduledAt: string; // ISO
  status: PostStatus;
  remoteId: string | null;
  remoteUrl: string | null;
  error: string | null;
  createdAt: string;
  postedAt: string | null;
}

export interface Theme {
  id: string;
  name: string;          // ex: "Top 10 iscas artificiais para tucunare"
  brief: string;         // instrucoes de estilo/nicho para o LLM
  itemCount: number;     // 10 => top 10
  hashtags: string[];
  active: boolean;
  createdAt: string;
}

export interface Settings {
  llm: {
    baseUrl: string;   // ex: https://openrouter.ai/api/v1
    apiKey: string;
    model: string;     // ex: deepseek/deepseek-chat-v3.1:free
  };
  tts: {
    provider: 'edge' | 'edge-tts' | 'openai';
    baseUrl: string;   // openai-compativel: .../v1
    apiKey: string;
    model: string;     // ex: tts-1
    voice: string;     // ex: pt-BR-AntonioNeural (edge) ou alloy (openai)
  };
  media: {
    mode: 'ai' | 'stock';          // origem do visual: IA generativa ou banco licenciado
    aiProvider: 'pollinations' | 'zai';
    aiModel: string;               // flux / turbo (pollinations) ou cogview-3-flash (z.ai)
    aiStyle: string;               // estilo visual (em ingles) anexado ao prompt
    zaiKey: string;                // API key da Z.ai (so para provider 'zai')
  };
  stock: { provider: 'pixabay' | 'pexels' };
  pixabay: { apiKey: string };
  pexels: { apiKey: string };
  youtube: {
    clientId: string;
    clientSecret: string;
    refreshToken: string;
    privacy: 'public' | 'unlisted' | 'private';
  };
  tiktok: {
    accessToken: string;
    privacy: 'PUBLIC_TO_EVERYONE' | 'MUTUAL_FOLLOW_FRIENDS' | 'SELF_ONLY';
  };
  worker: {
    enabled: boolean;
    intervalMin: number;
    dailyTarget: number;      // videos gerados por dia no piloto automatico
  };
}

export interface LogEntry {
  id: string;
  ts: string;
  level: 'info' | 'warn' | 'error' | 'success';
  scope: string;
  message: string;
}
