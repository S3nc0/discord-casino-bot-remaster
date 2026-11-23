import { describe, expect, it, vi } from 'vitest';
import { fetchAttachmentText } from './admin-tools.ts';

const CDN = 'https://cdn.discordapp.com/attachments/1/2/quiz.txt';

function bodyOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(c);
      controller.close();
    },
  });
}

function respond(chunks: Uint8Array[], headers: Record<string, string> = {}): typeof fetch {
  return vi.fn(async () => new Response(bodyOf(chunks), { status: 200, headers })) as never;
}

describe('R-13: quiz bulk download', () => {
  it('only fetches https URLs on the Discord attachment CDN', async () => {
    const f = respond([new TextEncoder().encode('ok')]);
    for (const url of [
      'http://cdn.discordapp.com/a.txt',
      'https://evil.example/a.txt',
      'https://cdn.discordapp.com.evil.example/a.txt',
      'https://user@evil.example/a.txt',
      'https://169.254.169.254/latest',
      'not a url',
    ]) {
      await expect(fetchAttachmentText(url, 1000, f)).rejects.toThrow();
    }
    expect(f).not.toHaveBeenCalled();
    await expect(
      fetchAttachmentText('https://media.discordapp.net/attachments/1/2/q.txt', 1000, f),
    ).resolves.toBe('ok');
  });

  it('passes a timeout signal and refuses redirects', async () => {
    const f = respond([new TextEncoder().encode('ok')]);
    await fetchAttachmentText(CDN, 1000, f);
    const init = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![1] as RequestInit;
    expect(init.redirect).toBe('error');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('rejects an oversized content-length without reading the body', async () => {
    const f = respond([new Uint8Array(10)], { 'content-length': '5000' });
    await expect(fetchAttachmentText(CDN, 1000, f)).rejects.toThrow();
  });

  it('stops reading a body that grows past the cap, whatever it claimed', async () => {
    let pulled = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(new Uint8Array(400));
        if (pulled > 1000) controller.close();
      },
    });
    const f = vi.fn(async () => new Response(body, { status: 200 })) as never;
    await expect(fetchAttachmentText(CDN, 1000, f)).rejects.toThrow();
    expect(pulled).toBeLessThan(10);
  });

  it('decodes a small UTF-8 body and rejects invalid UTF-8', async () => {
    const jp = new TextEncoder().encode('問題: 日本の首都は？');
    await expect(fetchAttachmentText(CDN, 1000, respond([jp]))).resolves.toBe(
      '問題: 日本の首都は？',
    );
    await expect(
      fetchAttachmentText(CDN, 1000, respond([new Uint8Array([0xff, 0xfe, 0xfd])])),
    ).rejects.toThrow();
  });
});
