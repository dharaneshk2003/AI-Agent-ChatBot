# AI Chat Agent with Tools

I built this as a local chat app where the assistant can answer normally or call a few small tools when it needs outside information. It runs with Next.js 15, Clerk authentication, Convex storage, and a free Gemini API key.

## What I used

- **Next.js 15.5.29** with the App Router and Turbopack dev server
- **React 19.0.9** and **TypeScript**
- **Gemini 3.5 Flash-Lite** through a free Google AI Studio key
- **LangChain / LangGraph** for the agent loop and tool calling
- **Clerk v7** for sign-in on the home page
- **Convex** for chat and message persistence
- **Tailwind CSS** and **Lucide React** for the UI
- Local, key-free tools:
  - Wikipedia search
  - Wikipedia article lookup
  - Google Books search

## Why I chose this setup

I wanted the project to run without paid API keys. Gemini's free tier handles the chat, and the tools use public APIs that do not need an account. The UI only shows the final answer — tool calls run quietly in the background.

A few details I handled along the way:

- The chat stream runs on the **Node.js runtime** at `/api/chat/stream`.
- Gemini's free tier sometimes appends a raw `503` JSON payload after valid SSE events, so the fetch wrapper retries and normalizes the stream before LangChain reads it.
- Conversation history is capped at 20 messages so Gemini's `contents` field is never empty.
- Tool rounds are capped at four, and the final round removes tools so the model always produces an answer.
- Public APIs can rate-limit; tools retry briefly and then return a graceful message instead of making the model loop.

## Getting started

### 1. Install dependencies

```bash
npm install
```

`pnpm install` works too.

### 2. Create your environment file

```bash
cp .env.example .env.local
```

On Windows PowerShell:

```powershell
Copy-Item .env.example .env.local
```

Then fill in these values in `.env.local`:

```env
GOOGLE_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemini-3.5-flash-lite

NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=your_clerk_publishable_key
CLERK_SECRET_KEY=your_clerk_secret_key
CLERK_ISSUER_URL=https://your-frontend-api.clerk.accounts.dev
```

- Create the Gemini key at <https://aistudio.google.com/apikey>.
- Create the Clerk keys at <https://dashboard.clerk.com>.
- `GOOGLE_API_KEY` is the only AI key the app needs.

### 3. Start Convex

```bash
npx convex dev
```

This writes `CONVEX_DEPLOYMENT` and `NEXT_PUBLIC_CONVEX_URL` into `.env.local`. Set the same Clerk issuer URL on the Convex backend:

```bash
npx convex env set CLERK_ISSUER_URL https://your-frontend-api.clerk.accounts.dev
```

### 4. Run the app

```bash
npm run dev
```

Open <http://localhost:3000>, sign in with Clerk, and start chatting.

## Example prompts

```text
Search Wikipedia for Ada Lovelace and summarize her work in 3 bullet points.
```

```text
Look up the Wikipedia article on LangChain and explain it in simple terms.
```

```text
Find 3 books about machine learning on Google Books with their authors.
```

```text
"Finding and analyzing YouTube video transcripts" — how does this work?
```

## Where things live

| File | What it does |
| --- | --- |
| `lib/langgraph.ts` | Gemini model, SSE retry logic, graph, tool-round cap |
| `lib/tools.ts` | Wikipedia and Google Books tools |
| `constants/systemMessage.ts` | Instructions given to the agent |
| `app/api/chat/stream/route.ts` | Server-Sent Events chat endpoint |
| `components/ChatInterface.tsx` | Stream reading and message state |
| `components/MessageBubble.tsx` | Clean markdown-style rendering of answers |
| `convex/` | Schema, messages, chats, and Clerk auth config |

## Useful checks

```bash
npx tsc --noEmit
npm run build
```

If `npm run build` fails while `npm run dev` is running, stop the dev server first — both commands share the `.next` directory. Then remove the cache and rebuild:

```powershell
Remove-Item -Recurse -Force .next
npm run build
```

## Troubleshooting

- **"This model is currently experiencing high demand"** — Gemini's free tier is busy. Wait a moment and try again; the app retries automatically.
- **"Failed to parse stream"** — this was caused by Gemini appending a `503` payload to an SSE response. The stream wrapper handles it; a hard refresh picks up the latest code.
- **An old message still shows tool HTML** — hard-refresh with `Ctrl + Shift + R`. Saved messages are cleaned when they render.
- **Clerk says the SDK is outdated** — update `@clerk/nextjs` and restart the dev server.
