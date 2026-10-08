import { reactive, onMounted, onBeforeUnmount } from 'vue';

/**
 * OneStock UI extension context (see "UI Extensibility - How to develop UI Extensions"):
 * URL parameters + `extension_ready` / `onestock_data` handshake. The signature is not verified.
 */
export interface OnestockContext {
  embedded: boolean;
  ready: boolean;
  extensionId: string;
  userId: string;
  siteId: string;
  lang: string;
  hostApp: string;
  apiUrl: string;
  orderId: string;
  /** Optional ?environment= (qualif, prod…); otherwise deduced server side from api_url. */
  environment: string;
  parentOrigin: string;
}

function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return '*';
  }
}

export function useOnestockContext() {
  const params = new URLSearchParams(window.location.search);
  const embedded = window.parent !== window;
  const context = reactive<OnestockContext>({
    embedded,
    ready: !embedded,
    extensionId: params.get('extension_id') || '',
    userId: params.get('user_id') || '',
    siteId: params.get('site_id') || '',
    lang: params.get('lang') || 'fr',
    hostApp: params.get('host_app') || '',
    apiUrl: params.get('api_url') || '',
    // Outside of OneStock, ?order_id= (and ?api_url=) can be used to test the page.
    orderId: params.get('order_id') || '',
    environment: params.get('environment') || '',
    parentOrigin: originOf(params.get('parent_url') || ''),
  });

  function post(message: Record<string, unknown>) {
    if (embedded) window.parent.postMessage(message, context.parentOrigin);
  }

  function onMessage(event: MessageEvent) {
    if (context.parentOrigin !== '*' && event.origin !== context.parentOrigin) return;
    if (!event.data || typeof event.data !== 'object' || event.data.type !== 'onestock_data') return;
    const data = event.data.data || {};
    context.apiUrl = data.api_url || context.apiUrl;
    context.siteId = data.site_id || context.siteId;
    context.userId = data.user_id || context.userId;
    context.extensionId = data.extension_id || context.extensionId;
    context.orderId = data.order_id || (data.order_ids || '').split(',')[0] || context.orderId;
    context.ready = true;
  }

  let observer: ResizeObserver | undefined;
  onMounted(() => {
    window.addEventListener('message', onMessage);
    post({ type: 'extension_ready' });
    // Back office iframes follow the page height.
    observer = new ResizeObserver(() => {
      const height = Math.ceil(document.documentElement.scrollHeight);
      if (height > 0) post({ type: 'extension_resize', height });
    });
    observer.observe(document.body);
  });
  onBeforeUnmount(() => {
    window.removeEventListener('message', onMessage);
    observer?.disconnect();
  });

  return {
    context,
    close: () => post({ type: 'extension_close' }),
  };
}
