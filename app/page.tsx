"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Mic,
  MicOff,
  Calculator,
  History,
  Printer,
  Send,
  Sparkles,
} from "lucide-react";

type FormState = {
  clientName: string;
  clientEmail: string;
  facilityName: string;
  facilityType: string;
  floorMaterial: string;
  areaM2: string;
  bathroomsCount: string;
  windowsM2: string;
  riskLevel: string;
  trafficLevel: string;
  disinfectionLevel: string;
  eventsPerMonth: string;
  frequencyType: string;
  discountCode: string;
};

type Quote = Record<string, unknown> & {
  id: string;
  clientName: string;
  facilityName: string;
  finalPrice: number;
  createdAt: string;
  status: string;
  lineItems?: { concept: string; amountUsd: number; explanation: string }[];
};

const initial: FormState = {
  clientName: "",
  clientEmail: "",
  facilityName: "",
  facilityType: "OFFICE",
  floorMaterial: "TILE",
  areaM2: "",
  bathroomsCount: "0",
  windowsM2: "0",
  riskLevel: "MEDIUM",
  trafficLevel: "MEDIUM",
  disinfectionLevel: "BASIC",
  eventsPerMonth: "12",
  frequencyType: "WEEKLY",
  discountCode: "",
};

// ---- voz: parser ----
const NUMBER_WORDS = new Map<string, number>([
  ["cero", 0],
  ["un", 1],
  ["uno", 1],
  ["una", 1],
  ["dos", 2],
  ["tres", 3],
  ["cuatro", 4],
  ["cinco", 5],
  ["seis", 6],
  ["siete", 7],
  ["ocho", 8],
  ["nueve", 9],
  ["diez", 10],
  ["once", 11],
  ["doce", 12],
  ["trece", 13],
  ["catorce", 14],
  ["quince", 15],
  ["dieciseis", 16],
  ["diecisiete", 17],
  ["dieciocho", 18],
  ["diecinueve", 19],
  ["veinte", 20],
  ["veintiun", 21],
  ["veintiuno", 21],
  ["veintiuna", 21],
  ["veintidos", 22],
  ["veintitres", 23],
  ["veinticuatro", 24],
  ["veinticinco", 25],
  ["veintiseis", 26],
  ["veintisiete", 27],
  ["veintiocho", 28],
  ["veintinueve", 29],
  ["treinta", 30],
  ["cuarenta", 40],
  ["cincuenta", 50],
  ["sesenta", 60],
  ["setenta", 70],
  ["ochenta", 80],
  ["noventa", 90],
  ["cien", 100],
  ["ciento", 100],
  ["doscientos", 200],
  ["doscientas", 200],
  ["trescientos", 300],
  ["trescientas", 300],
  ["cuatrocientos", 400],
  ["cuatrocientas", 400],
  ["quinientos", 500],
  ["quinientas", 500],
  ["seiscientos", 600],
  ["seiscientas", 600],
  ["setecientos", 700],
  ["setecientas", 700],
  ["ochocientos", 800],
  ["ochocientas", 800],
  ["novecientos", 900],
  ["novecientas", 900],
  ["mil", 1000],
]);

// "doscientos cincuenta" -> "250", "treinta y cinco" -> "35".
function wordsToDigits(text: string): string {
  const tokens = text.split(" ");
  const out: string[] = [];
  let i = 0;

  while (i < tokens.length) {
    if (!NUMBER_WORDS.has(tokens[i])) {
      out.push(tokens[i]);
      i++;
      continue;
    }

    let total = 0;
    let current = 0;

    while (i < tokens.length) {
      const w = tokens[i];
      const v = NUMBER_WORDS.get(w);

      if (v !== undefined) {
        if (v === 1000) {
          total += (current || 1) * 1000;
          current = 0;
        } else {
          current += v;
        }
        i++;
      } else if (
        w === "y" &&
        current % 100 >= 30 &&
        current % 10 === 0 &&
        NUMBER_WORDS.has(tokens[i + 1] ?? "")
      ) {
        i++; // "treinta Y cinco"
      } else {
        break;
      }
    }

    out.push(String(total + current));
  }

  return out.join(" ");
}

