import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
  "te",
  "trailer",
  "proxy-connection",
]);

const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);

function proxify(value: string, targetUrl: string, selfOrigin: string): string {
  const v = (value || "").trim();
  if (!v || v.startsWith("#") || v.startsWith("javascript:")) return v;
  // deja proxiat (relativ sau absolut)
  if (v.startsWith("/api/proxy") || v.startsWith(selfOrigin)) return v;
  try {
    return `${selfOrigin}/api/proxy?url=${encodeURIComponent(new URL(v, targetUrl).href)}`;
  } catch {
    return v;
  }
}

function rewriteHtml(
  html: string,
  targetUrl: string,
  selfOrigin: string,
): string {
  let out = html;
  // scoatem <base> existent, ca să nu intre în conflict cu al nostru
  out = out.replace(/<base\b[^>]*\/?>/gi, "");
  // injectăm <base href="origin/"> ca toate resursele (css/js/imagini) să se încarce direct de la țintă
  const origin = new URL(targetUrl).origin;
  out = out.replace(/(<head\b[^>]*>)/i, `$1<base href="${origin}/">`);
  // rescriem acțiunile formularelor cu URL ABSOLUT al proxy-ului — altfel <base> le-ar
  // rezolva pe domeniul țintă și AJAX-ul PrimeFaces ar fi blocat de CORS (HTTP 0)
  out = out.replace(
    /(?<![\w-])(action\s*=\s*)(["'])([^"']*)\2/gi,
    (_m, pre, q, val) => `${pre}${q}${proxify(val, targetUrl, selfOrigin)}${q}`,
  );
  // rescriem linkurile <a href> absolute/relative, ca navigarea să rămână în proxy
  out = out.replace(
    /(<a\b[^>]*?\bhref\s*=\s*)(["'])([^"']*)\2/gi,
    (_m, pre, q, val) => `${pre}${q}${proxify(val, targetUrl, selfOrigin)}${q}`,
  );
  return out;
}

function rewriteXml(xml: string, targetUrl: string, selfOrigin: string): string {
  // PrimeFaces răspunde la AJAX cu <partial-response> care poate conține <redirect url="..."/>
  return xml.replace(
    /(?<![\w-])(url\s*=\s*)(["'])([^"']*)\2/gi,
    (_m, pre, q, val) => `${pre}${q}${proxify(val, targetUrl, selfOrigin)}${q}`,
  );
}

function fixSetCookie(raw: string): string {
  return raw
    .split(";")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((part) => {
      const eq = part.indexOf("=");
      const key = (eq === -1 ? part : part.slice(0, eq)).toLowerCase();
      if (key === "path") return "Path=/";
      if (key === "domain" || key === "secure") return null;
      return part;
    })
    .filter((p): p is string => p !== null)
    .join("; ");
}

function getSetCookies(res: Response): string[] {
  if (typeof res.headers.getSetCookie === "function") {
    return res.headers.getSetCookie();
  }
  const single = res.headers.get("set-cookie");
  return single ? [single] : [];
}

async function proxy(request: NextRequest): Promise<Response> {
  const url = new URL(request.url);
  const target = url.searchParams.get("url");
  const selfOrigin = url.origin;

  if (!target) {
    return new Response("Lipsește parametrul ?url=", { status: 400 });
  }

  let targetUrl: URL;
  try {
    targetUrl = new URL(target);
    if (!/^https?:$/.test(targetUrl.protocol)) throw new Error("bad protocol");
  } catch {
    return new Response(
      "URL țintă invalid — trebuie să înceapă cu http:// sau https://",
      {
        status: 400,
        headers: { "content-type": "text/plain; charset=utf-8" },
      },
    );
  }

  // forwardăm headerele cererii (inclusiv cookie-urile stocate pe origin-ul nostru)
  const headers = new Headers();
  for (const [k, v] of request.headers) {
    const lk = k.toLowerCase();
    if (lk === "host" || HOP_BY_HOP.has(lk)) continue;
    headers.set(k, v);
  }

  const body =
    request.method === "GET" || request.method === "HEAD"
      ? undefined
      : await request.arrayBuffer();

  let res: Response;
  try {
    res = await fetch(targetUrl.href, {
      method: request.method,
      headers,
      body,
      redirect: "manual",
      cache: "no-store",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(`Nu am putut accesa ${targetUrl.href}: ${msg}`, {
      status: 502,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  // redirecturi: le translăm în URL-uri proxied
  const location = res.headers.get("location");
  if (location && REDIRECT_CODES.has(res.status)) {
    let next = location;
    try {
      next = new URL(location, targetUrl.href).href;
    } catch {
      // păstrăm valoarea brută
    }
    const out = new Response(null, { status: res.status });
    out.headers.set(
      "location",
      `${selfOrigin}/api/proxy?url=${encodeURIComponent(next)}`,
    );
    for (const sc of getSetCookies(res))
      out.headers.append("set-cookie", fixSetCookie(sc));
    return out;
  }

  const contentType = res.headers.get("content-type") || "";
  const outHeaders = new Headers();
  for (const [k, v] of res.headers) {
    const lk = k.toLowerCase();
    if (
      HOP_BY_HOP.has(lk) ||
      lk === "content-encoding" ||
      lk === "content-length"
    )
      continue;
    // permitem încărcarea în iframe
    if (lk === "x-frame-options" || lk === "content-security-policy") continue;
    outHeaders.set(k, v);
  }
  for (const sc of getSetCookies(res))
    outHeaders.append("set-cookie", fixSetCookie(sc));

  const buf = await res.arrayBuffer();

  if (contentType.includes("text/html")) {
    const html = new TextDecoder("utf-8").decode(buf);
    outHeaders.set("content-type", "text/html; charset=utf-8");
    return new Response(rewriteHtml(html, targetUrl.href, selfOrigin), {
      status: res.status,
      headers: outHeaders,
    });
  }

  if (contentType.includes("xml")) {
    const xml = new TextDecoder("utf-8").decode(buf);
    return new Response(rewriteXml(xml, targetUrl.href, selfOrigin), {
      status: res.status,
      headers: outHeaders,
    });
  }

  return new Response(buf, { status: res.status, headers: outHeaders });
}

export async function GET(request: NextRequest) {
  return proxy(request);
}

export async function POST(request: NextRequest) {
  return proxy(request);
}
