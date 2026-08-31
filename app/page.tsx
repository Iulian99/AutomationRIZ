"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type FieldType = "text" | "password" | "select" | "checkbox" | "radio";

type FieldConfig = {
  id: string;
  label: string;
  selector: string;
  value: string;
  type: FieldType;
};

type FillStatus = "pending" | "filled" | "not-found" | "error";

type FillResult = FieldConfig & {
  status: FillStatus;
  message?: string;
};

const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text: "Text",
  password: "Parolă",
  select: "Select (dropdown)",
  checkbox: "Bifă (checkbox)",
  radio: "Radio",
};

function uid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `id-${Math.random().toString(36).slice(2)}-${Date.now()}`;
}

const DEFAULT_FIELDS: FieldConfig[] = [
  {
    id: uid(),
    label: "Username",
    selector: "#loginForm\\:username",
    value: "",
    type: "text",
  },
  {
    id: uid(),
    label: "Parolă",
    selector: "#loginForm\\:password",
    value: "",
    type: "password",
  },
];

const TRUE_VALUES = new Set(["true", "1", "on", "yes", "da"]);

function nativeSetter(el: Element, value: string) {
  // folosim descriptorul de pe elementul însuși (React/controled) sau de pe prototipul
  // din realm-ul elementului — evită problemele cross-realm cu instanceof/„Illegal invocation"
  let desc = Object.getOwnPropertyDescriptor(el, "value");
  if (!desc?.set) {
    const proto = Object.getPrototypeOf(el);
    desc = Object.getOwnPropertyDescriptor(proto, "value");
  }
  if (desc?.set) {
    desc.set.call(el, value);
  } else {
    (el as HTMLInputElement).value = value;
  }
}

function dispatchEvents(el: Element) {
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

function statusBadge(status: FillStatus) {
  switch (status) {
    case "filled":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-semibold text-green-800 dark:bg-green-900/40 dark:text-green-300">
          ✓ Completat
        </span>
      );
    case "not-found":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
          ✗ Selector negăsit
        </span>
      );
    case "error":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-800 dark:bg-red-900/40 dark:text-red-300">
          ⚠ Eroare
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
          ⏳ În așteptare
        </span>
      );
  }
}

type SpeedKey = "rapid" | "normal" | "lent";

const SPEEDS: Record<
  SpeedKey,
  { label: string; field: number; click: number; nav: number; char: number }
> = {
  rapid: { label: "Rapid", field: 350, click: 450, nav: 400, char: 25 },
  normal: { label: "Normal", field: 800, click: 900, nav: 800, char: 55 },
  lent: { label: "Lent", field: 1600, click: 1600, nav: 1400, char: 110 },
};

type LogStatus = "ok" | "error" | "warn" | "info";

type LogEntry = {
  id: number;
  time: string;
  text: string;
  status: LogStatus;
};

const LOG_COLORS: Record<LogStatus, string> = {
  ok: "text-green-400",
  error: "text-red-400",
  warn: "text-amber-400",
  info: "text-zinc-300",
};

const LOG_MARKS: Record<LogStatus, string> = {
  ok: "✓",
  error: "✗",
  warn: "!",
  info: "·",
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getIframeDoc(iframe: HTMLIFrameElement | null): Document | null {
  try {
    return iframe?.contentDocument ?? null;
  } catch {
    return null;
  }
}

function queryFirst(doc: Document, selector: string): Element | null {
  if (!selector.trim()) return null;
  try {
    const el = doc.querySelector(selector);
    if (el) return el;
  } catch {
    // selector invalid — încercăm fallback pe id
  }
  if (selector.startsWith("#")) {
    return doc.getElementById(selector.slice(1));
  }
  return null;
}

function ensureStyle(doc: Document) {
  if (doc.getElementById("fa-style")) return;
  try {
    const style = doc.createElement("style");
    style.id = "fa-style";
    style.textContent = [
      ".fa-highlight{outline:3px solid #2563eb !important;outline-offset:2px;box-shadow:0 0 0 6px rgba(37,99,235,.35) !important;}",
      ".fa-highlight-click{outline:3px solid #dc2626 !important;outline-offset:2px;animation:faPulse .6s ease-in-out infinite alternate;}",
      "@keyframes faPulse{from{box-shadow:0 0 0 4px rgba(220,38,38,.25)}to{box-shadow:0 0 0 10px rgba(220,38,38,.6)}}",
      ".fa-flag{position:absolute;z-index:2147483647;background:#16a34a;color:#fff;font:600 12px/1.4 Arial,sans-serif;padding:3px 9px;border-radius:6px;box-shadow:0 2px 8px rgba(0,0,0,.35);pointer-events:none;white-space:nowrap;}",
    ].join("");
    (doc.head || doc.documentElement).appendChild(style);
  } catch {
    // ignorăm
  }
}

function highlightElement(
  doc: Document,
  el: Element,
  kind: "field" | "click",
): () => void {
  ensureStyle(doc);
  const cls = kind === "click" ? "fa-highlight-click" : "fa-highlight";
  el.classList.add(cls);
  try {
    (el as HTMLElement).scrollIntoView({ block: "center", behavior: "smooth" });
  } catch {
    // ignorăm
  }
  return () => el.classList.remove(cls);
}

function showFlag(doc: Document, el: Element, text: string) {
  ensureStyle(doc);
  try {
    const win = doc.defaultView;
    const rect = el.getBoundingClientRect();
    const x = rect.left + (win?.scrollX ?? 0);
    const y = rect.top + (win?.scrollY ?? 0) - 30;
    const flag = doc.createElement("div");
    flag.className = "fa-flag";
    flag.textContent = text;
    flag.style.left = `${Math.max(4, Math.round(x))}px`;
    flag.style.top = `${Math.max(4, Math.round(y))}px`;
    doc.body?.appendChild(flag);
    setTimeout(() => flag.remove(), 1500);
  } catch {
    // ignorăm
  }
}

function maskValue(f: FieldConfig): string {
  if (f.type !== "password" || !f.value) return f.value;
  return "•".repeat(Math.min(f.value.length, 10));
}

function dispatchKeyEvent(
  doc: Document,
  el: Element,
  type: string,
  ch: string,
) {
  // folosim KeyboardEvent din realm-ul iframe-ului, ca să nu avem probleme cross-realm
  const win = doc.defaultView;
  try {
    const K = (win?.KeyboardEvent ?? KeyboardEvent) as typeof KeyboardEvent;
    el.dispatchEvent(
      new K(type, {
        key: ch,
        code: ch.length === 1 ? `Key${ch.toUpperCase()}` : ch,
        bubbles: true,
        cancelable: true,
      }),
    );
  } catch {
    el.dispatchEvent(new Event(type, { bubbles: true }));
  }
}

// tastează textul caracter cu caracter (keydown → valoare → input → keyup),
// exact cum ar face sendKeys din Selenium cu delay între taste
async function typeText(
  doc: Document,
  el: Element,
  text: string,
  charDelay: number,
): Promise<void> {
  const htmlEl = el as HTMLElement;
  try {
    htmlEl.focus();
  } catch {
    // ignorăm
  }
  let acc = "";
  for (const ch of text) {
    if (typeof ch !== "string" || ch.length === 0) continue;
    acc += ch;
    dispatchKeyEvent(doc, el, "keydown", ch);
    nativeSetter(el, acc);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    dispatchKeyEvent(doc, el, "keyup", ch);
    await sleep(charDelay);
  }
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

type PrimeFacesWindow = Window & {
  PrimeFaces?: { ajaxQueue?: { isEmpty?: () => boolean } };
};

// așteaptă evenimentul load al iframe-ului, cu timeout (navigare după submit/redirect)
function waitForIframeLoad(
  iframe: HTMLIFrameElement,
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      iframe.removeEventListener("load", onLoad);
      resolve();
    };
    const onLoad = () => finish();
    iframe.addEventListener("load", onLoad);
    setTimeout(finish, timeoutMs);
  });
}

