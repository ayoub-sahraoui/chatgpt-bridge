import { browser } from '#imports';
import { EVENT_TAG, MESSAGE_TAG, type BridgeErrorShape } from './protocol';

let counter = 0;

/**
 * Call a bridge method from an extension page (popup/options).
 * The background router answers with { ok, result } | { ok:false, error }.
 */
export function rpc<T = unknown>(
  method: string,
  params?: Record<string, unknown>,
  timeoutMs = 30_000,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = `ui-${Date.now().toString(36)}-${++counter}`;
    const timer = setTimeout(() => reject(new Error(`RPC timeout: ${method}`)), timeoutMs);
    browser.runtime
      .sendMessage({ [MESSAGE_TAG]: true, id, method, params })
      .then((res: unknown) => {
        clearTimeout(timer);
        const r = res as { ok?: boolean; result?: T; error?: BridgeErrorShape } | undefined;
        if (r?.ok) resolve(r.result as T);
        else reject(new Error(r?.error?.message ?? `RPC failed: ${method}`));
      })
      .catch((err: unknown) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      });
  });
}
