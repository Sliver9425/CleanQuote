// app/page.tsx
import Link from "next/link";
import { Building2, Trees, Calculator, ArrowRight, Sparkles, ShieldCheck } from "lucide-react";

export default function HomePage() {
  return (
    <div className="min-h-screen bg-[#F8F7F4] text-stone-800">
      {/* HEADER */}
      <header className="bg-white border-b border-stone-200 p-4">
        <div className="max-w-6xl mx-auto flex items-center gap-3">
          <div className="bg-[#C25E17] p-1.5 rounded-lg">
            <Calculator className="w-5 h-5 text-white" />
          </div>
          <h1 className="text-xl font-bold text-stone-900 tracking-tight flex items-center gap-2">
            CleanQuote
            <span className="bg-orange-100 text-[#C25E17] text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider">
              PRO AI
            </span>
          </h1>
        </div>
      </header>

      {/* HERO */}
      <main className="max-w-6xl mx-auto px-4 py-16">
        <div className="text-center mb-14">
          <span className="inline-flex items-center gap-2 bg-orange-50 text-[#C25E17] text-xs font-bold px-3 py-1.5 rounded-full uppercase tracking-wider mb-5">
            <Sparkles className="w-3.5 h-3.5" />
            Cotización inteligente con IA
          </span>
          <h1 className="text-4xl md:text-5xl font-extrabold text-stone-900 mb-4 tracking-tight">
            Cotiza servicios de limpieza<br />
            <span className="text-[#C25E17]">en segundos, no en horas.</span>
          </h1>
          <p className="text-stone-500 max-w-2xl mx-auto text-lg">
            CleanQuote PRO usa visión artificial y procesamiento de lenguaje natural para
            estimar áreas, detectar condiciones del sitio y generar propuestas comerciales
            con desglose técnico y contrato listo para imprimir.
          </p>
        </div>

        {/* DOS CARDS DE SELECCIÓN */}
        <div className="grid md:grid-cols-2 gap-6 max-w-4xl mx-auto">
          {/* INTERIOR */}
          <Link
            href="/cotizar/interior"
            className="group bg-white border border-stone-200 rounded-2xl p-8 shadow-sm hover:shadow-lg hover:border-[#C25E17]/40 transition-all"
          >
            <div className="bg-orange-50 w-14 h-14 rounded-xl flex items-center justify-center mb-6 group-hover:bg-[#C25E17] transition">
              <Building2 className="w-7 h-7 text-[#C25E17] group-hover:text-white transition" />
            </div>
            <h2 className="text-2xl font-bold text-stone-900 mb-2">Limpieza Interior</h2>
            <p className="text-stone-500 text-sm mb-6 leading-relaxed">
              Oficinas, residencias, clínicas y post-obra. Calcula rendimiento por m²,
              insumos, depreciación de equipos y frecuencia de visita.
            </p>
            <ul className="space-y-2 mb-6 text-xs text-stone-600">
              <li className="flex items-center gap-2"><ShieldCheck className="w-3.5 h-3.5 text-emerald-500" /> Factores por tipo de piso y riesgo</li>
              <li className="flex items-center gap-2"><ShieldCheck className="w-3.5 h-3.5 text-emerald-500" /> Cálculo por baños y ventanas</li>
              <li className="flex items-center gap-2"><ShieldCheck className="w-3.5 h-3.5 text-emerald-500" /> Protocolo de desinfección</li>
            </ul>
            <span className="inline-flex items-center gap-2 text-[#C25E17] font-bold text-sm group-hover:gap-3 transition-all">
              Cotizar interior <ArrowRight className="w-4 h-4" />
            </span>
          </Link>

          {/* EXTERIOR */}
          <Link
            href="/cotizar/exterior"
            className="group bg-white border border-stone-200 rounded-2xl p-8 shadow-sm hover:shadow-lg hover:border-emerald-600/40 transition-all"
          >
            <div className="bg-emerald-50 w-14 h-14 rounded-xl flex items-center justify-center mb-6 group-hover:bg-emerald-600 transition">
              <Trees className="w-7 h-7 text-emerald-600 group-hover:text-white transition" />
            </div>
            <h2 className="text-2xl font-bold text-stone-900 mb-2">Limpieza Exterior</h2>
            <p className="text-stone-500 text-sm mb-6 leading-relaxed">
              Desbroce, barrido de calles y retiro de escombros en lotes, terrenos
              y espacios abiertos. Incluye maquinaria y tasa de escombrera.
            </p>
            <ul className="space-y-2 mb-6 text-xs text-stone-600">
              <li className="flex items-center gap-2"><ShieldCheck className="w-3.5 h-3.5 text-emerald-500" /> Vegetación, pendiente y acceso</li>
              <li className="flex items-center gap-2"><ShieldCheck className="w-3.5 h-3.5 text-emerald-500" /> Volquetas y tasa municipal</li>
              <li className="flex items-center gap-2"><ShieldCheck className="w-3.5 h-3.5 text-emerald-500" /> Movilización de maquinaria</li>
            </ul>
            <span className="inline-flex items-center gap-2 text-emerald-700 font-bold text-sm group-hover:gap-3 transition-all">
              Cotizar exterior <ArrowRight className="w-4 h-4" />
            </span>
          </Link>
        </div>

        {/* FOOTER */}
        <p className="text-center text-xs text-stone-400 mt-16">
          © 2026 CleanQuote Pro B2B · Módulo de cálculo volumétrico y bioseguridad
        </p>
      </main>
    </div>
  );
}