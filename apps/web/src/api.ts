import { createTRPCClient, httpBatchLink, TRPCClientError } from '@trpc/client';
import type { AppRouter } from '@gym/api';
import type { inferRouterInputs, inferRouterOutputs } from '@trpc/server';

export const api = createTRPCClient<AppRouter>({
  links: [httpBatchLink({ url: '/api/trpc' })],
});

export type Outputs = inferRouterOutputs<AppRouter>;
export type Inputs = inferRouterInputs<AppRouter>;

export function errMessage(err: unknown): string {
  if (err instanceof TRPCClientError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Something went wrong';
}

export async function uploadMedia(file: Blob, purpose: 'demo' | 'report' | 'form'): Promise<string> {
  const res = await fetch(`/api/media?purpose=${purpose}`, {
    method: 'POST',
    headers: { 'content-type': file.type || 'application/octet-stream', 'x-media-mime': file.type },
    body: file,
  });
  if (!res.ok) throw new Error(`upload failed (${res.status})`);
  const body = (await res.json()) as { mediaId: string };
  return body.mediaId;
}

export const mediaUrl = (mediaId: string) => `/api/media/${mediaId}`;
