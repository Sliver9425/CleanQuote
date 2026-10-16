"use client";

import React, { useState, useEffect, useRef } from "react";
import { Building2, Sparkles, Calculator, Save, UploadCloud, Loader2, Settings2, ChevronDown, ChevronUp, Image as ImageIcon, Mic, CheckCircle, RefreshCcw, ArrowRight, Download } from "lucide-react";

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
    if (!NUMBER_WORDS.has(tokens[i])) { out.push(tokens[i]); i++; continue; }
    let total = 0; let current = 0;
    while (i < tokens.length) {
      const w = tokens[i]; const v = NUMBER_WORDS.get(w);
      if (v !== undefined) {
        if (v === 1000) { total += (current || 1) * 1000; current = 0; } else { current += v; }
        i++;
      } else if (w === "y" && current % 100 >= 30 && current % 10 === 0 && NUMBER_WORDS.has(tokens[i + 1] ?? "")) {
        i++;
      } else { break; }
    }
    out.push(String(total + current));
  }
  return out.join(" ");
}

function normalizeSpeech(raw: string): string {
  const base = raw.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[;:!?¡¿()"“”]/g, " ").replace(/[,.](?=\s|$)/g, " ").replace(/\s+/g, " ").trim();
  return wordsToDigits(base);
}

function parseTranscript(transcript: string): Record<string, string> {
  const t = normalizeSpeech(transcript);
  const patch: Record<string, string> = {};
  const toNum = (s: string) => Number(s.replace(",", "."));
  const NUM = "([0-9]+(?:[.,][0-9]+)?)";
  let rest = t;

  const windowPatterns = [
    new RegExp(`(?:ventanas?|vidrios?)\\s*(?:de|con|por|son)?\\s*${NUM}\\s*(?:metros cuadrados|metro cuadrado|metros|metro|m2)?`),
    new RegExp(`${NUM}\\s*(?:metros cuadrados|metro cuadrado|metros|metro|m2)?\\s*(?:de\\s+)?(?:ventanas?|vidrios?)`),
  ];
  for (const re of windowPatterns) {
    const m = rest.match(re);
    if (m) { patch.windowsM2 = String(toNum(m[1])); rest = rest.replace(m[0], " "); break; }
  }

  const baths = rest.match(new RegExp(`${NUM}\\s*(?:banos?|servicios higienicos|sshh)`));
  if (baths) { patch.bathroomsCount = String(Math.round(toNum(baths[1]))); rest = rest.replace(baths[0], " "); }

  const strictArea = rest.match(new RegExp(`${NUM}\\s*(?:metros cuadrados|metro cuadrado|metros|metro|m2)`));
  if (strictArea) { patch.areaM2 = String(toNum(strictArea[1])); } 
  else {
    const looseNum = rest.match(new RegExp(`\\b${NUM}\\b`));
    if (looseNum) { patch.areaM2 = String(toNum(looseNum[1])); }
  }

  if (/puntual|una sola vez|una vez/.test(t)) patch.frequencyType = "SPOT";
  else if (/todos los dias|diari[oa]|cada dia|lunes a viernes/.test(t)) patch.frequencyType = "MONTHLY_DAILY";
  else if (/semanal|por semana|cada semana/.test(t)) patch.frequencyType = "WEEKLY";

  // ------------------------------------------------------------------------
  // 5. TIPO DE INSTALACIÓN, RIESGO Y DESINFECCIÓN (ACTUALIZADO)
  // ------------------------------------------------------------------------
  if (t.includes("oficina")) patch.facilityType = "OFFICE";
  if (/\b(casa|vivienda|residencia|residencial|departamento)\b/.test(t)) patch.facilityType = "RESIDENTIAL";
  if (/industrial|fabrica|bodega|planta/.test(t)) patch.facilityType = "INDUSTRIAL";
  
  // NUEVA REGLA: Post-Obra y Escombros
  // Detecta palabras como "post obra", "post construccion", "escombros", "remodelacion", "desechos de construccion"
  if (/post ?obra|post ?construccion|escombros|remodelacion|desechos de construccion/.test(t)) {
    patch.facilityType = "POST_CONSTRUCTION";
    // Opcional: El post-obra suele ser un servicio de "Única Vez" y riesgo medio
    patch.frequencyType = "SPOT"; 
    patch.riskLevel = "MEDIUM";
  }

  // REGLA CLÍNICA AMPLIADA: Hospitales y Riesgo Biológico
  // Ahora detecta "desechos medicos", "desechos biologicos", "riesgo biologico", "biologico"
  if (/hospital|clinic[oa]|consultorio|medico|desinfeccion clinic[oa]|desechos medicos|desechos biologicos|riesgo biologico|biologicos?/.test(t)) {
    patch.facilityType = "HEALTH";
    patch.disinfectionLevel = "CLINICAL";
    patch.riskLevel = "HIGH";
  }
  // ------------------------------------------------------------------------

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
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [showManualForm, setShowManualForm] = useState(false);
  const [todayDate, setTodayDate] = useState("");

  const [clientName, setClientName] = useState("");
  const [facilityName, setFacilityName] = useState("");
  const [areaM2, setAreaM2] = useState<number | "">(200);
  const [bathroomsCount, setBathroomsCount] = useState<number | "">("");
  const [windowsM2, setWindowsM2] = useState<number | "">("");
  
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
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

  const [transcript, setTranscript] = useState("");
  const [listening, setListening] = useState(false);
  const [applyMsg, setApplyMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const listeningRef = useRef(false);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finalTranscriptRef = useRef("");

  useEffect(() => {
    setTodayDate(new Date().toLocaleDateString("es-ES", { year: 'numeric', month: 'long', day: 'numeric' }));
    return () => {
      listeningRef.current = false;
      if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
      recognitionRef.current?.abort();
      recognitionRef.current = null;
    };
  }, []);

  function startVoice() {
    if (listeningRef.current) return;
    const w = window as typeof window & { SpeechRecognition?: new () => SpeechRecognition; webkitSpeechRecognition?: new () => SpeechRecognition; };
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SR) { alert("Reconocimiento de voz no disponible en este navegador."); return; }

    const rec = new SR();
    rec.lang = "es-EC"; rec.continuous = true; rec.interimResults = true; rec.maxAlternatives = 1;
    recognitionRef.current = rec; listeningRef.current = true; finalTranscriptRef.current = transcript.trim();
    setListening(true); setApplyMsg(null);

    rec.onresult = (event: any) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const text = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalTranscriptRef.current = `${finalTranscriptRef.current} ${text}`.trim();
        else interim += text;
      }
      setTranscript(`${finalTranscriptRef.current} ${interim}`.trim());
    };

    rec.onerror = (event: any) => { if (event.error !== "aborted") stopVoice(); };
    rec.onend = () => {
      if (!listeningRef.current) return;
      if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
      restartTimerRef.current = setTimeout(() => { try { if (listeningRef.current) rec.start(); } catch (e) {} }, 300);
    };
    try { rec.start(); } catch (e) { stopVoice(); }
  }

  function stopVoice() {
    listeningRef.current = false; setListening(false);
    if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
    if (recognitionRef.current) {
      recognitionRef.current.onend = null;
      try { recognitionRef.current.stop(); } catch (e) {}
    }
  }

  function applyTranscript() {
    if (!transcript.trim()) { setApplyMsg({ ok: false, text: "Primero dicta o escribe un valor (ej. '250')." }); return; }
    const patch = parseTranscript(transcript);
    const keys = Object.keys(patch);
    if (keys.length === 0) { setApplyMsg({ ok: false, text: "No detecté ningún número o parámetro. Escribe o dicta el área en m²." }); return; }

    if (patch.areaM2) setAreaM2(Number(patch.areaM2));
    if (patch.bathroomsCount) setBathroomsCount(Number(patch.bathroomsCount));
    if (patch.windowsM2) setWindowsM2(Number(patch.windowsM2));

    setForm(prev => ({
      ...prev,
      facilityType: patch.facilityType || prev.facilityType,
      floorMaterial: patch.floorMaterial || prev.floorMaterial,
      frequencyType: patch.frequencyType || prev.frequencyType,
      riskLevel: patch.riskLevel || prev.riskLevel,
      disinfectionLevel: patch.disinfectionLevel || prev.disinfectionLevel,
    }));

    let msg = "¡Listo! ";
    if (patch.areaM2 && keys.length === 1) msg += `Área registrada: ${patch.areaM2} m². Conservando datos de la IA.`;
    else msg += `Se extrajeron ${keys.length} variables del texto y se actualizó el formulario.`;
    setApplyMsg({ ok: true, text: msg });
  }

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
        setStep(2);
      } else {
        throw new Error("API saturada");
      }
    } catch (error) {
      setForm({ ...form, facilityType: "RESIDENTIAL", floorMaterial: "TILE", riskLevel: "LOW", trafficLevel: "MEDIUM" });
      setStep(2);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const executeQuoteGeneration = async () => {
    setShowConfirmModal(false);
    setIsGenerating(true);
    try {
      const payload = {
        clientName: clientName || "Cliente Demo",
        facilityName: facilityName || "Instalación",
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
        setStep(3);
      }
    } catch (error) {
      console.error("Error al cotizar", error);
      alert("Ocurrió un error al generar la cotización.");
    } finally {
      setIsGenerating(false);
    }
  };

  const startNewQuote = () => {
    setAreaM2(""); setBathroomsCount(""); setWindowsM2(""); setClientName(""); setFacilityName("");
    setImagePreview(null); setTranscript(""); setApplyMsg(null); setQuoteResult(null);
    setShowManualForm(false); setShowAdvanced(false);
    setForm({
      facilityType: "OFFICE", floorMaterial: "TILE", riskLevel: "LOW",
      trafficLevel: "MEDIUM", disinfectionLevel: "CONTINUOUS_BASIC", frequencyType: "MONTHLY_DAILY",
    });
    setStep(1);
  };

  return (
    <>
      {/* ============================================================== */}
      {/* VISTA DE APLICACIÓN (SE OCULTA TOTALMENTE AL IMPRIMIR)         */}
      {/* ============================================================== */}
      <div className="print:hidden min-h-screen bg-[#F8F7F4] text-stone-800 pb-16">
        
        {/* HEADER LIMPIO TIPO DASHBOARD */}
        <header className="bg-white border-b border-stone-200 p-4">
          <div className="max-w-6xl mx-auto flex justify-between items-center">
            <div className="flex items-center gap-3">
              <div className="bg-[#C25E17] p-1.5 rounded-lg">
                <Calculator className="w-5 h-5 text-white" />
              </div>
              <h1 className="text-xl font-bold text-stone-900 tracking-tight flex items-center gap-2">
                CleanQuote <span className="bg-orange-100 text-[#C25E17] text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider">PRO AI</span>
              </h1>
            </div>
            <div className="hidden md:flex items-center gap-4 text-xs font-medium text-stone-500">
              <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-500"></span> PostgreSQL v16 • En Línea</div>
              <div className="bg-stone-100 px-3 py-1.5 rounded-full">Paso {step} de 3</div>
            </div>
          </div>
        </header>

        <main className="max-w-6xl mx-auto px-4 mt-8">
          
          {step === 1 && (
            <div className="max-w-3xl mx-auto">
              <div className="mb-6">
                <h2 className="text-3xl font-bold text-stone-900 mb-2">Generador de Propuesta Comercial</h2>
                <p className="text-stone-500">Ingresa parámetros manuales o deja que la IA cuantifique áreas y factores de riesgo en segundos.</p>
              </div>

              <div className="bg-white border border-stone-200 p-8 rounded-2xl shadow-sm text-center">
                <div className="flex justify-between items-center mb-8 border-b border-stone-100 pb-4">
                  <div className="flex items-center gap-3 text-left">
                    <div className="bg-orange-50 p-2 rounded-lg text-[#C25E17]">
                      <Sparkles className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="font-bold text-stone-900 text-sm">CleanQuote AI Vision</h3>
                      <p className="text-xs text-stone-500">Estimación fotométrica automática</p>
                    </div>
                  </div>
                  <span className="bg-orange-100 text-[#C25E17] text-[10px] font-bold px-3 py-1 rounded uppercase tracking-wider hidden sm:block">
                    Reconocimiento Óptico
                  </span>
                </div>
                
                <div className="border-2 border-dashed border-stone-200 bg-stone-50/50 rounded-xl p-10 flex flex-col items-center justify-center mb-6">
                  <div className="bg-white p-3 rounded-xl shadow-sm border border-stone-100 mb-4">
                    <UploadCloud className="w-6 h-6 text-stone-400" />
                  </div>
                  <p className="font-semibold text-stone-700 mb-1">Arrastra o <span className="text-[#C25E17] underline">selecciona una imagen</span> del inmueble</p>
                  <p className="text-xs text-stone-400 mb-6 max-w-sm">La IA detecta automáticamente los m², tipología de pavimento y nivel de suciedad inicial.</p>
                  
                  <label className="bg-stone-900 hover:bg-stone-800 text-white px-6 py-3 rounded-xl cursor-pointer flex items-center justify-center gap-2 transition text-sm font-bold w-full max-w-xs shadow-md">
                    {isAnalyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <UploadCloud className="w-4 h-4" />}
                    {isAnalyzing ? "Procesando..." : "Subir Foto del Lugar"}
                    <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" disabled={isAnalyzing} />
                  </label>
                </div>

                <button onClick={() => setStep(2)} className="text-stone-500 hover:text-stone-700 text-sm font-semibold flex items-center justify-center gap-2 mx-auto">
                  Omitir foto y llenar datos manualmente <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 animate-in fade-in duration-500">
              
              {/* COLUMNA IZQUIERDA: INPUTS */}
              <div className="lg:col-span-7 space-y-6">
                <div className="mb-2">
                  <h2 className="text-2xl font-bold text-stone-900 mb-1">Configuración del Servicio</h2>
                  <p className="text-sm text-stone-500">Verifica los datos detectados o ajústalos a medida.</p>
                </div>

                {imagePreview && (
                  <div className="bg-white border border-stone-200 p-4 rounded-2xl flex items-center gap-4 shadow-sm">
                    <div className="w-16 h-16 rounded-xl overflow-hidden shrink-0 border border-stone-200">
                      <img src={imagePreview} alt="Analizada" className="w-full h-full object-cover" />
                    </div>
                    <div className="flex-1">
                      <div className="flex justify-between items-start">
                        <div>
                          <h3 className="font-bold text-stone-900 text-sm flex items-center gap-2"><CheckCircle className="w-4 h-4 text-emerald-500" /> IA Completada</h3>
                          <p className="text-xs text-stone-500 mt-0.5">Tipología y riesgo pre-cargados. Ingresa el área para continuar.</p>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Asistente de Voz */}
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-stone-200">
                  <div className="flex justify-between items-center mb-6">
                    <h2 className="font-bold text-sm flex items-center gap-2 text-stone-900">
                      <Mic className="w-4 h-4 text-stone-400"/> Asistente de Voz y Dictado
                    </h2>
                    <span className="bg-emerald-50 text-emerald-700 text-[10px] font-bold px-2 py-1 rounded-full uppercase flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span> Listo
                    </span>
                  </div>
                  
                  <div className="flex flex-wrap gap-2 mb-4 text-xs">
                    <span className="bg-stone-50 text-stone-500 border border-stone-200 px-3 py-1.5 rounded-lg">"Oficina de 250 m² con 3 baños"</span>
                    <span className="bg-stone-50 text-stone-500 border border-stone-200 px-3 py-1.5 rounded-lg">"Bodega industrial 500 m² piso epóxico"</span>
                  </div>

                  <textarea 
                    value={transcript} 
                    onChange={(e) => { setTranscript(e.target.value); finalTranscriptRef.current = e.target.value.trim(); }} 
                    rows={2} 
                    placeholder="Lo que dictes aparecerá aquí. También puedes escribir libremente..." 
                    className="w-full rounded-xl border border-stone-200 bg-white p-4 text-sm focus:outline-none focus:ring-2 focus:ring-[#C25E17]/20 focus:border-[#C25E17] resize-none mb-4" 
                  />

                  {applyMsg && (
                    <div className={`p-3 rounded-xl text-xs border mb-4 font-medium ${applyMsg.ok ? "bg-emerald-50 text-emerald-700 border-emerald-100" : "bg-red-50 text-red-700 border-red-100"}`}>{applyMsg.text}</div>
                  )}

                  <div className="flex flex-col sm:flex-row gap-3">
                    <button type="button" onClick={listening ? stopVoice : startVoice} className={`flex-1 rounded-xl px-4 py-2.5 font-bold text-sm flex items-center justify-center gap-2 transition ${listening ? "bg-red-50 text-red-600 border border-red-200" : "bg-white text-stone-700 border border-stone-200 hover:bg-stone-50"}`}>
                      {listening ? <><Loader2 className="w-4 h-4 animate-spin"/> Escuchando...</> : <><Mic className="w-4 h-4 text-red-500"/> Activar Micrófono</>}
                    </button>
                    <button type="button" onClick={applyTranscript} className="rounded-xl border border-transparent bg-stone-900 text-white px-6 py-2.5 text-sm font-bold hover:bg-stone-800 transition flex items-center justify-center gap-2">
                      <Sparkles className="w-4 h-4"/> Procesar Texto con IA
                    </button>
                  </div>
                </div>

                {/* Formulario Manual */}
                <div className="bg-white rounded-2xl shadow-sm border border-stone-200">
                  <div className="p-6 border-b border-stone-100 flex justify-between items-center">
                    <div>
                      <h3 className="font-bold text-stone-900 text-sm flex items-center gap-2"><Settings2 className="w-4 h-4 text-stone-400"/> Parámetros de Cotización</h3>
                      <p className="text-xs text-stone-500 mt-1">Variables técnicas determinantes de costo</p>
                    </div>
                    <span className="bg-orange-50 text-[#C25E17] text-[10px] font-bold px-2 py-1 rounded uppercase">Datos Requeridos</span>
                  </div>

                  <div className="p-6 space-y-5">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-[11px] font-bold uppercase tracking-wider text-stone-500 mb-1.5">Metros Cuadrados (m²)</label>
                        <input type="number" value={areaM2} onChange={(e) => setAreaM2(e.target.value ? Number(e.target.value) : "")} className="w-full border border-stone-200 rounded-lg p-2.5 text-sm outline-none focus:border-[#C25E17]" />
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold uppercase tracking-wider text-stone-500 mb-1.5">Tipo de Establecimiento</label>
                        <select value={form.facilityType} onChange={(e) => setForm({...form, facilityType: e.target.value})} className="w-full border border-stone-200 rounded-lg p-2.5 text-sm outline-none focus:border-[#C25E17] bg-white">
                          <option value="OFFICE">Oficina Corporativa</option>
                          <option value="RESIDENTIAL">Residencial</option>
                          <option value="HEALTH">Salud / Clínico</option>
                          <option value="POST_CONSTRUCTION">Post-Obra</option>
                        </select>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-[11px] font-bold uppercase tracking-wider text-stone-500 mb-1.5">Tipo de Pavimento / Suelo</label>
                        <select value={form.floorMaterial} onChange={(e) => setForm({...form, floorMaterial: e.target.value})} className="w-full border border-stone-200 rounded-lg p-2.5 text-sm outline-none focus:border-[#C25E17] bg-white">
                          <option value="TILE">Baldosa / Cerámica Gres</option>
                          <option value="VINYL">Vinílico / PVC</option>
                          <option value="CARPET">Alfombra</option>
                          <option value="MARBLE">Mármol / Piedra</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold uppercase tracking-wider text-stone-500 mb-1.5">Frecuencia del Servicio</label>
                        <select value={form.frequencyType} onChange={(e) => setForm({...form, frequencyType: e.target.value})} className="w-full border border-stone-200 rounded-lg p-2.5 text-sm outline-none focus:border-[#C25E17] bg-white">
                          <option value="SPOT">Única Vez (Limpieza Profunda)</option>
                          <option value="WEEKLY">Semanal</option>
                          <option value="MONTHLY_DAILY">Diario L-V (Mensual Recurrente)</option>
                        </select>
                      </div>
                    </div>

                    <div className="pt-2">
                      <button onClick={() => setShowAdvanced(!showAdvanced)} className="w-full flex items-center justify-between p-3 border border-stone-200 rounded-lg bg-stone-50 hover:bg-stone-100 transition text-left">
                        <span className="text-xs font-bold text-stone-700 flex items-center gap-2"><Settings2 className="w-3.5 h-3.5"/> Opciones Avanzadas, Riesgos y Factores</span>
                        {showAdvanced ? <ChevronUp className="w-4 h-4 text-stone-400"/> : <ChevronDown className="w-4 h-4 text-stone-400"/>}
                      </button>
                      
                      {showAdvanced && (
                        <div className="grid grid-cols-2 gap-4 mt-4 p-4 bg-stone-50 border border-stone-200 rounded-xl">
                          <div>
                            <label className="block text-[11px] font-bold text-stone-500 mb-1">Nivel de Riesgo Operativo</label>
                            <select value={form.riskLevel} onChange={(e) => setForm({...form, riskLevel: e.target.value})} className="w-full border border-stone-200 rounded-md p-2 text-xs bg-white outline-none">
                              <option value="LOW">Bajo (Normal)</option>
                              <option value="MEDIUM">Medio (Industrial/Alturas)</option>
                              <option value="HIGH">Alto (Peligroso/Clínico)</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-[11px] font-bold text-stone-500 mb-1">Protocolo de Desinfección</label>
                            <select value={form.disinfectionLevel} onChange={(e) => setForm({...form, disinfectionLevel: e.target.value})} className="w-full border border-stone-200 rounded-md p-2 text-xs bg-white outline-none">
                              <option value="SPOT_STANDARD">Estándar (Contacto bajo)</option>
                              <option value="CONTINUOUS_BASIC">Continua Básica</option>
                              <option value="CLINICAL">Nivel Clínico (Hospitalario)</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-[11px] font-bold text-stone-500 mb-1">Unidades Sanitarias (Baños)</label>
                            <input 
                              type="number" 
                              placeholder="Auto-calculado" 
                              value={bathroomsCount} 
                              onChange={(e) => setBathroomsCount(e.target.value ? Number(e.target.value) : "")} 
                              className="w-full border border-stone-200 rounded-md p-2 text-xs outline-none" 
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] font-bold text-stone-500 mb-1">Superficie Vidriada (m²)</label>
                            <input 
                              type="number" 
                              placeholder="Ej. 15" 
                              value={windowsM2} 
                              onChange={(e) => setWindowsM2(e.target.value ? Number(e.target.value) : "")} 
                              className="w-full border border-stone-200 rounded-md p-2 text-xs outline-none" 
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* COLUMNA DERECHA: CLIENTE Y ACCIÓN */}
              <div className="lg:col-span-5 space-y-6">
                
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-stone-200">
                  <div className="mb-6">
                    <h2 className="font-bold text-sm text-stone-900 mb-1">Datos del Cliente (Contrato)</h2>
                    <p className="text-xs text-stone-500">Información legal para la generación del documento PDF.</p>
                  </div>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-[11px] font-bold uppercase tracking-wider text-stone-500 mb-1.5">Razón Social</label>
                      <input type="text" value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="Ej. Corporación ABC S.A." className="w-full border border-stone-200 rounded-lg p-2.5 text-sm outline-none focus:border-[#C25E17]" />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold uppercase tracking-wider text-stone-500 mb-1.5">Dirección / Sede</label>
                      <input type="text" value={facilityName} onChange={(e) => setFacilityName(e.target.value)} placeholder="Ej. Av. Amazonas y Naciones Unidas" className="w-full border border-stone-200 rounded-lg p-2.5 text-sm outline-none focus:border-[#C25E17]" />
                    </div>
                  </div>
                </div>

                <button onClick={() => setShowConfirmModal(true)} disabled={isGenerating} className="w-full bg-[#C25E17] hover:bg-[#a64f12] text-white font-bold py-4 rounded-xl flex justify-center items-center gap-2 shadow-lg shadow-orange-900/10 text-base transition disabled:opacity-70">
                  {isGenerating ? <Loader2 className="w-5 h-5 animate-spin"/> : <Calculator className="w-5 h-5"/>}
                  {isGenerating ? "Procesando..." : "Calcular Cotización Exacta"}
                </button>
              </div>

            </div>
          )}

          {/* Modal de Confirmación */}
          {showConfirmModal && (
            <div className="fixed inset-0 bg-stone-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
              <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6 text-center border border-stone-200">
                <div className="w-16 h-16 bg-orange-50 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Calculator className="w-8 h-8 text-[#C25E17]" />
                </div>
                <h3 className="text-lg font-bold text-stone-900 mb-2">¿Generar propuesta?</h3>
                <p className="text-stone-500 text-sm mb-6">El motor algorítmico procesará estas variables y generará el desglose financiero.</p>
                <div className="flex flex-col gap-2">
                  <button onClick={executeQuoteGeneration} className="w-full py-3 bg-[#C25E17] text-white rounded-xl font-bold hover:bg-[#a64f12] text-sm">Sí, Calcular Ahora</button>
                  <button onClick={() => setShowConfirmModal(false)} className="w-full py-3 bg-white border border-stone-200 text-stone-700 rounded-xl font-bold hover:bg-stone-50 text-sm">Revisar Datos</button>
                </div>
              </div>
            </div>
          )}

          {step === 3 && quoteResult && (
            <div className="max-w-4xl mx-auto space-y-6 animate-in fade-in slide-in-from-bottom-8 duration-700">
              
              <div className="bg-white rounded-3xl shadow-lg border border-stone-200 overflow-hidden">
                <div className="p-8 border-b border-stone-100 flex justify-between items-center bg-white">
                  <div>
                    <span className="text-[10px] font-bold text-[#C25E17] tracking-widest uppercase bg-orange-50 px-2 py-1 rounded">Propuesta Comercial Generada</span>
                  </div>
                  <div className="flex items-center gap-2 bg-emerald-50 text-emerald-700 px-3 py-1.5 rounded-full text-xs font-bold">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span> Calculada en tiempo real
                  </div>
                </div>

                <div className="px-8 pt-8 pb-10 border-b border-stone-100">
                  <div className="flex justify-between items-end">
                    <div>
                      <div className="flex items-baseline gap-2">
                        <span className="text-5xl font-extrabold text-stone-900 tracking-tight">${quoteResult.finalPrice.toFixed(2)}</span>
                        <span className="text-stone-400 font-medium">/ mes</span>
                      </div>
                      <p className="text-xs text-stone-400 mt-2">Total Mensual Estimado (IVA incluido)</p>
                    </div>
                    <div className="text-right">
                      <div className="bg-stone-50 px-3 py-1.5 rounded-lg border border-stone-100 inline-block mb-1">
                        <span className="text-lg font-bold text-stone-900">${quoteResult.pricePerM2.toFixed(2)}</span> <span className="text-xs text-stone-400">/ m²</span>
                      </div>
                      <p className="text-[10px] text-stone-400 uppercase tracking-wide">Base: {areaM2} m²</p>
                    </div>
                  </div>
                </div>

                <div className="p-8 bg-white">
                  <div className="flex justify-between text-[10px] font-bold text-stone-400 uppercase tracking-widest mb-4">
                    <span>Concepto Técnico / Desglose</span>
                    <span>Subtotal</span>
                  </div>
                  
                  <div className="space-y-4">
                    {quoteResult.lineItems?.map((item: any, idx: number) => {
                      const isDiscount = item.amountUsd < 0;
                      return (
                        <div key={idx} className={`p-4 rounded-xl border ${isDiscount ? 'bg-emerald-50/50 border-emerald-100' : 'bg-white border-stone-100'} flex justify-between gap-4`}>
                          <div>
                            <span className={`font-bold text-sm ${isDiscount ? 'text-emerald-800 flex items-center gap-1.5' : 'text-stone-800'}`}>
                              {isDiscount && <CheckCircle className="w-3.5 h-3.5" />} {item.concept}
                            </span>
                            <p className={`text-xs mt-1.5 leading-relaxed ${isDiscount ? 'text-emerald-600' : 'text-stone-400'}`}>{item.explanation}</p>
                          </div>
                          <span className={`font-bold text-sm whitespace-nowrap ${isDiscount ? 'text-emerald-700' : 'text-stone-900'}`}>
                            {isDiscount ? '-' : ''}${Math.abs(item.amountUsd).toFixed(2)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="p-8 bg-stone-50 border-t border-stone-100 flex flex-col sm:flex-row justify-between items-center gap-4">
                  <div className="flex items-center gap-4 text-xs text-stone-500">
                    <span className="flex items-center gap-1.5"><Save className="w-4 h-4 text-stone-400"/> Guardar como Borrador</span>
                    <span className="bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded font-medium flex items-center gap-1"><CheckCircle className="w-3 h-3"/> Guardada en PostgreSQL</span>
                  </div>
                  <div className="flex gap-3 w-full sm:w-auto">
                    <button onClick={startNewQuote} className="px-4 py-3 rounded-xl border border-stone-200 bg-white hover:bg-stone-100 text-stone-700 font-bold text-sm transition">
                      <RefreshCcw className="w-4 h-4" />
                    </button>
                    <button onClick={() => window.print()} className="flex-1 sm:flex-none bg-stone-900 hover:bg-stone-800 text-white font-bold py-3 px-6 rounded-xl text-sm transition flex items-center justify-center gap-2 shadow-md">
                      <Download className="w-4 h-4"/> Descargar Cotización en PDF
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* FOOTER APLICACIÓN */}
          <div className="max-w-6xl mx-auto mt-12 pt-6 border-t border-stone-200 flex flex-col sm:flex-row justify-between items-center text-[10px] text-stone-400 font-medium">
            <p>© 2026 CleanQuote Pro B2B. Módulo de cálculo volumétrico y bioseguridad.</p>
            <div className="flex gap-4 mt-2 sm:mt-0">
              <a href="#" className="hover:text-stone-600">Algoritmo de Rendimientos</a> • 
              <a href="#" className="hover:text-stone-600">Tablas Salariales</a> • 
              <a href="#" className="hover:text-stone-600">Soporte Operacional</a>
            </div>
          </div>
        </main>
      </div>

      {/* ============================================================== */}
      {/* VISTA DE IMPRESIÓN (PDF) - Solo visible al presionar Imprimir  */}
      {/* ============================================================== */}
      {step === 3 && quoteResult && (
        <div className="hidden print:block w-full bg-white text-black text-sm p-10 font-sans mx-auto max-w-[21cm]">
          
          <div className="mb-8">
            <h1 className="text-xl font-bold text-center mb-8 border-b-2 border-black pb-4 uppercase">
              Contrato de Prestación de Servicios de Limpieza
            </h1>
            
            <div className="grid grid-cols-2 gap-8 mb-8 text-sm">
              <div className="p-4 border border-stone-300 rounded">
                <h3 className="font-bold mb-2 underline">EMPRESA PRESTADORA</h3>
                <p><strong>Razón social:</strong> CleanQuote S.A.</p>
                <p><strong>RUC/ID:</strong> 1790000000001</p>
                <p><strong>Representante:</strong> [Su Nombre]</p>
                <p><strong>Domicilio:</strong> Quito, Ecuador</p>
              </div>
              <div className="p-4 border border-stone-300 rounded">
                <h3 className="font-bold mb-2 underline">CLIENTE</h3>
                <p><strong>Nombre/Razón social:</strong> {clientName || "Cliente Demo"}</p>
                <p><strong>RUC/ID:</strong> _______________________</p>
                <p><strong>Domicilio:</strong> {facilityName || "Instalación Principal"}</p>
              </div>
            </div>

            <p className="mb-6">En <strong>Quito, Ecuador</strong> a <strong>{todayDate}</strong>, las partes acuerdan celebrar este contrato de servicios de limpieza conforme a las siguientes cláusulas:</p>

            <div className="space-y-4 text-justify">
              <p><strong>PRIMERA. OBJETO:</strong> La prestadora realizará servicios de limpieza en el inmueble ubicado en <strong>{facilityName || "la dirección detallada en la sección del Cliente"}</strong>. El alcance, la frecuencia y los precios constan en la cotización de la segunda página, que forma parte íntegra del contrato.</p>
              <p><strong>SEGUNDA. ALCANCE:</strong> El servicio podrá incluir limpieza de pisos y superficies, baños, cocina, áreas comunes y retiro de residuos, según lo aceptado en la cotización. Las tareas extraordinarias o no incluidas deberán aprobarse por escrito y podrán tener un costo adicional.</p>
              <p><strong>TERCERA. PLAZO Y HORARIO:</strong> El servicio iniciará el día __ de ____________ de 20__. Frecuencia asignada: <strong>{form.frequencyType === "SPOT" ? "Única vez" : form.frequencyType === "WEEKLY" ? "Semanal" : "Mensual / Diaria"}</strong>. Cualquier cambio deberá ser aceptado por ambas partes.</p>
              <p><strong>CUARTA. PRECIO Y PAGO:</strong> El cliente pagará el valor mensual o total aprobado en la cotización mediante transferencia bancaria. Los comprobantes e impuestos aplicables se manejarán conforme a la normativa vigente.</p>
              <p><strong>QUINTA. OBLIGACIONES DE LA PRESTADORA:</strong> Realizar las tareas acordadas con diligencia, asignar personal apropiado, utilizar los insumos y equipos acordados, respetar las normas de seguridad y comunicar incidencias relevantes.</p>
              <p><strong>SEXTA. OBLIGACIONES DEL CLIENTE:</strong> Facilitar el acceso al lugar, informar sobre riesgos o áreas restringidas, disponer de los servicios básicos necesarios y pagar en los plazos pactados.</p>
              <p><strong>SÉPTIMA. INSUMOS Y RESPONSABILIDAD:</strong> La cotización indicará quién aporta los productos, herramientas y equipos. Los daños o incidentes deberán comunicarse oportunamente y la responsabilidad se determinará conforme a la ley aplicable.</p>
              <p><strong>OCTAVA. TERMINACIÓN:</strong> Cualquiera de las partes podrá terminar el contrato mediante aviso escrito con 30 días de anticipación. Se pagarán los servicios ya prestados y los gastos previamente autorizados.</p>
              <p><strong>DÉCIMA. ACEPTACIÓN:</strong> Las partes declaran haber leído y aceptado este contrato y su cotización. Toda modificación deberá constar por escrito y contar con la aceptación de ambas partes.</p>
            </div>
            
            <div className="mt-8 text-right text-xs text-stone-500">Página 1</div>
          </div>

          <div className="break-before-page pt-10"></div>

          <div>
            <h2 className="text-xl font-bold text-center mb-2 uppercase border-b-2 border-black pb-4">Cotización del Servicio</h2>
            <p className="text-center text-sm mb-6">Anexo al contrato de prestación de servicios de limpieza</p>

            <div className="grid grid-cols-2 gap-4 mb-6">
              <p><strong>N.º de cotización:</strong> CQ-{Math.floor(Math.random() * 90000) + 10000}</p>
              <p><strong>Fecha:</strong> {todayDate}</p>
              <p><strong>Cliente:</strong> {clientName || "Cliente Demo"}</p>
              <p><strong>Vigencia:</strong> 15 días</p>
              <p className="col-span-2"><strong>Dirección del servicio:</strong> {facilityName || "Instalación Principal"} (Área: {areaM2} m²)</p>
            </div>

            <table className="w-full mb-8 border-collapse border border-stone-400">
              <thead>
                <tr className="bg-stone-100">
                  <th className="border border-stone-400 p-2 text-left">N.°</th>
                  <th className="border border-stone-400 p-2 text-left">Descripción del servicio</th>
                  <th className="border border-stone-400 p-2 text-left">Frecuencia / Detalle</th>
                  <th className="border border-stone-400 p-2 text-right">Total (USD)</th>
                </tr>
              </thead>
              <tbody>
                {quoteResult.lineItems?.map((item: any, idx: number) => (
                  <tr key={idx}>
                    <td className="border border-stone-400 p-2 text-center">{idx + 1}</td>
                    <td className="border border-stone-400 p-2 font-semibold">{item.concept}</td>
                    <td className="border border-stone-400 p-2 text-xs">{item.explanation}</td>
                    <td className="border border-stone-400 p-2 text-right font-mono">${item.amountUsd.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="w-full flex justify-end mb-8">
              <div className="w-1/2">
                <div className="flex justify-between p-2 border-b border-stone-300">
                  <span>Subtotal:</span>
                  <span>${(quoteResult.finalPrice / 1.15).toFixed(2)}</span>
                </div>
                <div className="flex justify-between p-2 border-b border-stone-300">
                  <span>Impuestos (IVA 15%):</span>
                  <span>${(quoteResult.finalPrice - (quoteResult.finalPrice / 1.15)).toFixed(2)}</span>
                </div>
                <div className="flex justify-between p-2 bg-stone-100 font-bold text-lg">
                  <span>TOTAL COTIZADO:</span>
                  <span>${quoteResult.finalPrice.toFixed(2)}</span>
                </div>
              </div>
            </div>

            <div className="border border-stone-300 p-4 rounded mb-16">
              <h4 className="font-bold mb-2">CONDICIONES DE LA COTIZACIÓN</h4>
              <ul className="text-sm space-y-1 list-disc list-inside">
                <li><strong>Productos e insumos:</strong> Los aporta la empresa (Incluidos en la cotización).</li>
                <li><strong>Equipos y herramientas:</strong> Los aporta la empresa (Depreciación incluida).</li>
                <li><strong>Forma de pago:</strong> Transferencia bancaria o efectivo contra entrega de factura.</li>
                <li><strong>Observaciones:</strong> Cotización calculada mediante inteligencia artificial CleanQuote.</li>
              </ul>
            </div>

            <div className="grid grid-cols-2 gap-16 text-center pt-32">
              <div>
                <div className="border-t border-black pt-2 font-bold mx-8">POR LA EMPRESA PRESTADORA</div>
                <p className="text-sm mt-2">Nombre: _______________________</p>
                <p className="text-sm mt-1">ID: _______________________</p>
              </div>
              <div>
                <div className="border-t border-black pt-2 font-bold mx-8">POR EL CLIENTE</div>
                <p className="text-sm mt-2">Nombre: {clientName || "_______________________"}</p>
                <p className="text-sm mt-1">ID: _______________________</p>
              </div>
            </div>

            <p className="text-center text-xs text-stone-500 mt-8">
              La firma de ambas partes confirma la aceptación de los servicios, precios y condiciones descritos en esta cotización.
            </p>
            <div className="mt-4 text-right text-xs text-stone-500">Página 2</div>
          </div>
        </div>
      )}
    </>
  );
}

type SpeechRecognitionEvent = Event & { resultIndex: number; results: { length: number; [i: number]: { [i: number]: { transcript: string; isFinal?: boolean } } }; };
type SpeechRecognitionErrorEvent = Event & { error: string };
type SpeechRecognition = { lang: string; continuous: boolean; interimResults: boolean; maxAlternatives: number; onresult: ((ev: SpeechRecognitionEvent) => void) | null; onerror: ((event: SpeechRecognitionErrorEvent) => void) | null; onend: (() => void) | null; onstart: (() => void) | null; onaudiostart: (() => void) | null; onspeechstart: (() => void) | null; start: () => void; stop: () => void; abort: () => void; };