// așteaptă terminarea cererilor AJAX PrimeFaces (coada de request-uri goală)
function waitForAjax(doc: Document, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    let hasApi = false;
    try {
      const w = doc.defaultView as PrimeFacesWindow | null;
      hasApi = typeof w?.PrimeFaces?.ajaxQueue?.isEmpty === "function";
    } catch {
      hasApi = false;
    }
    if (!hasApi) {
      setTimeout(resolve, Math.min(timeoutMs, 1200));
      return;
    }
    const t0 = Date.now();
    const check = () => {
      let empty = true;
      try {
        const w = doc.defaultView as PrimeFacesWindow | null;
        empty = w?.PrimeFaces?.ajaxQueue?.isEmpty?.() ?? true;
      } catch {
        empty = true;
      }
      if (empty || Date.now() - t0 > timeoutMs) {
        resolve();
        return;
      }
      setTimeout(check, 100);
    };
    check();
  });
}

// generează toate zilele unei luni (opțional doar zilele lucrătoare L–V), format dd.MM.yyyy
function generateMonthDates(
  monthInput: string,
  skipWeekends: boolean,
): string[] {
  const m = /^(\d{4})-(\d{2})$/.exec(monthInput);
  if (!m) return [];
  const year = Number(m[1]);
  const monthIdx = Number(m[2]) - 1;
  const daysInMonth = new Date(year, monthIdx + 1, 0).getDate();
  const out: string[] = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const dow = new Date(year, monthIdx, d).getDay();
    if (skipWeekends && (dow === 0 || dow === 6)) continue;
    const dd = String(d).padStart(2, "0");
    const mm = String(monthIdx + 1).padStart(2, "0");
    out.push(`${dd}.${mm}.${year}`);
  }
  return out;
}

// parsează lista de zile din text (una pe rând, dd.MM.yyyy)
function parseDates(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /^\d{2}\.\d{2}\.\d{4}$/.test(l));
}

type SpyWindow = PrimeFacesWindow & {
  XMLHttpRequest: typeof XMLHttpRequest;
  __faSpy?: { status?: number; text?: string };
};

// injectează un spion pe XMLHttpRequest în iframe, ca să vedem răspunsul AJAX de login
function injectAjaxSpy(doc: Document): void {
  try {
    const win = doc.defaultView as SpyWindow | null;
    if (!win || win.__faSpy) return;
    const spy: { status?: number; text?: string } = {};
    win.__faSpy = spy;
    const OrigXHR = win.XMLHttpRequest;
    if (!OrigXHR) return;
    const proto = OrigXHR.prototype as unknown as {
      send: (...args: unknown[]) => void;
    };
    const origSend = proto.send;
    proto.send = function (this: unknown, ...args: unknown[]) {
      const xhr = this as {
        addEventListener: (t: string, h: () => void) => void;
        readyState: number;
        status: number;
        responseText?: string;
      };
      xhr.addEventListener("readystatechange", () => {
        if (xhr.readyState === 4) {
          spy.status = xhr.status;
          try {
            spy.text = String(xhr.responseText ?? "").slice(0, 600);
          } catch {
            spy.text = "";
          }
        }
      });
      return Reflect.apply(origSend, this, args);
    };
  } catch {
    // ignorăm
  }
}

// citește mesajele growl/message afișate de PrimeFaces (ex. „Username sau parola incorectă")
function readGrowlText(doc: Document): string {
  try {
    const nodes = doc.querySelectorAll(
      ".ui-growl-item-summary, .ui-growl-item-detail, .ui-messages .ui-messages-error, .ui-messages .ui-messages-info, .ui-message-error, .ui-message-info",
    );
    const parts: string[] = [];
    nodes.forEach((n) => {
      const t = (n.textContent ?? "").trim();
      if (t) parts.push(t);
    });
    return parts.join(" | ").slice(0, 300);
  } catch {
    return "";
  }
}

// numele cookie-urilor din sesiunea iframe-ului (JSESSIONID etc.)
function readCookies(doc: Document): string {
  try {
    return doc.cookie
      .split(";")
      .map((c) => c.trim().split("=")[0])
      .filter(Boolean)
      .join(", ");
  } catch {
    return "";
  }
}

// așteaptă rezultatul loginului: navigare (document nou) sau mesaj de eroare growl
async function waitForLoginResult(
  iframe: HTMLIFrameElement,
  initialDoc: Document,
  timeoutMs: number,
): Promise<Document | null> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const d = getIframeDoc(iframe);
    if (!d) return null;
    if (d !== initialDoc) return d; // pagina a navigat
    if (readGrowlText(d)) return null; // a apărut un mesaj de eroare, fără navigare
    await sleep(400);
  }
  return null;
}

const DEFAULT_CLICK_SELECTOR = "#loginForm\\:idlogin";
const DEFAULT_INSERT_SELECTOR = "#raportForm\\:j_idt96";
const DEFAULT_SAVE_SELECTOR = 'input[name="createForm\\:j_idt121"]';
const DEFAULT_INDEX_SELECTOR = "#j_idt16";

const DEFAULT_CREATE_FIELDS: FieldConfig[] = [
  {
    id: uid(),
    label: "Activitate (ROF)",
    selector: "#createForm\\:activitate_input",
    value: "",
    type: "select",
  },
  {
    id: uid(),
    label: "Atribuții",
    selector: "#createForm\\:atributii_input",
    value: "",
    type: "select",
  },
  {
    id: uid(),
    label: "Lucrare",
    selector: "#createForm\\:lucrare_input",
    value: "",
    type: "select",
  },
  {
    id: uid(),
    label: "Intrare (ora)",
    selector: "#createForm\\:intrare",
    value: "",
    type: "text",
  },
  {
    id: uid(),
    label: "Ieșire (ora)",
    selector: "#createForm\\:iesire",
    value: "",
    type: "text",
  },
  {
    id: uid(),
    label: "Minute principale",
    selector: "#createForm\\:principale",
    value: "0",
    type: "text",
  },
  {
    id: uid(),
    label: "Minute conexe",
    selector: "#createForm\\:conexe",
    value: "0",
    type: "text",
  },
  {
    id: uid(),
    label: "Minute neproductive",
    selector: "#createForm\\:neproductive",
    value: "0",
    type: "text",
  },
  {
    id: uid(),
    label: "Urgență",
    selector: 'input[name="createForm\\:urgenta"]',
    value: "NU",
    type: "radio",
  },
  {
    id: uid(),
    label: "Utilizare IT",
    selector: 'input[name="createForm\\:utilizareIt"]',
    value: "NU",
    type: "radio",
  },
  {
    id: uid(),
    label: "Tip activitate",
    selector: 'input[name="createForm\\:tipActivitate"]',
    value: "INDIVIDUALA",
    type: "radio",
  },
  {
    id: uid(),
    label: "Act",
    selector: "#createForm\\:act",
    value: "",
    type: "text",
  },
  {
    id: uid(),
    label: "Denumire IT",
    selector: "#createForm\\:denumireIt",
    value: "",
    type: "text",
  },
  {
    id: uid(),
    label: "Observații",
    selector: "#createForm\\:observatii",
    value: "",
    type: "text",
  },
];