// Minúsculas, sin tildes, "m²" -> "m2", sin signos y con números en dígitos.
function normalizeSpeech(raw: string): string {
  const base = raw
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[;:!?¡¿()"“”]/g, " ")
    .replace(/[,.](?=\s|$)/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return wordsToDigits(base);
}

function parseTranscript(transcript: string): Partial<FormState> {
  const t = normalizeSpeech(transcript);
  const patch: Partial<FormState> = {};
  const toNum = (s: string) => Number(s.replace(",", "."));
  const NUM = "([0-9]+(?:[.,][0-9]+)?)";
  const M2 = "(?:metros cuadrados|metro cuadrado|metros|metro|m2)";

  // Ventanas: "ventanas de 20 metros cuadrados" o "20 metros cuadrados de ventanas".
  let rest = t;
  const windowPatterns = [
    new RegExp(`ventanas?\\s*(?:de|con|por|son)?\\s*${NUM}\\s*${M2}`),
    new RegExp(`${NUM}\\s*${M2}\\s*(?:de\\s+)?ventanas?`),
  ];
  for (const re of windowPatterns) {
    const m = rest.match(re);
    if (m) {
      patch.windowsM2 = String(toNum(m[1]));
      rest = rest.replace(m[0], " "); // para no confundirlo con la superficie
      break;
    }
  }

  const area = rest.match(new RegExp(`${NUM}\\s*${M2}`));
  if (area) patch.areaM2 = String(toNum(area[1]));

  const baths = t.match(
    new RegExp(`${NUM}\\s*(?:banos?|servicios higienicos|sshh)`),
  );
  if (baths) patch.bathroomsCount = String(Math.round(toNum(baths[1])));

  const perWeek = t.match(
    new RegExp(
      `${NUM}\\s*(?:veces|vez|visitas?|dias)\\s*(?:por|a la|cada|en la|x)\\s*semana`,
    ),
  );
  const perMonth = t.match(
    new RegExp(
      `${NUM}\\s*(?:veces|vez|visitas?)\\s*(?:por|al|cada|en el)\\s*mes`,
    ),
  );
  if (perWeek) {
    patch.eventsPerMonth = String(Math.round((toNum(perWeek[1]) * 52) / 12));
  } else if (perMonth) {
    patch.eventsPerMonth = String(Math.round(toNum(perMonth[1])));
  } else if (/todos los dias|diari[oa]|cada dia/.test(t)) {
    patch.eventsPerMonth = "30";
  }

  if (/puntual|una sola vez|una vez/.test(t)) patch.frequencyType = "SPOT";
  else if (/todos los dias|diari[oa]|cada dia|lunes a viernes/.test(t))
    patch.frequencyType = "MONTHLY_DAILY";
  else if (/semanal|por semana|cada semana/.test(t))
    patch.frequencyType = "WEEKLY";

  if (t.includes("oficina")) patch.facilityType = "OFFICE";
  if (/\b(casa|vivienda|residencia|residencial|departamento)\b/.test(t))
    patch.facilityType = "RESIDENTIAL";
  if (/hospital|clinic|consultorio/.test(t)) patch.facilityType = "HEALTH";
  if (/industrial|fabrica|bodega|planta/.test(t))
    patch.facilityType = "INDUSTRIAL";

  if (/porcelanato|baldosa|ceramica/.test(t)) patch.floorMaterial = "TILE";
  if (t.includes("vinilo")) patch.floorMaterial = "VINYL";
  if (t.includes("alfombra")) patch.floorMaterial = "CARPET";
  if (t.includes("marmol")) patch.floorMaterial = "MARBLE";

  return patch;
}
// ---- fin parser ----

export default function Home() {
  const [form, setForm] = useState<FormState>(initial);
  const [transcript, setTranscript] = useState("");
  const [listening, setListening] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [applyMsg, setApplyMsg] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [history, setHistory] = useState<Quote[]>([]);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const listeningRef = useRef(false);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Texto ya confirmado (final) por el reconocimiento o escrito a mano.
  const finalTranscriptRef = useRef("");
  const [tab, setTab] = useState<"new" | "history">("new");

  const total = useMemo(
    () =>
      quote
        ? Number(quote.finalPrice).toLocaleString("es-EC", {
            style: "currency",
            currency: "USD",
          })
        : "Pendiente de cálculo",
    [quote],
  );

  useEffect(() => {
    return () => {
      listeningRef.current = false;

      if (restartTimerRef.current) {
        clearTimeout(restartTimerRef.current);
      }

      recognitionRef.current?.abort();
      recognitionRef.current = null;
    };
  }, []);

  async function loadHistory() {
    try {
      const r = await fetch("/api/quotes");
      const d = await r.json();
      if (r.ok) setHistory(d.quotes || []);
    } catch {}
  }

  useEffect(() => {
    void loadHistory();
  }, []);

  function update(k: keyof FormState, v: string) {
    setForm((p) => ({ ...p, [k]: v }));
    setQuote(null);
  }

  function startVoice() {
    if (listeningRef.current) return;

    const w = window as typeof window & {
      SpeechRecognition?: new () => SpeechRecognition;
      webkitSpeechRecognition?: new () => SpeechRecognition;
    };

    const SR = w.SpeechRecognition || w.webkitSpeechRecognition;

    if (!SR) {
      setError(
        "Reconocimiento de voz no disponible. Usa Chrome o Edge actualizado.",
      );
      return;
    }

    const rec = new SR();

    rec.lang = "es-EC";
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    recognitionRef.current = rec;
    listeningRef.current = true;
    // Parte del texto que ya hay en la caja (por si el usuario escribió algo).
    finalTranscriptRef.current = transcript.trim();

    setListening(true);
    setError("");

    rec.onstart = () => console.log("[voz] iniciado");
    rec.onaudiostart = () => console.log("[voz] micrófono capturando audio");
    rec.onspeechstart = () => console.log("[voz] se detectó voz");

    rec.onresult = (event: any) => {
      let interim = "";

      // resultIndex = primer resultado nuevo o modificado en este evento.
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const text = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          // Lo final se acumula una sola vez en la referencia.
          finalTranscriptRef.current =
            `${finalTranscriptRef.current} ${text}`.trim();
        } else {
          // Lo provisional se recalcula en cada evento, no se acumula.
          interim += text;
        }
      }

      setTranscript(`${finalTranscriptRef.current} ${interim}`.trim());
    };

    rec.onerror = (event: any) => {
      console.warn("[voz] error:", event.error);

      if (
        event.error === "not-allowed" ||
        event.error === "service-not-allowed"
      ) {
        listeningRef.current = false;
        setListening(false);
        setError("Permite el acceso al micrófono en el navegador.");
      } else if (event.error === "audio-capture") {
        listeningRef.current = false;
        setListening(false);
        setError("No se detectó un micrófono disponible.");
      } else if (event.error === "network") {
        // En Brave (y navegadores sin servicios de voz de Google) siempre
        // falla así. Se detiene para no reintentar en bucle.
        listeningRef.current = false;
        recognitionRef.current = null;
        setListening(false);
        try {
          rec.abort();
        } catch {}
        setError(
          "No se pudo conectar con el servicio de reconocimiento de voz. Brave lo bloquea: prueba en Google Chrome o Microsoft Edge. También puedes escribir la descripción en el cuadro de texto.",
        );
      } else if (event.error === "no-speech") {
        setError(
          "No se detecta voz. Revisa que el micrófono correcto esté seleccionado y no silenciado.",
        );
      } else if (event.error !== "aborted") {
        setError(`Error de reconocimiento: ${event.error}`);
      }
    };

    rec.onend = () => {
      if (recognitionRef.current !== rec) return;

      if (!listeningRef.current) {
        setListening(false);
        recognitionRef.current = null;
        return;
      }

      if (restartTimerRef.current) {
        clearTimeout(restartTimerRef.current);
      }

      restartTimerRef.current = setTimeout(() => {
        if (!listeningRef.current || recognitionRef.current !== rec) {
          return;
        }

        try {
          rec.start();
        } catch (error) {
          console.warn("No se pudo reiniciar el reconocimiento:", error);
        }
      }, 300);
    };

    try {
      rec.start();
    } catch (error) {
      listeningRef.current = false;
      recognitionRef.current = null;
      setListening(false);
      setError("No se pudo iniciar el micrófono. Intenta nuevamente.");
      console.error(error);
    }
  }

  function stopVoice() {
    listeningRef.current = false;

    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }

    const rec = recognitionRef.current;
    recognitionRef.current = null;

    if (rec) {
      // Se anula solo onend (para que no reinicie); onresult se deja activo
      // para no perder el último fragmento que llega tras stop().
      rec.onend = null;

      try {
        rec.stop();
      } catch {
        // Puede haberse detenido ya.
      }
    }

    setListening(false);
  }

  function applyTranscript() {
    if (!transcript.trim()) {
      setApplyMsg({
        ok: false,
        text: "Primero dicta o escribe una descripción en el cuadro de texto.",
      });
      return;
    }

    const patch = parseTranscript(transcript);
    const labels: Record<keyof FormState, string> = {
      clientName: "Cliente",
      clientEmail: "Correo",
      facilityName: "Instalación",
      facilityType: "Tipo de instalación",
      floorMaterial: "Material del piso",
      areaM2: "Superficie (m²)",
      bathroomsCount: "Baños",
      windowsM2: "Ventanas (m²)",
      riskLevel: "Riesgo",
      trafficLevel: "Tráfico",
      disinfectionLevel: "Desinfección",
      eventsPerMonth: "Visitas al mes",
      frequencyType: "Frecuencia",
      discountCode: "Descuento",
    };
    const numeric: (keyof FormState)[] = [
      "areaM2",
      "bathroomsCount",
      "windowsM2",
      "eventsPerMonth",
    ];

    const keys = Object.keys(patch) as (keyof FormState)[];

    if (keys.length === 0) {
      setApplyMsg({
        ok: false,
        text: "No se reconoció ningún dato. Prueba con algo como: “oficina de 250 metros cuadrados, 3 baños, ventanas de 20 metros cuadrados, 3 veces por semana”.",
      });
      return;
    }

    setForm((p) => ({ ...p, ...patch }));
    setQuote(null);
    setError("");

    const detail = keys
      .map((k) =>
        numeric.includes(k) ? `${labels[k]}: ${patch[k]}` : labels[k],
      )
      .join(" · ");

    setApplyMsg({
      ok: true,
      text: `Se aplicaron ${keys.length} campo(s) → ${detail}. Revisa los datos antes de calcular.`,
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setQuote(null);
    try {
      const payload = {
        ...form,
        areaM2: Number(form.areaM2),
        bathroomsCount: Number(form.bathroomsCount),
        windowsM2: Number(form.windowsM2),
        eventsPerMonth: Number(form.eventsPerMonth),
      };
      const r = await fetch("/api/quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "No se pudo cotizar");
      setQuote(d.quote);
      await loadHistory();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error inesperado");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <header className="bg-white border-b border-slate-200">
        <div className="mx-auto max-w-7xl px-5 py-5 flex items-center justify-between">
          <div>
            <div className="text-xs font-bold uppercase tracking-[.22em] text-emerald-700">
              CleanQuote
            </div>
            <h1 className="text-2xl font-bold mt-1">
              Cotización de servicios de limpieza
            </h1>
          </div>
          <div className="text-sm text-slate-500">
            MVP · tarifas administradas
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-5 py-8">
        <nav className="flex gap-2 mb-6">
          <button
            onClick={() => setTab("new")}
            className={`rounded-xl px-4 py-2 font-semibold ${
              tab === "new" ? "bg-emerald-700 text-white" : "bg-white border"
            }`}
          >
            <Calculator className="inline mr-2 h-4 w-4" />
            Nueva cotización
          </button>
          <button
            onClick={() => {
              setTab("history");
              void loadHistory();
            }}
            className={`rounded-xl px-4 py-2 font-semibold ${
              tab === "history"
                ? "bg-emerald-700 text-white"
                : "bg-white border"
            }`}
          >
            <History className="inline mr-2 h-4 w-4" />
            Historial ({history.length})
          </button>
        </nav>

        {tab === "history" ? (
          <section className="rounded-2xl bg-white border p-5">
            <h2 className="text-xl font-bold mb-4">Cotizaciones recientes</h2>
            {history.length === 0 ? (
              <p className="text-slate-500">
                No hay cotizaciones guardadas o la base de datos no está
                configurada.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b text-slate-500">
                      <th className="p-3">Fecha</th>
                      <th className="p-3">Cliente</th>
                      <th className="p-3">Instalación</th>
                      <th className="p-3">Total</th>
                      <th className="p-3">Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((q) => (
                      <tr key={q.id} className="border-b">
                        <td className="p-3">
                          {new Date(q.createdAt).toLocaleDateString("es-EC")}
                        </td>
                        <td className="p-3">{q.clientName}</td>
                        <td className="p-3">{q.facilityName}</td>
                        <td className="p-3 font-semibold">
                          {Number(q.finalPrice).toLocaleString("es-EC", {
                            style: "currency",
                            currency: "USD",
                          })}
                        </td>
                        <td className="p-3">{q.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[1.4fr_.8fr]">
            <section className="rounded-2xl bg-white border border-slate-200 p-5 md:p-7">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-xl font-bold">Datos del servicio</h2>
                  <p className="text-sm text-slate-500 mt-1">
                    Completa los campos o dicta una descripción para rellenar
                    algunos automáticamente.
                  </p>
                </div>
                <span className="rounded-full bg-emerald-50 text-emerald-800 px-3 py-1 text-xs font-bold">
                  Formulario editable
                </span>
              </div>

              <div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50/60 p-4">
                <div className="flex items-center gap-2 font-semibold">
                  <Sparkles className="h-5 w-5 text-emerald-700" />
                  Captura por voz (beta)
                </div>
                <p className="text-sm text-slate-600 mt-1">
                  Ejemplo: “Oficina de 250 metros cuadrados, tres baños,
                  ventanas de 20 metros cuadrados y limpieza tres veces por
                  semana”.
                </p>
                <div className="flex flex-wrap gap-2 mt-3">
                  <button
                    type="button"
                    onClick={listening ? stopVoice : startVoice}
                    className={`rounded-lg px-4 py-2 font-semibold text-sm ${
                      listening
                        ? "bg-red-600 text-white"
                        : "bg-emerald-700 text-white"
                    }`}
                  >
                    {listening ? (
                      <>
                        <MicOff className="inline mr-2 h-4 w-4" />
                        Detener
                      </>
                    ) : (
                      <>
                        <Mic className="inline mr-2 h-4 w-4" />
                        Hablar
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={applyTranscript}
                    className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold"
                  >
                    Aplicar al formulario
                  </button>
                </div>
                {applyMsg && (
                  <p
                    role="status"
                    className={`mt-3 rounded-lg border p-2.5 text-sm ${
                      applyMsg.ok
                        ? "border-emerald-300 bg-white text-emerald-900"
                        : "border-amber-300 bg-amber-50 text-amber-900"
                    }`}
                  >
                    {applyMsg.text}
                  </p>
                )}
                {listening && (
                  <p className="mt-2 text-sm font-medium text-red-600">
                    ● Escuchando…
                  </p>
                )}
                <textarea
                  value={transcript}
                  onChange={(e) => {
                    setTranscript(e.target.value);
                    // Mantiene sincronizado lo escrito a mano con lo dictado.
                    finalTranscriptRef.current = e.target.value.trim();
                  }}
                  rows={3}
                  placeholder="La transcripción aparecerá aquí. También puedes escribirla…"
                  className="mt-3 w-full rounded-lg border border-slate-300 bg-white p-3 text-sm focus:outline-2 focus:outline-emerald-600"
                />
              </div>

              <form onSubmit={submit} className="mt-6 space-y-6">
                <div>
                  <h3 className="font-bold mb-3">Cliente</h3>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field
                      label="Nombre del cliente"
                      value={form.clientName}
                      onChange={(v) => update("clientName", v)}
                      required
                    />
                    <Field
                      label="Correo electrónico (opcional)"
                      type="email"
                      value={form.clientEmail}
                      onChange={(v) => update("clientEmail", v)}
                    />
                    <Field
                      label="Nombre de la instalación"
                      value={form.facilityName}
                      onChange={(v) => update("facilityName", v)}
                      required
                    />
                  </div>
                </div>

                <div>
                  <h3 className="font-bold mb-3">Características</h3>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Select
                      label="Tipo de instalación"
                      value={form.facilityType}
                      onChange={(v) => update("facilityType", v)}
                      options={[
                        ["OFFICE", "Oficina"],
                        ["RESIDENTIAL", "Residencial"],
                        ["HEALTH", "Salud"],
                        ["INDUSTRIAL", "Industrial"],
                      ]}
                    />
                    <Select
                      label="Material del piso"
                      value={form.floorMaterial}
                      onChange={(v) => update("floorMaterial", v)}
                      options={[
                        ["TILE", "Baldosa / porcelanato"],
                        ["VINYL", "Vinilo"],
                        ["CARPET", "Alfombra"],
                        ["MARBLE", "Mármol"],
                      ]}
                    />
                    <Field
                      label="Superficie (m²)"
                      type="number"
                      min="0.01"
                      value={form.areaM2}
                      onChange={(v) => update("areaM2", v)}
                      required
                    />
                    <Field
                      label="Cantidad de baños"
                      type="number"
                      min="0"
                      step="1"
                      value={form.bathroomsCount}
                      onChange={(v) => update("bathroomsCount", v)}
                      required
                    />
                    <Field
                      label="Ventanas (m²)"
                      type="number"
                      min="0"
                      value={form.windowsM2}
                      onChange={(v) => update("windowsM2", v)}
                      required
                    />
                    <Field
                      label="Visitas al mes"
                      type="number"
                      min="0.01"
                      value={form.eventsPerMonth}
                      onChange={(v) => update("eventsPerMonth", v)}
                      required
                    />
                    <Select
                      label="Frecuencia de servicio"
                      value={form.frequencyType}
                      onChange={(v) => update("frequencyType", v)}
                      options={[
                        ["SPOT", "Puntual"],
                        ["WEEKLY", "Semanal / recurrente"],
                        ["MONTHLY_DAILY", "Diaria (lunes a viernes)"],
                      ]}
                    />
                    <Select
                      label="Nivel de riesgo"
                      value={form.riskLevel}
                      onChange={(v) => update("riskLevel", v)}
                      options={[
                        ["LOW", "Bajo"],
                        ["MEDIUM", "Medio"],
                        ["HIGH", "Alto"],
                      ]}
                    />
                    <Select
                      label="Tráfico"
                      value={form.trafficLevel}
                      onChange={(v) => update("trafficLevel", v)}
                      options={[
                        ["LOW", "Bajo"],
                        ["MEDIUM", "Medio"],
                        ["HIGH", "Alto"],
                      ]}
                    />
                    <Select
                      label="Desinfección"
                      value={form.disinfectionLevel}
                      onChange={(v) => update("disinfectionLevel", v)}
                      options={[
                        ["BASIC", "Básica"],
                        ["STANDARD_SPOT", "Estándar puntual"],
                        ["CLINICAL", "Clínica"],
                      ]}
                    />
                    <Field
                      label="Código de descuento autorizado (opcional)"
                      value={form.discountCode}
                      onChange={(v) => update("discountCode", v)}
                    />
                  </div>
                </div>

                {error && (
                  <div
                    role="alert"
                    className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
                  >
                    {error}
                  </div>
                )}

                <button
                  disabled={busy}
                  className="w-full rounded-xl bg-emerald-700 px-5 py-3 font-bold text-white hover:bg-emerald-800 disabled:opacity-50"
                >
                  {busy
                    ? "Calculando y guardando…"
                    : "Calcular y guardar cotización"}
                </button>
              </form>
            </section>

            <aside className="space-y-5">
              <section className="rounded-2xl bg-slate-900 p-6 text-white">
                <p className="text-sm text-slate-300">Resultado</p>
                <h2 className="text-3xl font-bold mt-2">{total}</h2>
                <p className="text-sm text-slate-400 mt-2">
                  El total aparece solo cuando se llenan todos los campos, luego
                  puedes descargar un pdf
                </p>

                {quote && (
                  <>
                    <div className="mt-5 space-y-3 border-t border-white/15 pt-4">
                      {quote.lineItems?.map((l, i) => (
                        <div
                          key={i}
                          className="flex justify-between gap-3 text-sm"
                        >
                          <div>
                            <div>{l.concept}</div>
                            <div className="text-xs text-slate-400">
                              {l.explanation}
                            </div>
                          </div>
                          <span className="whitespace-nowrap">
                            {Number(l.amountUsd).toLocaleString("es-EC", {
                              style: "currency",
                              currency: "USD",
                            })}
                          </span>
                        </div>
                      ))}
                    </div>
                    <div className="mt-5 flex flex-wrap gap-2">
                      <button
                        onClick={() => window.print()}
                        className="rounded-lg bg-white px-3 py-2 text-sm font-semibold text-slate-900"
                      >
                        <Printer className="inline mr-2 h-4 w-4" />
                        Imprimir / PDF
                      </button>
                      {form.clientEmail && (
                        <a
                          className="rounded-lg border border-white/30 px-3 py-2 text-sm font-semibold"
                          href={`mailto:${encodeURIComponent(form.clientEmail)}?subject=${encodeURIComponent(
                            "Cotización de limpieza " + quote.id,
                          )}&body=${encodeURIComponent(
                            "Estimado/a " +
                              form.clientName +
                              ", el total de la cotización es " +
                              total +
                              ". Ref.: " +
                              quote.id +
                              ". Contacte a la empresa para confirmar condiciones.",
                          )}`}
                        >
                          <Send className="inline mr-2 h-4 w-4" />
                          Preparar correo
                        </a>
                      )}
                    </div>
                    <p className="text-xs text-slate-400 mt-3">
                      La impresión permite guardar un PDF. El envío de correo
                      abre el cliente de correo del usuario; SMTP/API y
                      autenticación quedan por configurar.
                    </p>
                  </>
                )}
              </section>

              <section className="rounded-2xl border bg-white p-5">
                <h3 className="font-bold">Reglas de negocio</h3>
                <p className="text-sm text-slate-600 mt-2">
                  No hay tarifas predeterminadas inventadas. El motor exige que
                  la empresa configure productividad, mano de obra, insumos,
                  equipos, costos indirectos, margen e impuesto antes de
                  cotizar.
                </p>
                <p className="text-sm text-slate-600 mt-2">
                  El descuento se acepta únicamente si coincide con un código
                  activo registrado en la base de datos.
                </p>
              </section>
            </aside>
          </div>
        )}
      </div>
    </main>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  required = false,
  min,
  step,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  min?: string;
  step?: string;
}) {
  return (
    <label className="block text-sm font-medium text-slate-700">
      {label}
      <input
        className="mt-1.5 block w-full rounded-lg border border-slate-300 px-3 py-2.5 text-slate-900 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
        type={type}
        value={value}
        min={min}
        step={step}
        required={required}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
}) {
  return (
    <label className="block text-sm font-medium text-slate-700">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1.5 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-slate-900"
      >
        {options.map(([v, t]) => (
          <option key={v} value={v}>
            {t}
          </option>
        ))}
      </select>
    </label>
  );
}

// Tipos para la API de voz Web Speech en navegadores compatibles.
type SpeechRecognitionEvent = Event & {
  resultIndex: number;
  results: {
    length: number;
    [i: number]: { [i: number]: { transcript: string; isFinal?: boolean } };
  };
};

type SpeechRecognitionErrorEvent = Event & {
  error: string;
};

type SpeechRecognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((ev: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
  onaudiostart: (() => void) | null;
  onspeechstart: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};
