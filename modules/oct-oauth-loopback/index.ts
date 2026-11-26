import { requireOptionalNativeModule } from 'expo-modules-core';
import type { LoopbackAuthPort } from '../../src/ai/oauth';

interface NativeLoopbackModule {
  startSessionAsync(expectedState: string, path: string): Promise<{ sessionId: string; port: number }>;
  awaitCallbackAsync(sessionId: string, timeoutMs: number): Promise<{ code: string; state: string }>;
  closeSessionAsync(sessionId: string): Promise<void>;
}

const nativeModule = requireOptionalNativeModule<NativeLoopbackModule>('OctOAuthLoopback');
const CALLBACK_TIMEOUT_MS = 120_000;

function cancellationError(): Error {
  const error = new Error('Sign-in was cancelled');
  error.name = 'AbortError';
  return error;
}

export function isNativeLoopbackAuthAvailable(): boolean {
  return nativeModule !== null;
}

export function createNativeLoopbackAuthPort(): LoopbackAuthPort | null {
  if (!nativeModule) return null;
  const native = nativeModule;

  return {
    async listen({ host, path, expectedState, signal }) {
      if (host !== '127.0.0.1' || path !== '/callback' || !expectedState.trim()) {
        throw new Error('Invalid loopback sign-in parameters');
      }
      if (signal?.aborted) throw cancellationError();

      const { sessionId, port } = await native.startSessionAsync(expectedState, path);
      // Cancellation may happen while native binding is still in flight.
      if (signal?.aborted) {
        await native.closeSessionAsync(sessionId);
        throw cancellationError();
      }

      let closePromise: Promise<void> | undefined;
      let settled = false;
      let rejectCallback: (reason: Error) => void = () => {};
      const closeNative = (): Promise<void> => {
        closePromise ??= native.closeSessionAsync(sessionId);
        return closePromise;
      };
      const close = (): Promise<void> => {
        signal?.removeEventListener('abort', onAbort);
        if (!settled) {
          settled = true;
          rejectCallback(cancellationError());
        }
        return closeNative();
      };
      const onAbort = (): void => { void close().catch(() => {}); };

      const callback = new Promise<{ code: string; state: string }>((resolve, reject) => {
        rejectCallback = reject;
        native.awaitCallbackAsync(sessionId, CALLBACK_TIMEOUT_MS).then(
          (result) => { settled = true; resolve(result); },
          (error: unknown) => { settled = true; reject(error); },
        );
      }).finally(() => {
        signal?.removeEventListener('abort', onAbort);
        return closeNative();
      });
      // A cancellation can precede the caller attaching its callback handler.
      void callback.catch(() => {});
      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) onAbort();

      return { port, callback, close };
    },
  };
}
