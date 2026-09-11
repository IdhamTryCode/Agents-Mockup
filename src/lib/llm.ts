/**
 * OpenAI-compatible chat client for the box's vLLM (base + LoRA adapters).
 * On the GB10 box this app joins the `llmops` docker network and reaches vLLM
 * directly at `vllm4b:8000` (the same engine behind gateway 11436). Model id is
 * `base` (Tanya/Belajar) or `practice` (Latihan) — see contract.servedModel().
 */
const VLLM_URL = (process.env.VLLM_URL ?? "http://vllm4b:8000/v1").replace(/\/$/, "");
const VLLM_API_KEY = process.env.VLLM_API_KEY ?? ""; // vLLM is keyless on the internal network

export type ChatMsg = { role: "system" | "user" | "assistant"; content: string };

export async function vllmChat(
  model: string,
  messages: ChatMsg[],
  opts: { temperature?: number; maxTokens?: number; guidedJson?: unknown } = {}
): Promise<string> {
  const res = await fetch(`${VLLM_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(VLLM_API_KEY ? { Authorization: `Bearer ${VLLM_API_KEY}` } : {}),
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: opts.temperature ?? 0.3,
      max_tokens: opts.maxTokens ?? 800,
      // Guided decoding: vLLM filters the sampler at every step so only tokens that keep
      // the output valid against this schema can be emitted. Latihan needs it because the
      // practice adapter intermittently falls into a token loop -- measured on both v1 and
      // v2, roughly 1 request in 6-10 -- emitting `level_level_level...` until max_tokens
      // and never closing the JSON. RantAI Agents parses this output directly, so a broken
      // object is a hard failure for the real app, not a cosmetic one. A schema makes the
      // loop structurally impossible rather than merely rare; no retraining is involved.
      //
      // Sent as `response_format`, NOT the older `guided_json`. Measured on the box against
      // vllm/vllm-openai:cu130-nightly: a top-level `guided_json` is accepted and then
      // SILENTLY IGNORED -- the request succeeds, the sampler is never constrained, and the
      // model is free to emit prose. Latihan looked fine only because the practice adapter
      // was trained to emit JSON; the guardrail behind it was never actually running.
      ...(opts.guidedJson
        ? {
            response_format: {
              type: "json_schema",
              json_schema: { name: "soal", schema: opts.guidedJson },
            },
          }
        : {}),
    }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) {
    throw new Error(`vLLM ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content ?? "";
}
