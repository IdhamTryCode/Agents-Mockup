// Thin client for Ollama's /api/chat. On the GB10 box the app joins the `llmops`
// docker network and reaches Ollama at `ollama:11434` (no host port is published,
// so this is the only way in — see stack.yml).
const OLLAMA_URL = (process.env.OLLAMA_URL ?? "http://ollama:11434").replace(/\/$/, "");
const EMBED_MODEL = process.env.EMBED_MODEL ?? "bge-m3";

/** Embed one or more texts with bge-m3 (multilingual, strong on Indonesian). */
export async function ollamaEmbed(input: string[]): Promise<number[][]> {
  const res = await fetch(`${OLLAMA_URL}/api/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: EMBED_MODEL, input }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    throw new Error(`Ollama embed ${res.status}: ${(await res.text()).slice(0, 150)}`);
  }
  const data = (await res.json()) as { embeddings?: number[][] };
  return data.embeddings ?? [];
}

export type ChatMsg = { role: "system" | "user" | "assistant"; content: string };

/** Multi-turn chat (system + history + latest turn). Used by Learn mode's guided
 *  loop, where the tutor needs the running conversation, not a single question. */
export async function ollamaChatMessages(
  model: string,
  messages: ChatMsg[],
  opts: { temperature?: number } = {}
): Promise<string> {
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      messages,
      options: { temperature: opts.temperature ?? 0.3 },
    }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) {
    throw new Error(`Ollama ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const data = (await res.json()) as { message?: { content?: string } };
  return data.message?.content ?? "";
}

export async function ollamaChat(
  model: string,
  content: string,
  opts: { temperature?: number; format?: unknown } = {}
): Promise<string> {
  const body: Record<string, unknown> = {
    model,
    stream: false,
    messages: [{ role: "user", content }],
    options: { temperature: opts.temperature ?? 0.2 },
  };
  if (opts.format) body.format = opts.format;

  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    // model cold-load + generation can be slow on a busy box
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) {
    throw new Error(`Ollama ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const data = (await res.json()) as { message?: { content?: string } };
  return data.message?.content ?? "";
}
