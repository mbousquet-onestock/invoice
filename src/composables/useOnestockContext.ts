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
  /** URL of the OneStock page showing the iframe: identifies the back office and its token. */
  parentUrl: string;
  parentOrigin: string;
  /** site_id / api_url entered in the screen because the context did not give them. */
  manual: { siteId: boolean; apiUrl: boolean };
}

const MANUAL_KEY = 'onestock-invoice-context';

function readManual(): { site_id?: string; api_url?: string } {
  try {
    return JSON.parse(localStorage.getItem(MANUAL_KEY) || '{}');
  } catch {
    return {};
  }
}

/** Completes the context with the site / API URL entered earlier in this browser, for what the context lacks. */
function completeFromManual(context: OnestockContext) {
  const manual = readManual();
  if (!context.siteId && manual.site_id) {
    context.siteId = manual.site_id;
    context.manual.siteId = true;
  }
  if (!context.apiUrl && manual.api_url) {
    context.apiUrl = manual.api_url;
    context.manual.apiUrl = true;
  }
}

/** Site / API URL entered in the screen when the context does not give them; remembered in this browser. */
export function saveManualContext(context: OnestockContext, values: { siteId?: string; apiUrl?: string }) {
  const manual = readManual();
  if (values.siteId !== undefined) {
    manual.site_id = values.siteId.trim();
    context.siteId = manual.site_id;
    context.manual.siteId = true;
  }
  if (values.apiUrl !== undefined) {
    manual.api_url = values.apiUrl.trim().replace(/\/+$/, '');
    context.apiUrl = manual.api_url;
    context.manual.apiUrl = true;
  }
  try {
    localStorage.setItem(MANUAL_KEY, JSON.stringify(manual));
  } catch {
    /* storage blocked: kept for this session only */
  }
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
    parentUrl: params.get('parent_url') || '',
    parentOrigin: originOf(params.get('parent_url') || ''),
    manual: { siteId: false, apiUrl: false },
  });
  if (!embedded) completeFromManual(context);

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
    completeFromManual(context);
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
