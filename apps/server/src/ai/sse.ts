// Server-sent events from OpenAI-style chat completions (OpenRouter, OpenAI, Gemini, local
// servers) with `stream: true`, folded back into the shape of a non-streamed reply so callers keep
// one code path. `onText` sees the reply so far after every chunk.

export interface StreamedBody {
  model?: string;
  choices: { message: { content: string }; finish_reason?: string }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
  error?: { code?: number | string; message?: string };
}

export async function readSse(res: Response, onText: (text: string) => void): Promise<StreamedBody> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const out: StreamedBody = { choices: [{ message: { content: "" } }] };
  let buf = "", text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      // Comments (": OPENROUTER PROCESSING") and blank keep-alives carry nothing.
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      let chunk: any;
      try { chunk = JSON.parse(data); } catch { continue; }
      if (chunk.error) out.error = chunk.error;
      if (chunk.model) out.model = chunk.model;
      if (chunk.usage) out.usage = chunk.usage;
      const choice = chunk.choices?.[0];
      const delta = choice?.delta?.content;
      if (typeof delta === "string" && delta) {
        text += delta;
        onText(text);
      }
      if (choice?.finish_reason) out.choices[0].finish_reason = choice.finish_reason;
    }
  }
  out.choices[0].message.content = text;
  return out;
}
