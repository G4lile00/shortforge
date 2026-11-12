# ShortForge

Piloto autonomo de conteudo para **Shorts/TikTok/Kwai/Reels**: gera roteiros com IA, narra com TTS, cria o visual com **imagens geradas por IA** (ou banco licenciado, se preferir), monta o video vertical 1080x1920 com legendas no FFmpeg e deixa **titulo, descricao e hashtags montados para voce revisar, baixar e publicar onde quiser**.

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
- *(opcional)* CLI edge-tts em Python como alternativa de narracao: `pipx install edge-tts` (a narracao padrao, msedge-tts, ja vem embutida no servidor)
- **Voz da narracao**: escolha na aba Configuracoes. Vozes disponiveis no servico gratuito da Microsoft: **Thalita** (pt-BR, feminina, a mais natural — padrao), Antonio e Francisca (pt-BR) e as multilingual Andrew, Ava, Brian e Emma (falam portugues com mais naturalidade). Tambem da para ajustar o ritmo da fala (-15% a +25%) ou digitar qualquer outro ShortName da lista da Microsoft (ex: `pt-PT-DuarteNeural`) no campo de voz personalizada
- **Visual do video**: por padrao as imagens sao geradas por IA via **Pollinations** (gratuito, sem chave e sem cadastro). Opcional: **Z.ai** com modelo `cogview-3-flash` (gratuito com a API key) — a mesma key da Z.ai/GLM serve. Como fallback automatico, use uma **API key gratuita da Pixabay** (https://pixabay.com/api/docs/) e/ou Pexels (https://www.pexels.com/api/)
- Uma API de LLM (gratuita ou paga):
  - **Gratuita**: OpenRouter (modelos `:free`) ou Groq (`llama-3.3-70b-versatile`)
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

1. **Configuracoes**: informe LLM, TTS e a origem do visual (IA generativa ou banco licenciado).
2. **Producao**: crie temas (ex.: "Top 10 iscas artificiais") e clique em Produzir.
3. **Videos**: acompanhe o render, veja o roteiro, re-renderize se quiser.
4. **Baixar & Publicar**: revise o video, baixe o MP4 (1080x1920) e copie o titulo, a descricao e as hashtags ja montados. Publique manualmente no TikTok, Kwai, Instagram, Facebook, YouTube — ou cole em um agendador (Postiz, Publer, Buffer...).
5. **Piloto automatico**: com o worker ligado e a meta diaria definida, o sistema gera os videos sozinho; a publicacao e sempre manual (voce no controle).

> A API do Kwai nao permite postagem organica por terceiros, por isso o upload nessa rede e manual — o MP4 baixado ja esta pronto para o app.

## Publicacao manual (sem credenciais de API)

Nenhuma credencial de YouTube/TikTok e mais necessaria: o app nao publica sozinho. Cada video pronto traz:

- **Baixar MP4** — arquivo final com legendas queimadas, nome de arquivo amigavel;
- **Titulo** — pronto para o campo de titulo do YouTube;
- **Descricao** + **Hashtags** — prontas para TikTok, Kwai, Reels, Facebook;
- **Copiar legenda** / **Copiar pacote completo** — um clique para levar tudo para a plataforma ou para o seu agendador (Postiz self-hosted, Publer, Buffer...).

## Seguranca

- Segredos ficam em `data/settings.json` (local ao servidor). O GET `/api/settings` sempre devolve chaves mascaradas.
- Se for expor na internet, proteja o app com Basic Auth no reverse proxy ou VPN (ex.: Tailscale).

## Licenca de conteudo

O visual vem de imagens geradas por IA (criacao exclusiva, sem material de terceiros) e/ou bancos licenciados (Pixabay: uso comercial permitido, sem atribuicao obrigatoria; Pexels). Nenhum conteudo de terceiros do YouTube/TikTok e baixado ou republicado.

## Sub-caminho (opcional)

Para servir a interface sob um sub-caminho (ex.: proxy reverso em `/forge`):

```bash
BASE_PATH=/forge/ npm start
```

Por padrao o app responde na raiz (`/`).

## Rotacao de modelos gratuitos (OpenRouter)

No campo **Modelos** das Configuracoes, informe varios modelos separados por virgula, ex.:

```
openrouter/free,google/gemma-4-31b-it:free,nvidia/nemotron-3.5-lightning:free,baidu/ernie-5.5-flash-preview:free
```

Dica: o slug especial `openrouter/free` roteia automaticamente entre os gratuitos disponiveis no momento. Para ver a lista atualizada, consulte a API publica:

```bash
curl -s https://openrouter.ai/api/v1/models | python3 -c "import json,sys; [print(m['id']) for m in json.load(sys.stdin)['data'] if float(m['pricing']['prompt'])==0 and float(m['pricing']['completion'])==0]"
```

O catalogo gratuito muda com frequencia (modelos saem do ar) - por isso o sistema cicla e faz fallback: se um slug sumir (erro 404) ou bater limite, o proximo da lista assume.

A cada geracao o sistema comeca pelo proximo modelo da lista (round-robin) e, se um modelo falhar ou bater o limite de taxa, cai automaticamente para o seguinte. Confira sempre a lista atual de modelos gratuitos em https://openrouter.ai/models?q=free — o catalogo muda com frequencia.