function FieldsEditor(props: {
  fields: FieldConfig[];
  onChange: (id: string, patch: Partial<FieldConfig>) => void;
  onRemove: (id: string) => void;
}) {
  const { fields, onChange, onRemove } = props;
  return (
    <div className="flex flex-col gap-3">
      {fields.map((f) => (
        <div
          key={f.id}
          className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-950"
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <input
              type="text"
              value={f.label}
              onChange={(e) => onChange(f.id, { label: e.target.value })}
              placeholder="Etichetă (ex. Username)"
              className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm font-medium outline-none focus:border-blue-500 dark:border-zinc-700 dark:bg-zinc-900"
            />
            <button
              onClick={() => onRemove(f.id)}
              title="Șterge câmpul"
              className="rounded-md px-2 py-1 text-sm text-red-600 transition hover:bg-red-50 dark:hover:bg-red-950"
            >
              ✕
            </button>
          </div>
          <div className="flex flex-col gap-2">
            <input
              type="text"
              value={f.selector}
              onChange={(e) => onChange(f.id, { selector: e.target.value })}
              placeholder="Selector CSS (ex. #loginForm\\:username)"
              className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1 font-mono text-xs outline-none focus:border-blue-500 dark:border-zinc-700 dark:bg-zinc-900"
            />
            <div className="flex gap-2">
              <select
                value={f.type}
                onChange={(e) =>
                  onChange(f.id, { type: e.target.value as FieldType })
                }
                className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs outline-none focus:border-blue-500 dark:border-zinc-700 dark:bg-zinc-900"
              >
                {(Object.keys(FIELD_TYPE_LABELS) as FieldType[]).map((t) => (
                  <option key={t} value={t}>
                    {FIELD_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
              <input
                type={f.type === "password" ? "password" : "text"}
                value={f.value}
                onChange={(e) => onChange(f.id, { value: e.target.value })}
                placeholder={
                  f.type === "checkbox"
                    ? "true / false"
                    : f.type === "radio"
                      ? "valoarea opțiunii"
                      : "Valoare de completat"
                }
                className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1 font-mono text-xs outline-none focus:border-blue-500 dark:border-zinc-700 dark:bg-zinc-900"
              />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function Home() {
  const [targetUrl, setTargetUrl] = useState("");
  const [fields, setFields] = useState<FieldConfig[]>(DEFAULT_FIELDS);
  const [iframeSrc, setIframeSrc] = useState("");
  const [results, setResults] = useState<FillResult[]>([]);
  const [proxyError, setProxyError] = useState<string | null>(null);
  const [clickEnabled, setClickEnabled] = useState(true);
  const [clickSelector, setClickSelector] = useState(DEFAULT_CLICK_SELECTOR);
  const [speed, setSpeed] = useState<SpeedKey>("normal");
  const [typingSimulation, setTypingSimulation] = useState(true);
  const [autoRun, setAutoRun] = useState(false);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [running, setRunning] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [postStepsEnabled, setPostStepsEnabled] = useState(true);
  const [dateSelector, setDateSelector] = useState(
    "#j_idt10\\:j_idt13\\:dataAleasa_input",
  );
  const [setParamsSelector, setSetParamsSelector] = useState(
    "#j_idt10\\:j_idt13\\:j_idt27",
  );
  const [reportSelector, setReportSelector] = useState(
    "#j_idt10\\:j_idt13\\:raportItemsListButton-id",
  );
  const [extraSelector, setExtraSelector] = useState("");
  const [datesText, setDatesText] = useState("");
  const [monthInput, setMonthInput] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });
  const [skipWeekends, setSkipWeekends] = useState(true);
  const [insertEnabled, setInsertEnabled] = useState(true);
  const [insertSelector, setInsertSelector] = useState(DEFAULT_INSERT_SELECTOR);
  const [saveSelector, setSaveSelector] = useState(DEFAULT_SAVE_SELECTOR);
  const [indexSelector, setIndexSelector] = useState(DEFAULT_INDEX_SELECTOR);
  const [fieldsCreate, setFieldsCreate] = useState<FieldConfig[]>(
    DEFAULT_CREATE_FIELDS,
  );
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const nonceRef = useRef(0);
  const stopRef = useRef(false);
  const logRef = useRef<HTMLDivElement | null>(null);

  // restaurare din localStorage — citire unică la montare din storage extern (pattern standard),
  // de aceea dezactivăm regula set-state-in-effect pentru acest bloc
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    try {
      const savedUrl = localStorage.getItem("fa-target-url");
      if (savedUrl !== null) setTargetUrl(savedUrl);
      const savedFields = localStorage.getItem("fa-fields");
      if (savedFields) {
        const parsed = JSON.parse(savedFields);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setFields(parsed as FieldConfig[]);
        }
      }
      const savedClick = localStorage.getItem("fa-click-enabled");
      if (savedClick !== null) setClickEnabled(savedClick === "1");
      const savedClickSel = localStorage.getItem("fa-click-selector");
      if (savedClickSel !== null) setClickSelector(savedClickSel);
      const savedSpeed = localStorage.getItem("fa-speed");
      if (
        savedSpeed === "rapid" ||
        savedSpeed === "normal" ||
        savedSpeed === "lent"
      ) {
        setSpeed(savedSpeed);
      }
      const savedAutoRun = localStorage.getItem("fa-autorun");
      if (savedAutoRun !== null) setAutoRun(savedAutoRun === "1");
      const savedTyping = localStorage.getItem("fa-typing");
      if (savedTyping !== null) setTypingSimulation(savedTyping === "1");
      const savedPostSteps = localStorage.getItem("fa-poststeps");
      if (savedPostSteps !== null) setPostStepsEnabled(savedPostSteps === "1");
      const savedDateSel = localStorage.getItem("fa-date-selector");
      if (savedDateSel !== null) setDateSelector(savedDateSel);
      const savedSetParamsSel = localStorage.getItem("fa-setparams-selector");
      if (savedSetParamsSel !== null) setSetParamsSelector(savedSetParamsSel);
      const savedReportSel = localStorage.getItem("fa-report-selector");
      if (savedReportSel !== null) setReportSelector(savedReportSel);
      const savedExtraSel = localStorage.getItem("fa-extra-selector");
      if (savedExtraSel !== null) setExtraSelector(savedExtraSel);
      const savedDates = localStorage.getItem("fa-dates");
      if (savedDates !== null) setDatesText(savedDates);
      const savedSkipWk = localStorage.getItem("fa-skipweekends");
      if (savedSkipWk !== null) setSkipWeekends(savedSkipWk === "1");
      const savedInsert = localStorage.getItem("fa-insert");
      if (savedInsert !== null) setInsertEnabled(savedInsert === "1");
      const savedInsertSel = localStorage.getItem("fa-insert-selector");
      if (savedInsertSel !== null) setInsertSelector(savedInsertSel);
      const savedSaveSel = localStorage.getItem("fa-save-selector");
      if (savedSaveSel !== null) setSaveSelector(savedSaveSel);
      const savedIndexSel = localStorage.getItem("fa-index-selector");
      if (savedIndexSel !== null) setIndexSelector(savedIndexSel);
      const savedCreateFields = localStorage.getItem("fa-fields-create");
      if (savedCreateFields) {
        const parsed = JSON.parse(savedCreateFields);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setFieldsCreate(parsed as FieldConfig[]);
        }
      }
    } catch {
      // ignorăm erorile de storage
    }
    setHydrated(true);
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    try {
      localStorage.setItem("fa-target-url", targetUrl);
    } catch {
      // ignorăm
    }
  }, [targetUrl]);

  useEffect(() => {
    try {
      localStorage.setItem("fa-fields", JSON.stringify(fields));
    } catch {
      // ignorăm
    }
  }, [fields]);

  useEffect(() => {
    try {
      localStorage.setItem("fa-click-enabled", clickEnabled ? "1" : "0");
    } catch {
      // ignorăm
    }
  }, [clickEnabled]);

  useEffect(() => {
    try {
      localStorage.setItem("fa-click-selector", clickSelector);
    } catch {
      // ignorăm
    }
  }, [clickSelector]);

  useEffect(() => {
    try {
      localStorage.setItem("fa-speed", speed);
    } catch {
      // ignorăm
    }
  }, [speed]);

  useEffect(() => {
    try {
      localStorage.setItem("fa-autorun", autoRun ? "1" : "0");
    } catch {
      // ignorăm
    }
  }, [autoRun]);

  useEffect(() => {
    try {
      localStorage.setItem("fa-typing", typingSimulation ? "1" : "0");
    } catch {
      // ignorăm
    }
  }, [typingSimulation]);

  useEffect(() => {
    try {
      localStorage.setItem("fa-poststeps", postStepsEnabled ? "1" : "0");
    } catch {
      // ignorăm
    }
  }, [postStepsEnabled]);

  useEffect(() => {
    try {
      localStorage.setItem("fa-date-selector", dateSelector);
    } catch {
      // ignorăm
    }
  }, [dateSelector]);

  useEffect(() => {
    try {
      localStorage.setItem("fa-setparams-selector", setParamsSelector);
    } catch {
      // ignorăm
    }
  }, [setParamsSelector]);

  useEffect(() => {
    try {
      localStorage.setItem("fa-report-selector", reportSelector);
    } catch {
      // ignorăm
    }
  }, [reportSelector]);

  useEffect(() => {
    try {
      localStorage.setItem("fa-extra-selector", extraSelector);
    } catch {
      // ignorăm
    }
  }, [extraSelector]);

  useEffect(() => {
    try {
      localStorage.setItem("fa-dates", datesText);
    } catch {
      // ignorăm
    }
  }, [datesText]);

  useEffect(() => {
    try {
      localStorage.setItem("fa-skipweekends", skipWeekends ? "1" : "0");
    } catch {
      // ignorăm
    }
  }, [skipWeekends]);

  useEffect(() => {
    try {
      localStorage.setItem("fa-insert", insertEnabled ? "1" : "0");
    } catch {
      // ignorăm
    }
  }, [insertEnabled]);

  useEffect(() => {
    try {
      localStorage.setItem("fa-insert-selector", insertSelector);
    } catch {
      // ignorăm
    }
  }, [insertSelector]);

  useEffect(() => {
    try {
      localStorage.setItem("fa-save-selector", saveSelector);
    } catch {
      // ignorăm
    }
  }, [saveSelector]);

  useEffect(() => {
    try {
      localStorage.setItem("fa-index-selector", indexSelector);
    } catch {
      // ignorăm
    }
  }, [indexSelector]);

  useEffect(() => {
    try {
      localStorage.setItem("fa-fields-create", JSON.stringify(fieldsCreate));
    } catch {
      // ignorăm
    }
  }, [fieldsCreate]);

  const fillOne = useCallback((doc: Document, f: FieldConfig): FillResult => {
    let els: Element[] = [];
    try {
      els = Array.from(doc.querySelectorAll(f.selector));
    } catch {
      els = [];
    }
    if (els.length === 0 && f.selector.startsWith("#")) {
      const byId = doc.getElementById(f.selector.slice(1));
      if (byId) els = [byId];
    }
    if (els.length === 0) {
      return {
        ...f,
        status: "not-found",
        message: "Selectorul nu a găsit niciun element în pagină.",
      };
    }

    try {
      if (f.type === "radio") {
        const inputs = els.filter((e): e is HTMLInputElement => {
          const inp = e as HTMLInputElement;
          return typeof inp.type === "string" && inp.type === "radio";
        });
        const target = inputs.find((e) => e.value === f.value) ?? inputs[0];
        if (!target) {
          return {
            ...f,
            status: "not-found",
            message: "Nu există nicio opțiune radio pentru selector.",
          };
        }
        target.checked = true;
        dispatchEvents(target);
      } else if (f.type === "checkbox") {
        const el = els[0] as HTMLInputElement;
        el.checked = TRUE_VALUES.has(f.value.trim().toLowerCase());
        dispatchEvents(el);
      } else {
        const el = els[0];
        nativeSetter(el, f.value);
        dispatchEvents(el);
      }
      return { ...f, status: "filled" };
    } catch (err) {
      return {
        ...f,
        status: "error",
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }, []);

  const fill = useCallback((): FillResult[] => {
    const doc = getIframeDoc(iframeRef.current);
    if (!doc) {
      return fields.map((f) => ({
        ...f,
        status: "error",
        message:
          "Nu pot accesa documentul — pagina este cross-origin sau nu s-a încărcat.",
      }));
    }
    return fields.map((f) => fillOne(doc, f));
  }, [fields, fillOne]);

  const loadIframe = useCallback(
    async (href: string, navDelay: number): Promise<Document | null> => {
      nonceRef.current += 1;
      const targetNonce = nonceRef.current;
      const src = `/api/proxy?url=${encodeURIComponent(href)}&n=${targetNonce}`;
      setIframeSrc(src);

      // iframe-ul se montează abia după re-render (key se schimbă la fiecare rulare);
      // așteptăm iframe-ul proaspăt, cu noul nonce în src
      let iframe: HTMLIFrameElement | null = null;
      for (let i = 0; i < 200; i++) {
        iframe = iframeRef.current;
        if (iframe && iframe.src.includes(`n=${targetNonce}`)) break;
        await sleep(20);
      }
      if (!iframe || !iframe.src.includes(`n=${targetNonce}`)) return null;

      // așteptăm evenimentul load (cu verificare de readyState, ca să nu ratăm
      // un load deja încheiat din cauza cache-ului)
      await new Promise<void>((resolve) => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          iframe!.removeEventListener("load", onLoad);
          resolve();
        };
        const onLoad = () => finish();
        iframe!.addEventListener("load", onLoad);
        try {
          if (iframe!.contentWindow?.document?.readyState === "complete") {
            finish();
            return;
          }
        } catch {
          // ignorăm — așteptăm evenimentul load
        }
        setTimeout(finish, 20000);
      });
      await sleep(navDelay);
      return getIframeDoc(iframe);
    },
    [],
  );

  const runAutomation = useCallback(async () => {
    if (running) return;
    const value = targetUrl.trim();
    if (!value) {
      setProxyError("Introdu mai întâi URL-ul paginii țintă.");
      return;
    }
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      setProxyError("URL invalid. Format corect: http:// sau https://...");
      return;
    }
    if (!/^https?:$/.test(parsed.protocol)) {
      setProxyError("URL-ul trebuie să înceapă cu http:// sau https://");
      return;
    }

    setProxyError(null);
    stopRef.current = false;
    setRunning(true);
    setLoading(true);
    setLog([]);
    setResults(fields.map((f) => ({ ...f, status: "pending" as const })));

    const t0 = Date.now();
    const addLog = (text: string, status: LogStatus = "info") => {
      setLog((prev) => [
        ...prev,
        {
          id: t0 + prev.length,
          time: `${((Date.now() - t0) / 1000).toFixed(1)}s`,
          text,
          status,
        },
      ]);
    };
    const sp = SPEEDS[speed];
    const datesList = parseDates(datesText);

    addLog(
      `Pornire automatizare: ${fields.length} câmpuri, viteză „${sp.label}”`,
      "info",
    );
    addLog(`Navigare la ${parsed.href}`, "info");

    const doc = await loadIframe(parsed.href, sp.nav);
    if (!doc) {
      addLog(
        "Eroare la încărcarea paginii (timeout sau document inaccesibil).",
        "error",
      );
      setRunning(false);
      setLoading(false);
      return;
    }
    addLog("Pagina s-a încărcat.", "ok");

    const iframe = iframeRef.current;
    let curDoc: Document = doc;

    for (const f of fields) {
      if (stopRef.current) {
        addLog("Automatizare oprită de utilizator.", "warn");
        break;
      }
      const el = queryFirst(doc, f.selector);
      if (!el) {
        const res: FillResult = {
          ...f,
          status: "not-found",
          message: "Selectorul nu a găsit niciun element în pagină.",
        };
        setResults((prev) => prev.map((r) => (r.id === f.id ? res : r)));
        addLog(`Câmp „${f.label}” — selector negăsit (${f.selector})`, "warn");
        await sleep(sp.field);
        continue;
      }
      const unhighlight = highlightElement(doc, el, "field");
      const isTypedField =
        (f.type === "text" || f.type === "password") && f.value.length > 0;
      if (isTypedField && typingSimulation) {
        addLog(
          `Se tastează „${f.label}” (${f.value.length} caractere) ...`,
          "info",
        );
        try {
          await typeText(doc, el, f.value, sp.char);
          const res: FillResult = { ...f, status: "filled" };
          setResults((prev) => prev.map((r) => (r.id === f.id ? res : r)));
          showFlag(doc, el, `${f.label} = ${maskValue(f)}`);
          addLog(`„${f.label}” tastat caracter cu caracter.`, "ok");
        } catch (err) {
          const res: FillResult = {
            ...f,
            status: "error",
            message: err instanceof Error ? err.message : String(err),
          };
          setResults((prev) => prev.map((r) => (r.id === f.id ? res : r)));
          addLog(`„${f.label}” — eroare la tastare.`, "error");
        }
      } else {
        addLog(`Completare „${f.label}” = ${maskValue(f)} ...`, "info");
        await sleep(sp.field);
        const res = fillOne(doc, f);
        setResults((prev) => prev.map((r) => (r.id === f.id ? res : r)));
        if (res.status === "filled") {
          showFlag(doc, el, `${f.label} = ${maskValue(f)}`);
          addLog(`„${f.label}” completat cu succes.`, "ok");
        } else {
          addLog(`„${f.label}” — ${res.message ?? "eroare"}`, "error");
        }
      }
      unhighlight();
      await sleep(Math.round(sp.field / 2));
    }

    if (!stopRef.current && clickEnabled && clickSelector.trim()) {
      const btn = queryFirst(doc, clickSelector.trim());
      if (!btn) {
        addLog(`Butonul de login nu a fost găsit (${clickSelector}).`, "error");
      } else {
        const unhighlight = highlightElement(doc, btn, "click");
        addLog(`Apăsare buton Login (${clickSelector}) ...`, "info");
        await sleep(sp.click);
        injectAjaxSpy(doc);
        try {
          (btn as HTMLElement).click();
          showFlag(doc, btn, "Login apăsat ✓");
          addLog("Butonul Login a fost apăsat.", "ok");
        } catch (err) {
          addLog(
            `Eroare la apăsarea butonului: ${err instanceof Error ? err.message : String(err)}`,
            "error",
          );
        }
        setTimeout(unhighlight, 1500);
        await sleep(2000);

        // diagnostic: ce a răspuns serverul la AJAX-ul de login
        const spyW = doc.defaultView as SpyWindow | null;
        const spy = spyW?.__faSpy;
        if (spy && spy.status !== undefined) {
          const snippet = (spy.text ?? "").replace(/\s+/g, " ").trim();
          addLog(
            `Răspuns AJAX login: HTTP ${spy.status} — ${snippet ? snippet.slice(0, 180) : "(fără conținut)"}`,
            spy.status === 200 ? "info" : "error",
          );
        } else {
          addLog("Nicio cerere AJAX detectată după click-ul pe Login.", "warn");
        }
        const growl = readGrowlText(doc);
        if (growl) {
          addLog(`Mesaj server: ${growl}`, "warn");
        }
        const cookies = readCookies(doc);
        addLog(
          `Cookie-uri sesiune: ${cookies || "(niciunul)"}`,
          /jsessionid/i.test(cookies) ? "info" : "warn",
        );
      }
    } else if (!stopRef.current) {
      addLog("Pasul de apăsare Login este dezactivat.", "info");
    }

    // ---- Scenariu post-login: selectează data și apasă „Raport” pentru fiecare zi ----
    if (
      !stopRef.current &&
      clickEnabled &&
      postStepsEnabled &&
      datesList.length > 0 &&
      iframe
    ) {
      addLog(
        `Scenariu post-login: ${datesList.length} zile de procesat.`,
        "info",
      );
      addLog("Așteptare navigare după login (redirect)...", "info");
      const afterLoginDoc = await waitForLoginResult(iframe, curDoc, 10000);
      if (afterLoginDoc) {
        curDoc = afterLoginDoc;
      }
      if (queryFirst(curDoc, dateSelector.trim())) {
        addLog("Login reușit — pagina principală încărcată.", "ok");
      } else {
        addLog(
          "Login eșuat — pagina principală nu a apărut. Vezi diagnosticul de mai sus (răspuns AJAX / mesaj server / cookie-uri).",
          "error",
        );
      }

      const loggedIn = queryFirst(curDoc, dateSelector.trim()) !== null;
      if (!loggedIn) {
        addLog("Scenariul post-login a fost anulat (login nereușit).", "warn");
      }

      for (let di = 0; di < datesList.length && loggedIn; di++) {
        if (stopRef.current) {
          addLog("Automatizare oprită de utilizator.", "warn");
          break;
        }
        const date = datesList[di];
        addLog(`Ziua ${di + 1}/${datesList.length}: ${date}`, "info");

        // 1. selectăm data în calendarul PrimeFaces
        const dateEl = queryFirst(curDoc, dateSelector.trim());
        if (!dateEl) {
          addLog(`Câmpul Data (${dateSelector}) nu a fost găsit.`, "error");
          await sleep(sp.field);
          continue;
        }
        const unhDate = highlightElement(curDoc, dateEl, "field");
        if (typingSimulation) {
          await typeText(curDoc, dateEl, date, sp.char);
        } else {
          nativeSetter(dateEl, date);
          dispatchEvents(dateEl);
        }
        await waitForAjax(curDoc, 8000);
        showFlag(curDoc, dateEl, `Data = ${date}`);
        addLog(`Data ${date} selectată.`, "ok");
        unhDate();

        // 2. „Setare parametrii”
        if (setParamsSelector.trim()) {
          const spBtn = queryFirst(curDoc, setParamsSelector.trim());
          if (!spBtn) {
            addLog(
              `Butonul „Setare parametrii” (${setParamsSelector}) nu a fost găsit.`,
              "error",
            );
          } else {
            const unh = highlightElement(curDoc, spBtn, "click");
            addLog("Apăsare „Setare parametrii” ...", "info");
            await sleep(sp.click);
            (spBtn as HTMLElement).click();
            await waitForAjax(curDoc, 8000);
            showFlag(curDoc, spBtn, "Setare parametrii ✓");
            addLog("„Setare parametrii” apăsat.", "ok");
            setTimeout(unh, 1500);
          }
        }

        // 3. „Raport” (submit complet — posibilă navigare)
        if (reportSelector.trim()) {
          const rBtn = queryFirst(curDoc, reportSelector.trim());
          if (!rBtn) {
            addLog(
              `Butonul „Raport” (${reportSelector}) nu a fost găsit.`,
              "error",
            );
          } else {
            const unh = highlightElement(curDoc, rBtn, "click");
            addLog("Apăsare „Raport” ...", "info");
            await sleep(sp.click);
            (rBtn as HTMLElement).click();
            showFlag(curDoc, rBtn, "Raport apăsat ✓");
            addLog("„Raport” apăsat.", "ok");
            setTimeout(unh, 1500);
            await waitForIframeLoad(iframe, 4000);
            const newDoc = getIframeDoc(iframe);
            if (newDoc && newDoc !== curDoc) {
              curDoc = newDoc;
              addLog("Pagina a navigat după „Raport”; s-a reîncărcat.", "info");
            }
          }
        }

        // 4. buton suplimentar opțional (ex. confirmare dialog)
        if (extraSelector.trim()) {
          const exBtn = queryFirst(curDoc, extraSelector.trim());
          if (!exBtn) {
            addLog(
              `Butonul suplimentar (${extraSelector}) nu a fost găsit.`,
              "warn",
            );
          } else {
            const unh = highlightElement(curDoc, exBtn, "click");
            addLog(`Apăsare buton suplimentar (${extraSelector}) ...`, "info");
            await sleep(sp.click);
            (exBtn as HTMLElement).click();
            addLog("Buton suplimentar apăsat.", "ok");
            setTimeout(unh, 1500);
            await waitForIframeLoad(iframe, 4000);
            const nd = getIframeDoc(iframe);
            if (nd && nd !== curDoc) curDoc = nd;
          }
        }

        // 5. Insert Raport Individual Zilnic → pagina de creare → completare → Save
        if (!stopRef.current && insertEnabled) {
          const insBtn = queryFirst(curDoc, insertSelector.trim());
          if (!insBtn) {
            addLog(
              `Butonul „Insert Raport Individual Zilnic” (${insertSelector}) nu a fost găsit.`,
              "error",
            );
          } else {
            const unhIns = highlightElement(curDoc, insBtn, "click");
            addLog("Apăsare „Insert Raport Individual Zilnic” ...", "info");
            await sleep(sp.click);
            (insBtn as HTMLElement).click();
            setTimeout(unhIns, 1500);
            await waitForIframeLoad(iframe, 8000);
            const createDoc = getIframeDoc(iframe);
            if (createDoc && createDoc !== curDoc) curDoc = createDoc;

            if (queryFirst(curDoc, "#createForm\\:activitate_input")) {
              addLog("Pagina de creare raport încărcată.", "ok");

              for (const cf of fieldsCreate) {
                if (stopRef.current) break;
                const cel = queryFirst(curDoc, cf.selector);
                if (!cel) {
                  addLog(
                    `Câmp „${cf.label}” (${cf.selector}) nu a fost găsit.`,
                    "warn",
                  );
                  await sleep(Math.round(sp.field / 2));
                  continue;
                }
                const unhCf = highlightElement(curDoc, cel, "field");
                addLog(
                  `Completare „${cf.label}” = ${maskValue(cf)} ...`,
                  "info",
                );
                await sleep(Math.round(sp.field / 2));
                if (
                  (cf.type === "text" || cf.type === "password") &&
                  typingSimulation &&
                  cf.value.length > 0
                ) {
                  await typeText(curDoc, cel, cf.value, sp.char);
                } else {
                  fillOne(curDoc, cf);
                }
                await waitForAjax(curDoc, 8000);
                showFlag(curDoc, cel, `${cf.label} = ${maskValue(cf)}`);
                addLog(`„${cf.label}” completat.`, "ok");
                unhCf();
              }

              if (saveSelector.trim()) {
                const svBtn = queryFirst(curDoc, saveSelector.trim());
                if (!svBtn) {
                  addLog(
                    `Butonul Save (${saveSelector}) nu a fost găsit.`,
                    "error",
                  );
                } else {
                  const unhSv = highlightElement(curDoc, svBtn, "click");
                  addLog("Apăsare Save ...", "info");
                  await sleep(sp.click);
                  (svBtn as HTMLElement).click();
                  setTimeout(unhSv, 1500);
                  await waitForIframeLoad(iframe, 8000);
                  const afterSave = getIframeDoc(iframe);
                  if (afterSave && afterSave !== curDoc) {
                    curDoc = afterSave;
                    const rows = curDoc.querySelectorAll(
                      "#raportForm\\:raportTable tbody tr",
                    ).length;
                    addLog(
                      `Save efectuat — lista s-a reîncărcat (${rows} rânduri în tabel).`,
                      "ok",
                    );
                  } else {
                    const g = readGrowlText(curDoc);
                    addLog(
                      g
                        ? `Eroare la salvare: ${g}`
                        : "Nu s-a detectat navigarea după Save.",
                      "error",
                    );
                  }
                }
              }
            } else {
              const g = readGrowlText(curDoc);
              addLog(
                `Pagina de creare raport nu a apărut după Insert.${g ? ` Mesaj server: ${g}` : ""}`,
                "error",
              );
            }
          }
        }

        // 6. înapoi la I N D E X pentru ziua următoare
        if (!stopRef.current) {
          const idxBtn = queryFirst(curDoc, indexSelector.trim());
          if (!idxBtn) {
            addLog(
              `Butonul „I N D E X” (${indexSelector}) nu a fost găsit.`,
              "warn",
            );
          } else {
            const unhI = highlightElement(curDoc, idxBtn, "click");
            addLog(
              "Apăsare „I N D E X” — revenire pentru ziua următoare ...",
              "info",
            );
            await sleep(sp.click);
            (idxBtn as HTMLElement).click();
            setTimeout(unhI, 1500);
            await waitForIframeLoad(iframe, 8000);
            const idxDoc = getIframeDoc(iframe);
            if (idxDoc && idxDoc !== curDoc) curDoc = idxDoc;
            addLog("Înapoi pe pagina principală.", "info");
          }
        }

        await sleep(sp.field);
      }
    } else if (!stopRef.current && postStepsEnabled && clickEnabled) {
      addLog(
        "Scenariul post-login e activ, dar lista de zile este goală — completează zilele sau generează luna.",
        "warn",
      );
    }

    addLog("Automatizare finalizată.", "ok");
    setRunning(false);
    setLoading(false);
  }, [
    running,
    targetUrl,
    fields,
    speed,
    typingSimulation,
    clickEnabled,
    clickSelector,
    postStepsEnabled,
    dateSelector,
    setParamsSelector,
    reportSelector,
    extraSelector,
    insertEnabled,
    insertSelector,
    saveSelector,
    indexSelector,
    fieldsCreate,
    datesText,
    fillOne,
    loadIframe,
  ]);

  const refill = () => {
    if (!iframeSrc || running) return;
    setResults(fill());
  };

  const stopAutomation = () => {
    stopRef.current = true;
  };

  const handleIframeLoad = () => {
    setLoading(false);
  };

  // auto-rulare la lansare, după restaurarea configurației
  const runAutomationRef = useRef(runAutomation);
  useEffect(() => {
    runAutomationRef.current = runAutomation;
  }, [runAutomation]);

  const didAutoRunRef = useRef(false);
  useEffect(() => {
    if (hydrated && autoRun && !didAutoRunRef.current) {
      didAutoRunRef.current = true;
      const t = setTimeout(() => {
        runAutomationRef.current();
      }, 500);
      return () => clearTimeout(t);
    }
  }, [hydrated, autoRun]);

  // auto-scroll al consolei de execuție
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [log]);

  const updateField = (id: string, patch: Partial<FieldConfig>) => {
    setFields((prev) =>
      prev.map((f) => (f.id === id ? { ...f, ...patch } : f)),
    );
  };

  const removeField = (id: string) => {
    setFields((prev) => prev.filter((f) => f.id !== id));
  };

  const addField = () => {
    setFields((prev) => [
      ...prev,
      {
        id: uid(),
        label: `Câmp ${prev.length + 1}`,
        selector: "",
        value: "",
        type: "text",
      },
    ]);
  };

  const updateCreateField = (id: string, patch: Partial<FieldConfig>) => {
    setFieldsCreate((prev) =>
      prev.map((f) => (f.id === id ? { ...f, ...patch } : f)),
    );
  };

  const removeCreateField = (id: string) => {
    setFieldsCreate((prev) => prev.filter((f) => f.id !== id));
  };

  const addCreateField = () => {
    setFieldsCreate((prev) => [
      ...prev,
      {
        id: uid(),
        label: `Câmp ${prev.length + 1}`,
        selector: "",
        value: "",
        type: "text",
      },
    ]);
  };

  const toggleReveal = (id: string) => {
    setRevealed((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const generateMonth = () => {
    setDatesText(generateMonthDates(monthInput, skipWeekends).join("\n"));
  };

  const filledCount = results.filter((r) => r.status === "filled").length;

  return (
    <div className="min-h-full bg-zinc-50 font-sans text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <header className="border-b border-zinc-200 bg-white px-6 py-4 dark:border-zinc-800 dark:bg-zinc-900">
        <h1 className="text-xl font-bold tracking-tight">Form Autocomplete</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Automatizare live, pas cu pas, ca un test Selenium: pagina se încarcă
          în iframe, câmpurile se completează vizibil, apoi se apasă automat
          butonul Login.
        </p>
      </header>

      <main className="mx-auto flex max-w-7xl flex-col gap-6 px-6 py-6">
        <div className="grid gap-6 lg:grid-cols-[minmax(360px,430px)_1fr]">
          {/* Configurare */}
          <section className="flex flex-col gap-4 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <div>
              <label
                htmlFor="target-url"
                className="mb-1 block text-sm font-semibold"
              >
                URL-ul paginii țintă
              </label>
              <input
                id="target-url"
                type="text"
                value={targetUrl}
                onChange={(e) => setTargetUrl(e.target.value)}
                placeholder="http://localhost:8080/RaportIndividualZilnicWebAppV4/login.xhtml"
                className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-200 dark:border-zinc-700 dark:bg-zinc-950"
              />
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                Se poate testa local cu{" "}
                <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">
                  http://localhost:3000/sample-login.html
                </code>
              </p>
            </div>

            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                Câmpuri de completat
              </h2>
              <button
                onClick={addField}
                className="rounded-lg border border-zinc-300 px-2.5 py-1 text-xs font-semibold transition hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                + Adaugă câmp
              </button>
            </div>

            <FieldsEditor
              fields={fields}
              onChange={updateField}
              onRemove={removeField}
            />

            <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-950">
              <label className="flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  checked={clickEnabled}
                  onChange={(e) => setClickEnabled(e.target.checked)}
                  className="h-4 w-4"
                />
                Apasă automat butonul Login după completare
              </label>
              {clickEnabled && (
                <input
                  type="text"
                  value={clickSelector}
                  onChange={(e) => setClickSelector(e.target.value)}
                  placeholder="#loginForm\\:idlogin"
                  className="mt-2 w-full rounded-md border border-zinc-300 bg-white px-2 py-1 font-mono text-xs outline-none focus:border-blue-500 dark:border-zinc-700 dark:bg-zinc-900"
                />
              )}
            </div>

            <div className="flex items-center gap-2 text-sm">
              <span className="font-medium">Viteză:</span>
              <select
                value={speed}
                onChange={(e) => setSpeed(e.target.value as SpeedKey)}
                className="flex-1 rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs outline-none focus:border-blue-500 dark:border-zinc-700 dark:bg-zinc-900"
              >
                {(Object.keys(SPEEDS) as SpeedKey[]).map((k) => (
                  <option key={k} value={k}>
                    {SPEEDS[k].label}
                  </option>
                ))}
              </select>
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={typingSimulation}
                onChange={(e) => setTypingSimulation(e.target.checked)}
                className="h-4 w-4"
              />
              Simulează tastarea (caracter cu caracter)
            </label>

            <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-950">
              <label className="flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  checked={postStepsEnabled}
                  onChange={(e) => setPostStepsEnabled(e.target.checked)}
                  className="h-4 w-4"
                />
                Continuă după login: selectează data și apasă „Raport”
              </label>
              {postStepsEnabled && (
                <div className="mt-2 flex flex-col gap-2">
                  <input
                    type="text"
                    value={dateSelector}
                    onChange={(e) => setDateSelector(e.target.value)}
                    placeholder="Câmp Data (ex. #j_idt10\\:j_idt13\\:dataAleasa_input)"
                    className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1 font-mono text-xs outline-none focus:border-blue-500 dark:border-zinc-700 dark:bg-zinc-900"
                  />
                  <input
                    type="text"
                    value={setParamsSelector}
                    onChange={(e) => setSetParamsSelector(e.target.value)}
                    placeholder="Buton „Setare parametrii” (ex. #j_idt10\\:j_idt13\\:j_idt27)"
                    className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1 font-mono text-xs outline-none focus:border-blue-500 dark:border-zinc-700 dark:bg-zinc-900"
                  />
                  <input
                    type="text"
                    value={reportSelector}
                    onChange={(e) => setReportSelector(e.target.value)}
                    placeholder="Buton „Raport” (ex. #j_idt10\\:j_idt13\\:raportItemsListButton-id)"
                    className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1 font-mono text-xs outline-none focus:border-blue-500 dark:border-zinc-700 dark:bg-zinc-900"
                  />
                  <input
                    type="text"
                    value={extraSelector}
                    onChange={(e) => setExtraSelector(e.target.value)}
                    placeholder="Buton suplimentar după Raport (opțional)"
                    className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1 font-mono text-xs outline-none focus:border-blue-500 dark:border-zinc-700 dark:bg-zinc-900"
                  />

                  <div className="flex items-center gap-2">
                    <input
                      type="month"
                      value={monthInput}
                      onChange={(e) => setMonthInput(e.target.value)}
                      className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs outline-none focus:border-blue-500 dark:border-zinc-700 dark:bg-zinc-900"
                    />
                    <button
                      onClick={generateMonth}
                      className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-semibold transition hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                    >
                      Generează zilele lunii
                    </button>
                  </div>
                  <label className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={skipWeekends}
                      onChange={(e) => setSkipWeekends(e.target.checked)}
                      className="h-3.5 w-3.5"
                    />
                    Doar zile lucrătoare (L–V)
                  </label>
                  <textarea
                    value={datesText}
                    onChange={(e) => setDatesText(e.target.value)}
                    rows={4}
                    placeholder={
                      "Zile de procesat, una pe rând (dd.MM.yyyy):\n31.08.2026\n01.09.2026"
                    }
                    className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1 font-mono text-xs outline-none focus:border-blue-500 dark:border-zinc-700 dark:bg-zinc-900"
                  />
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    {parseDates(datesText).length} zile în listă
                  </p>
                </div>
              )}
            </div>

            <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-950">
              <label className="flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  checked={insertEnabled}
                  onChange={(e) => setInsertEnabled(e.target.checked)}
                  className="h-4 w-4"
                />
                Insert Raport + completează formularul de creare + Save
              </label>
              {insertEnabled && (
                <div className="mt-2 flex flex-col gap-2">
                  <input
                    type="text"
                    value={insertSelector}
                    onChange={(e) => setInsertSelector(e.target.value)}
                    placeholder="Buton „Insert Raport Individual Zilnic” (ex. #raportForm\\:j_idt96)"
                    className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1 font-mono text-xs outline-none focus:border-blue-500 dark:border-zinc-700 dark:bg-zinc-900"
                  />
                  <input
                    type="text"
                    value={saveSelector}
                    onChange={(e) => setSaveSelector(e.target.value)}
                    placeholder='Buton Save (ex. input[name="createForm\:j_idt121"])'
                    className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1 font-mono text-xs outline-none focus:border-blue-500 dark:border-zinc-700 dark:bg-zinc-900"
                  />
                  <input
                    type="text"
                    value={indexSelector}
                    onChange={(e) => setIndexSelector(e.target.value)}
                    placeholder="Buton „I N D E X” pentru ziua următoare (ex. #j_idt16)"
                    className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1 font-mono text-xs outline-none focus:border-blue-500 dark:border-zinc-700 dark:bg-zinc-900"
                  />

                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                      Câmpuri pagina de creare
                    </span>
                    <button
                      onClick={addCreateField}
                      className="rounded-md border border-zinc-300 px-2 py-1 text-xs font-semibold transition hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                    >
                      + Adaugă câmp
                    </button>
                  </div>
                  <FieldsEditor
                    fields={fieldsCreate}
                    onChange={updateCreateField}
                    onRemove={removeCreateField}
                  />
                </div>
              )}
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={autoRun}
                onChange={(e) => setAutoRun(e.target.checked)}
                className="h-4 w-4"
              />
              Rulează automat la lansarea aplicației
            </label>

            <div className="flex gap-2">
              <button
                onClick={runAutomation}
                disabled={running}
                className="flex-1 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                ▶ Rulează automatizarea (live)
              </button>
              {running ? (
                <button
                  onClick={stopAutomation}
                  className="rounded-lg border border-red-300 px-4 py-2 text-sm font-semibold text-red-600 transition hover:bg-red-50 dark:border-red-900 dark:hover:bg-red-950"
                >
                  ■ Oprește
                </button>
              ) : (
                <button
                  onClick={refill}
                  disabled={!iframeSrc}
                  className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-semibold transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                >
                  Completare instant
                </button>
              )}
            </div>

            {proxyError && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
                {proxyError}
              </p>
            )}
          </section>

          {/* Pagina încărcată */}
          <section className="flex flex-col rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                Pagina țintă
              </h2>
              {loading && (
                <span className="inline-flex items-center gap-2 text-xs text-blue-600">
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
                  Se încarcă...
                </span>
              )}
            </div>
            {iframeSrc && (
              <p className="mb-2 truncate font-mono text-xs text-zinc-400 dark:text-zinc-500">
                {iframeSrc}
              </p>
            )}
            {iframeSrc ? (
              <iframe
                key={iframeSrc}
                ref={iframeRef}
                src={iframeSrc}
                title="Pagina țintă"
                onLoad={handleIframeLoad}
                sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-downloads"
                className="min-h-150 w-full flex-1 rounded-lg border border-zinc-200 bg-white dark:border-zinc-800"
              />
            ) : (
              <div className="flex min-h-150 flex-1 items-center justify-center rounded-lg border border-dashed border-zinc-300 text-sm text-zinc-400 dark:border-zinc-700">
                Pagina nu este încărcată. Apasă „▶ Rulează automatizarea (live)”
                pentru a vedea completarea pas cu pas.
              </div>
            )}

            <div className="mt-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                Consolă de execuție
              </h2>
              {running && (
                <span className="inline-flex items-center gap-2 text-xs font-semibold text-green-600">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-green-500" />
                  rulează...
                </span>
              )}
            </div>
            <div
              ref={logRef}
              className="mt-2 h-44 overflow-auto rounded-lg bg-zinc-950 p-3 font-mono text-xs leading-5"
            >
              {log.length === 0 ? (
                <p className="text-zinc-600">
                  {`>`} Așteptare rulare. Pașii apar aici în timp real.
                </p>
              ) : (
                log.map((entry) => (
                  <p
                    key={entry.id}
                    className={`mb-0.5 ${LOG_COLORS[entry.status]}`}
                  >
                    <span className="text-zinc-600">[{entry.time}]</span>{" "}
                    {LOG_MARKS[entry.status]} {entry.text}
                  </p>
                ))
              )}
            </div>
          </section>
        </div>

        {/* Rezultate */}
        <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              Câmpuri completate
            </h2>
            {results.length > 0 && (
              <span className="text-sm font-semibold">
                {filledCount} din {results.length} completate
              </span>
            )}
          </div>

          {results.length === 0 ? (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Încă nu a fost încărcată nicio pagină. Rezultatele vor apărea aici
              după completare.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
                    <th className="py-2 pr-4 font-semibold">Stare</th>
                    <th className="py-2 pr-4 font-semibold">Câmp</th>
                    <th className="py-2 pr-4 font-semibold">Selector</th>
                    <th className="py-2 pr-4 font-semibold">
                      Valoare introdusă
                    </th>
                    <th className="py-2 font-semibold">Detalii</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((r) => (
                    <tr
                      key={r.id}
                      className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/60"
                    >
                      <td className="py-2 pr-4">{statusBadge(r.status)}</td>
                      <td className="py-2 pr-4 font-medium">{r.label}</td>
                      <td className="py-2 pr-4 font-mono text-xs text-zinc-500 dark:text-zinc-400">
                        {r.selector || "—"}
                      </td>
                      <td className="py-2 pr-4 font-mono text-xs">
                        {r.type === "password" ? (
                          <span className="inline-flex items-center gap-2">
                            <span>
                              {revealed[r.id]
                                ? r.value
                                : r.value
                                  ? "•".repeat(Math.min(r.value.length, 12))
                                  : "—"}
                            </span>
                            {r.value && (
                              <button
                                onClick={() => toggleReveal(r.id)}
                                className="text-xs text-blue-600 hover:underline"
                              >
                                {revealed[r.id] ? "ascunde" : "arată"}
                              </button>
                            )}
                          </span>
                        ) : (
                          r.value || "—"
                        )}
                      </td>
                      <td className="py-2 text-xs text-zinc-500 dark:text-zinc-400">
                        {r.message ?? ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <p className="text-xs text-zinc-400 dark:text-zinc-500">
          Notă: paginile sunt încărcate printr-un proxy local same-origin, iar
          valorile sunt salvate doar în localStorage-ul browserului tău.
          Completează parola doar pe pagini în care ai încredere.
        </p>
      </main>
    </div>
  );
}
