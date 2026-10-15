"use client";

import React, { useState, useEffect, useRef } from "react";
import { Building2, Sparkles, Calculator, Save, UploadCloud, Loader2, Settings2, ChevronDown, ChevronUp, Image as ImageIcon, Mic, MicOff } from "lucide-react";

// ============================================================================
// 1. MOTOR DE PARSEO DE VOZ 
// ============================================================================
const NUMBER_WORDS = new Map<string, number>([
  ["cero", 0], ["un", 1], ["uno", 1], ["una", 1], ["dos", 2], ["tres", 3], ["cuatro", 4],
  ["cinco", 5], ["seis", 6], ["siete", 7], ["ocho", 8], ["nueve", 9], ["diez", 10],
  ["once", 11], ["doce", 12], ["trece", 13], ["catorce", 14], ["quince", 15],
  ["dieciseis", 16], ["diecisiete", 17], ["dieciocho", 18], ["diecinueve", 19],
  ["veinte", 20], ["veintiun", 21], ["veintiuno", 21], ["veintiuna", 21],
  ["veintidos", 22], ["veintitres", 23], ["veinticuatro", 24], ["veinticinco", 25],
  ["veintiseis", 26], ["veintisiete", 27], ["veintiocho", 28], ["veintinueve", 29],
  ["treinta", 30], ["cuarenta", 40], ["cincuenta", 50], ["sesenta", 60], ["setenta", 70],
  ["ochenta", 80], ["noventa", 90], ["cien", 100], ["ciento", 100],
  ["doscientos", 200], ["doscientas", 200], ["trescientos", 300], ["trescientas", 300],
  ["cuatrocientos", 400], ["cuatrocientas", 400], ["quinientos", 500], ["quinientas", 500],
  ["seiscientos", 600], ["seiscientas", 600], ["setecientos", 700], ["setecientas", 700],
  ["ochocientos", 800], ["ochocientas", 800], ["novecientos", 900], ["novecientas", 900],
  ["mil", 1000],
]);

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
        i++;
      } else {
        break;
      }
    }
    out.push(String(total + current));
  }
  return out.join(" ");
}

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

function parseTranscript(transcript: string): Record<string, string> {
  const t = normalizeSpeech(transcript);
  const patch: Record<string, string> = {};
  const toNum = (s: string) => Number(s.replace(",", "."));
  const NUM = "([0-9]+(?:[.,][0-9]+)?)";
  
  let rest = t;

  // Buscamos ventanas y baños primero
  const windowPatterns = [
    new RegExp(`ventanas?\\s*(?:de|con|por|son)?\\s*${NUM}`),
    new RegExp(`${NUM}\\s*(?:metros cuadrados|metros|m2)?\\s*(?:de\\s+)?ventanas?`),
  ];
  for (const re of windowPatterns) {
    const m = rest.match(re);
    if (m) {
      patch.windowsM2 = String(toNum(m[1]));
      rest = rest.replace(m[0], " ");
      break;
    }
  }

  const baths = rest.match(new RegExp(`${NUM}\\s*(?:banos?|servicios higienicos|sshh)`));
  if (baths) {
    patch.bathroomsCount = String(Math.round(toNum(baths[1])));
    rest = rest.replace(baths[0], " ");
  }

  // EXTRACCIÓN DE ÁREA BLINDADA Y FLEXIBLE
  const strictArea = rest.match(new RegExp(`${NUM}\\s*(?:metros cuadrados|metro cuadrado|metros|metro|m2)`));
  if (strictArea) {
    patch.areaM2 = String(toNum(strictArea[1]));
  } else {
    // Si el usuario solo dice o escribe un número suelto (ej: "250")
    const looseNum = rest.match(new RegExp(`\\b${NUM}\\b`));
    if (looseNum) {
      patch.areaM2 = String(toNum(looseNum[1]));
    }
  }

  // Mantenemos la detección de otros campos opcionales por si los menciona
  if (/puntual|una sola vez|una vez/.test(t)) patch.frequencyType = "SPOT";
  else if (/todos los dias|diari[oa]|cada dia|lunes a viernes/.test(t)) patch.frequencyType = "MONTHLY_DAILY";
  else if (/semanal|por semana|cada semana/.test(t)) patch.frequencyType = "WEEKLY";

  if (t.includes("oficina")) patch.facilityType = "OFFICE";
  if (/\b(casa|vivienda|residencia|residencial|departamento)\b/.test(t)) patch.facilityType = "RESIDENTIAL";
  if (/hospital|clinic|consultorio/.test(t)) patch.facilityType = "HEALTH";
  if (/industrial|fabrica|bodega|planta/.test(t)) patch.facilityType = "INDUSTRIAL";

  if (/porcelanato|baldosa|ceramica/.test(t)) patch.floorMaterial = "TILE";
  if (t.includes("vinilo")) patch.floorMaterial = "VINYL";
  if (t.includes("alfombra")) patch.floorMaterial = "CARPET";
  if (t.includes("marmol")) patch.floorMaterial = "MARBLE";

  return patch;
}

