# ShortForge

Piloto autonomo de conteudo para **YouTube Shorts** e **TikTok**: gera roteiros com IA, narra com TTS, busca midia **licenciada** (Pexels), monta o video vertical 1080x1920 com legendas no FFmpeg e posta automaticamente.

Monorepo simples, sem dependencias nativas:

```
shortforge/
├── packages/
│   ├── server/   # backend TypeScript (Express + Node >= 20)
│   └── web/      # frontend estatico (HTML + Tailwind)
├── data/         # banco JSON (settings, temas, videos, posts, logs) - criado em runtime
└── media/        # videos, audios e thumbs - criado em runtime
```

## Requisitos no seu servidor

- **Node.js >= 20** (ou Bun) e npm
- **FFmpeg** no PATH: `sudo apt install ffmpeg`
- **edge-tts** (narracao gratuita): `pip install edge-tts`
- Uma **API key gratuita da Pixabay** (emitida na hora): https://pixabay.com/api/docs/ . Pexels (https://www.pexels.com/api/) e opcional como fallback
- Uma API de LLM (gratuita ou paga):
  - **Gratuita**: OpenRouter (modelos `:free`, ex. `deepseek/deepseek-chat-v3.1:free`) ou Groq (`llama-3.3-70b-versatile`)
  - **Paga (Z.ai GLM)**: Base URL `https://api.z.ai/api/paas/v4`, modelo `glm-4.6`

## Instalacao

```bash
npm install        # instala workspaces
npm run dev        # desenvolvimento (tsx watch) em http://localhost:3010
# ou em producao:
npm run start
```

O backend ja serve o frontend em `http://SEU-SERVIDOR:3010`. Para expor fora de casa, use um reverse proxy (Caddy/Nginx) com HTTPS.

## Fluxo

1. **Configuracoes**: informe LLM, TTS, Pexels, YouTube e TikTok.
2. **Producao**: crie temas (ex.: "Top 10 iscas artificiais") e clique em Produzir.
3. **Videos**: acompanhe o render, veja o roteiro, agende postagens.
4. **Fila**: o worker publica automaticamente na data/hora; ou clique em "Publicar agora".
5. **Piloto automatico**: com o worker ligado e meta diaria definida, o sistema gera e agenda sozinho.

## Credenciais de publicacao

### YouTube
1. Google Cloud Console -> novo projeto -> ativar **YouTube Data API v3**.
2. Credenciais -> OAuth Client ID (aplicativo desktop) -> copie Client ID e Secret.
3. Use o **OAuth 2.0 Playground** do Google com escopo `https://www.googleapis.com/auth/youtube.upload` para gerar o **Refresh Token**.
4. Videos Shorts: o YouTube detecta automaticamente videos verticais <= 60s como Shorts.

### TikTok
1. https://developers.tiktok.com -> app -> escopo `video.publish`.
2. Faca o fluxo OAuth e guarde o **Access Token**.
3. **Importante**: apps nao auditados postam apenas como `SELF_ONLY` (privado). Apos a auditoria do TikTok, mude a privacidade para `PUBLIC_TO_EVERYONE` na interface.

## Seguranca

- Segredos ficam em `data/settings.json` (local ao servidor). O GET `/api/settings` sempre devolve chaves mascaradas.
- Se for expor na internet, proteja o app com Basic Auth no reverse proxy ou VPN (ex.: Tailscale).

## Licenca de conteudo

Todo o material visual vem da Pixabay (licenca Pixabay: uso comercial permitido, sem atribuicao obrigatoria) e/ou Pexels. Nenhum conteudo de terceiros do YouTube/TikTok e baixado ou republicado.

## Sub-caminho (opcional)

Para servir a interface sob um sub-caminho (ex.: proxy reverso em `/forge`):

```bash
BASE_PATH=/forge/ npm start
```

Por padrao o app responde na raiz (`/`).

## Rotacao de modelos gratuitos (OpenRouter)

No campo **Modelos** das Configuracoes, informe varios modelos separados por virgula, ex.:

```
deepseek/deepseek-chat-v3.1:free,meta-llama/llama-3.3-70b-instruct:free,qwen/qwen-2.5-72b-instruct:free
```

A cada geracao o sistema comeca pelo proximo modelo da lista (round-robin) e, se um modelo falhar ou bater o limite de taxa, cai automaticamente para o seguinte. Confira sempre a lista atual de modelos gratuitos em https://openrouter.ai/models?q=free — o catalogo muda com frequencia.