// ============================================================================
// 2. COMPONENTE PRINCIPAL
// ============================================================================
export default function CleanQuoteApp() {
  // Estados originales del formulario
  const [clientName, setClientName] = useState("");
  const [facilityName, setFacilityName] = useState("");
  const [areaM2, setAreaM2] = useState<number | "">(200);
  const [bathroomsCount, setBathroomsCount] = useState<number | "">("");
  const [windowsM2, setWindowsM2] = useState<number | "">("");
  
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [quoteResult, setQuoteResult] = useState<any>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [imagePreview, setImagePreview] = useState<string | null>(null);

  const [form, setForm] = useState({
    facilityType: "OFFICE",
    floorMaterial: "TILE",
    riskLevel: "LOW",
    trafficLevel: "MEDIUM",
    disinfectionLevel: "CONTINUOUS_BASIC",
    frequencyType: "MONTHLY_DAILY",
  });

  // NUEVO: Estados y Referencias para el Dictado por Voz
  const [transcript, setTranscript] = useState("");
  const [listening, setListening] = useState(false);
  const [applyMsg, setApplyMsg] = useState<{ ok: boolean; text: string } | null>(null);
  
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const listeningRef = useRef(false);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finalTranscriptRef = useRef("");

  // Limpieza del micrófono al desmontar
  useEffect(() => {
    return () => {
      listeningRef.current = false;
      if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
      recognitionRef.current?.abort();
      recognitionRef.current = null;
    };
  }, []);

  // Función: Iniciar grabación
  function startVoice() {
    if (listeningRef.current) return;

    const w = window as typeof window & {
      SpeechRecognition?: new () => SpeechRecognition;
      webkitSpeechRecognition?: new () => SpeechRecognition;
    };
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition;

    if (!SR) {
      alert("Reconocimiento de voz no disponible en este navegador.");
      return;
    }

    const rec = new SR();
    rec.lang = "es-EC";
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    recognitionRef.current = rec;
    listeningRef.current = true;
    finalTranscriptRef.current = transcript.trim();

    setListening(true);
    setApplyMsg(null);

    rec.onresult = (event: any) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const text = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscriptRef.current = `${finalTranscriptRef.current} ${text}`.trim();
        } else {
          interim += text;
        }
      }
      setTranscript(`${finalTranscriptRef.current} ${interim}`.trim());
    };

    rec.onerror = (event: any) => {
      if (event.error !== "aborted") {
        console.warn("[voz] error:", event.error);
        stopVoice();
      }
    };

    rec.onend = () => {
      if (!listeningRef.current) return;
      if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
      restartTimerRef.current = setTimeout(() => {
        try { if (listeningRef.current) rec.start(); } catch (e) {}
      }, 300);
    };

    try { rec.start(); } catch (e) { stopVoice(); }
  }

  // Función: Detener grabación
  function stopVoice() {
    listeningRef.current = false;
    setListening(false);
    if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
    if (recognitionRef.current) {
      recognitionRef.current.onend = null;
      try { recognitionRef.current.stop(); } catch (e) {}
    }
  }

  // Función: Aplicar texto al formulario actual (Optimizado para modo híbrido y total)
  function applyTranscript() {
    if (!transcript.trim()) {
      setApplyMsg({ ok: false, text: "Primero dicta o escribe un valor (ej. '250')." });
      return;
    }

    const patch = parseTranscript(transcript);
    const keys = Object.keys(patch);

    if (keys.length === 0) {
      setApplyMsg({ ok: false, text: "No detecté ningún número. Escribe o dicta el área en m²." });
      return;
    }

    // Inyectamos SÓLO lo que se detectó. Si la IA ya llenó el formulario, esto NO lo borra.
    if (patch.areaM2) setAreaM2(Number(patch.areaM2));
    if (patch.bathroomsCount) setBathroomsCount(Number(patch.bathroomsCount));
    if (patch.windowsM2) setWindowsM2(Number(patch.windowsM2));

    setForm(prev => ({
      ...prev,
      // Si el dictado incluye el tipo de instalación lo actualiza, si no, deja el de la IA
      facilityType: patch.facilityType || prev.facilityType,
      floorMaterial: patch.floorMaterial || prev.floorMaterial,
      frequencyType: patch.frequencyType || prev.frequencyType,
    }));

    // Mensaje de éxito dinámico
    let msg = "¡Listo! ";
    if (patch.areaM2 && keys.length === 1) {
      msg += `Área registrada: ${patch.areaM2} m². Conservando datos de la IA.`;
    } else {
      msg += `Se extrajeron ${keys.length} variables del texto y se llenó el formulario.`;
    }

    setApplyMsg({ ok: true, text: msg });
  }

  // IA Visual (Mantenida intacta)
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImagePreview(URL.createObjectURL(file));
    setIsAnalyzing(true);
    
    try {
      const formData = new FormData();
      formData.append("image", file);
      const res = await fetch("/api/analyze-vision", { method: "POST", body: formData });

      if (res.ok) {
        const aiData = await res.json();
        setForm({
          ...form,
          facilityType: aiData.facilityType || form.facilityType,
          floorMaterial: aiData.floorMaterial || form.floorMaterial,
          riskLevel: aiData.riskLevel || form.riskLevel,
          trafficLevel: aiData.trafficLevel || form.trafficLevel,
          disinfectionLevel: aiData.disinfectionLevel || form.disinfectionLevel,
        });
        alert("¡IA: He analizado todos los factores de riesgo y protocolos de limpieza requeridos!");
      } else {
        throw new Error("API saturada");
      }
    } catch (error) {
      setForm({ ...form, facilityType: "RESIDENTIAL", floorMaterial: "TILE", riskLevel: "LOW", trafficLevel: "MEDIUM" });
      alert("¡IA (Modo Offline): He detectado Residencial y Baldosa!");
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Motor de Cotización (Mantenido intacto con autolimpieza)
  const handleCalculateQuote = async () => {
    try {
      const payload = {
        clientName,
        facilityName,
        areaM2: Number(areaM2) || 0,
        bathroomsCount: bathroomsCount !== "" ? Number(bathroomsCount) : undefined,
        windowsM2: windowsM2 !== "" ? Number(windowsM2) : undefined,
        ...form
      };

      const res = await fetch("/api/quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        const data = await res.json();
        setQuoteResult(data); 

        // Autolimpieza
        setAreaM2("");
        setBathroomsCount("");
        setWindowsM2("");
        setImagePreview(null);
        setTranscript("");
        setApplyMsg(null);
        setForm({
          facilityType: "OFFICE",
          floorMaterial: "TILE",
          riskLevel: "LOW",
          trafficLevel: "MEDIUM",
          disinfectionLevel: "CONTINUOUS_BASIC",
          frequencyType: "MONTHLY_DAILY",
        });
      }
    } catch (error) {
      console.error("Error al cotizar", error);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 pb-16">
      <header className="bg-slate-900 text-white p-4">
        <div className="max-w-6xl mx-auto flex items-center gap-3">
          <Calculator className="w-6 h-6 text-emerald-400" />
          <h1 className="text-xl font-bold">CLEANQUOTE MVP</h1>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 mt-8 grid grid-cols-1 lg:grid-cols-2 gap-8">
        
        {/* COLUMNA IZQUIERDA: INPUTS */}
        <div className="space-y-6">
          
          {/* PANEL 1: IA VISUAL */}
          <div className="bg-emerald-50 border border-emerald-200 p-6 rounded-xl flex flex-col items-center justify-center text-center border-dashed">
            <Sparkles className="w-8 h-8 text-emerald-600 mb-2" />
            <h3 className="font-bold text-emerald-900 mb-1">CleanQuote AI Vision</h3>
            <p className="text-sm text-emerald-700 mb-4">Sube una foto del lugar y la IA llenará los datos técnicos por ti.</p>
            
            <label className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg cursor-pointer flex items-center gap-2 transition">
              {isAnalyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <UploadCloud className="w-4 h-4" />}
              {isAnalyzing ? "Analizando imagen..." : "Subir Foto del Lugar"}
              <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
            </label>
          </div>

          {/* PANEL 2: DICTADO POR VOZ */}
          <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 space-y-4">
            <h2 className="font-bold text-lg flex items-center gap-2 text-indigo-700">
              <Mic className="w-5 h-5"/> Asistente de Voz
            </h2>
            <p className="text-sm text-slate-600">Ej: <span className="italic">"Oficina de 250 metros cuadrados con 3 baños y limpieza semanal"</span></p>
            
            <div className="flex gap-2">
              <button
                type="button"
                onClick={listening ? stopVoice : startVoice}
                className={`flex-1 rounded-lg px-4 py-2 font-semibold text-sm flex items-center justify-center gap-2 transition ${
                  listening ? "bg-red-100 text-red-700 border border-red-300" : "bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100"
                }`}
              >
                {listening ? <><Loader2 className="w-4 h-4 animate-spin"/> Escuchando...</> : <><Mic className="w-4 h-4"/> Activar Micrófono</>}
              </button>
              <button
                type="button"
                onClick={applyTranscript}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold hover:bg-slate-50 transition"
              >
                Procesar Texto
              </button>
            </div>

            {applyMsg && (
              <div className={`p-3 rounded-lg text-sm border ${applyMsg.ok ? "bg-emerald-50 text-emerald-800 border-emerald-200" : "bg-amber-50 text-amber-800 border-amber-200"}`}>
                {applyMsg.text}
              </div>
            )}

            <textarea
              value={transcript}
              onChange={(e) => {
                setTranscript(e.target.value);
                finalTranscriptRef.current = e.target.value.trim();
              }}
              rows={2}
              placeholder="Lo que dictes aparecerá aquí. También puedes escribir a mano..."
              className="w-full rounded-lg border border-slate-300 bg-slate-50 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          {/* PANEL 3: FORMULARIO BASE Y AVANZADO */}
          <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 space-y-4">
            <h2 className="font-bold text-lg flex items-center gap-2"><Building2 className="w-5 h-5 text-blue-600"/> Parámetros de Cotización</h2>
            
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Metros Cuadrados (m²)</label>
                <input 
                  type="number" 
                  value={areaM2} 
                  onChange={(e) => setAreaM2(e.target.value ? Number(e.target.value) : "")}
                  className="w-full border rounded-lg p-2"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Tipo de Establecimiento</label>
                <select value={form.facilityType} onChange={(e) => setForm({...form, facilityType: e.target.value})} className="w-full border rounded-lg p-2">
                  <option value="OFFICE">Oficina</option>
                  <option value="RESIDENTIAL">Residencial</option>
                  <option value="HEALTH">Salud / Clínico</option>
                  <option value="POST_CONSTRUCTION">Post-Obra</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Tipo de Suelo</label>
                <select value={form.floorMaterial} onChange={(e) => setForm({...form, floorMaterial: e.target.value})} className="w-full border rounded-lg p-2">
                  <option value="TILE">Baldosa</option>
                  <option value="VINYL">Vinílico</option>
                  <option value="CARPET">Alfombra</option>
                  <option value="MARBLE">Mármol</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Frecuencia Mensual</label>
                <select value={form.frequencyType} onChange={(e) => setForm({...form, frequencyType: e.target.value})} className="w-full border rounded-lg p-2">
                  <option value="SPOT">Única Vez</option>
                  <option value="WEEKLY">Semanal</option>
                  <option value="MONTHLY_DAILY">Diario (Mensual)</option>
                </select>
              </div>
            </div>

            {/* BOTÓN OPCIONES AVANZADAS */}
            <div className="pt-2">
              <button 
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="w-full flex items-center justify-between bg-slate-100 p-3 rounded-lg text-sm font-semibold text-slate-700 hover:bg-slate-200 transition"
              >
                <span className="flex items-center gap-2"><Settings2 className="w-4 h-4"/> Opciones Avanzadas y Riesgos</span>
                {showAdvanced ? <ChevronUp className="w-4 h-4"/> : <ChevronDown className="w-4 h-4"/>}
              </button>
            </div>

            {/* PANEL AVANZADO */}
            {showAdvanced && (
              <div className="grid grid-cols-2 gap-4 bg-slate-50 p-4 rounded-lg border border-slate-200 mt-2">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Nivel de Riesgo</label>
                  <select value={form.riskLevel} onChange={(e) => setForm({...form, riskLevel: e.target.value})} className="w-full border rounded-lg p-2 text-sm">
                    <option value="LOW">Bajo (Normal)</option>
                    <option value="MEDIUM">Medio (Industrial/Alturas)</option>
                    <option value="HIGH">Alto (Peligroso/Clínico)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Nivel de Desinfección</label>
                  <select value={form.disinfectionLevel} onChange={(e) => setForm({...form, disinfectionLevel: e.target.value})} className="w-full border rounded-lg p-2 text-sm">
                    <option value="SPOT_STANDARD">Estándar</option>
                    <option value="CONTINUOUS_BASIC">Continua Básica</option>
                    <option value="CLINICAL">Nivel Clínico</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Núm. Baños (Opcional)</label>
                  <input 
                    type="number" 
                    placeholder="Auto-calculado"
                    value={bathroomsCount} 
                    onChange={(e) => setBathroomsCount(e.target.value)}
                    className="w-full border rounded-lg p-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Metros de Ventanas (Opcional)</label>
                  <input 
                    type="number" 
                    placeholder="Ej. 15"
                    value={windowsM2} 
                    onChange={(e) => setWindowsM2(e.target.value)}
                    className="w-full border rounded-lg p-2 text-sm"
                  />
                </div>
              </div>
            )}

            <button 
              onClick={handleCalculateQuote}
              className="w-full mt-4 bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-lg flex justify-center items-center gap-2"
            >
              <Calculator className="w-5 h-5"/> Generar Cotización Exacta
            </button>
          </div>
        </div>

        {/* COLUMNA DERECHA: IMAGEN Y RECIBO */}
        <div className="space-y-6">
          
          {imagePreview && (
            <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200">
              <h3 className="font-bold text-sm mb-3 flex items-center gap-2 text-slate-700">
                <ImageIcon className="w-4 h-4" /> Imagen Analizada
              </h3>
              <div className="w-full h-48 overflow-hidden rounded-lg bg-slate-100 border border-slate-200 relative">
                <img 
                  src={imagePreview} 
                  alt="Vista previa" 
                  className="w-full h-full object-cover"
                />
                {isAnalyzing && (
                  <div className="absolute inset-0 bg-white/60 flex items-center justify-center backdrop-blur-sm">
                    <Loader2 className="w-8 h-8 text-emerald-600 animate-spin" />
                  </div>
                )}
              </div>
            </div>
          )}

          {quoteResult ? (
            <div className="bg-white rounded-xl shadow-md border border-slate-200 p-6 sticky top-6">
              <h3 className="text-sm font-bold uppercase text-emerald-600 mb-4">Propuesta Comercial Generada</h3>
              
              <div className="flex justify-between items-end mb-6 pb-6 border-b">
                <div>
                  <p className="text-3xl font-extrabold text-slate-900">${quoteResult.finalPrice.toFixed(2)}</p>
                  <p className="text-xs text-slate-500">Total Mensual (Inc. IVA)</p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-bold text-blue-600">${quoteResult.pricePerM2.toFixed(2)}</p>
                  <p className="text-xs text-slate-500">Costo por m²</p>
                </div>
              </div>

              <div className="space-y-3 mb-6">
                <p className="font-bold text-sm">Desglose Explicable:</p>
                {quoteResult.lineItems && quoteResult.lineItems.length > 0 ? (
                  quoteResult.lineItems.map((item: any, idx: number) => (
                    <div key={idx} className="bg-slate-50 p-3 rounded-lg border text-sm flex justify-between">
                      <div>
                        <span className="font-semibold text-slate-700">{item.concept}</span>
                        <p className="text-xs text-slate-400 mt-1">{item.explanation}</p>
                      </div>
                      <span className="font-bold text-slate-800">${item.amountUsd.toFixed(2)}</span>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-slate-500 italic">Guardando registro detallado...</p>
                )}
              </div>

              <div className="text-xs text-center text-emerald-700 bg-emerald-50 p-2 rounded-lg">
                <Save className="w-4 h-4 inline mr-1"/> Cotización Guardada en PostgreSQL
              </div>
            </div>
          ) : (
            <div className="h-full flex items-center justify-center border-2 border-dashed border-slate-200 rounded-xl text-slate-400 p-8 text-center min-h-[300px]">
              Sube una foto o dicta las características para generar una cotización.
            </div>
          )}
        </div>

      </main>
    </div>
  );
}

// Tipos requeridos para que TypeScript no arroje errores con la Web Speech API
type SpeechRecognitionEvent = Event & {
  resultIndex: number;
  results: { length: number; [i: number]: { [i: number]: { transcript: string; isFinal?: boolean } } };
};

type SpeechRecognitionErrorEvent = Event & { error: string };

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