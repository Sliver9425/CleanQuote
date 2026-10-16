// src/lib/pricing/exteriorEngine.ts

export type ExteriorService = 'DESBROCE' | 'BARRIDO_CALLES' | 'RETIRO_ESCOMBROS';
export type VegetationLevel = 'LIGHT' | 'MEDIUM' | 'SEVERE';
export type TerrainSlope = 'FLAT' | 'MODERATE' | 'STEEP';
export type Accessibility = 'MACHINERY' | 'MANUAL_ONLY' | 'MIXED';
export type DebrisType = 'CONSTRUCTION' | 'VEGETAL' | 'MIXED' | 'DOMESTIC';

export interface ExteriorQuoteInput {
  // Servicios solicitados (puede ser más de uno)
  servicesRequested: ExteriorService[];

  // Dimensiones
  areaM2: number;
  linearMeters?: number; // para barrido de calles/aceras

  // Condición del terreno
  vegetationLevel: VegetationLevel;
  terrainSlope: TerrainSlope;
  accessibility: Accessibility;
  hasTrees?: boolean;

  // Escombros
  debrisVolumeM3?: number;
  debrisType?: DebrisType;

  // Logística
  distanceToDumpKm?: number;
  mobilizationNeeded?: boolean;

  // Frecuencia (mismo esquema que interior)
  frequencyType: 'SPOT' | 'WEEKLY' | 'MONTHLY_DAILY';
}

// ============================================================
// Parámetros por defecto (Mercado Ecuador 2025-2026)
// ============================================================
export const DEFAULT_EXTERIOR_EC_PARAMS = {
  // Tarifas base
  baseRateDesbroceM2: 0.15,      // desbroce mecánico, sin retiro
  baseRateDesbroceManual: 3.60,  // desbroce manual con arbustos y carga
  baseRateBarridoML: 0.80,       // por metro lineal de calle/acera

  // Factores de vegetación
  vegetation: {
    LIGHT: 1.0,
    MEDIUM: 5.0,
    SEVERE: 15.0,
  },

  // Factores de pendiente
  slope: {
    FLAT: 1.00,
    MODERATE: 1.15,
    STEEP: 1.30,
  },

  // Factor de acceso
  access: {
    MACHINERY: 1.00,
    MIXED: 1.20,
    MANUAL_ONLY: 1.40,
  },

  // Recargo por árboles (poda / tala menor)
  treesSurchargeM2: 0.25,

  // Escombros
  volquetaCapacityM3: 8.0,
  costVolquetaTrip: 30.0,        // ajustar con cotización real
  dumpFeeM3: 0.57,               // Quito 2025

  // Movilización
  mobilizationBase: 50.0,
  mobilizationPerKm: 1.20,

  // Financieros
  overheadPct: 0.15,
  marginPct: 0.20,
  ivaPct: 0.15,

  // Frecuencia (mismo esquema que interior)
  frequency: {
    SPOT:          { multiplier: 1.10, eventsPerMonth: 1,    label: 'Servicio Único (Recargo logístico +10%)' },
    WEEKLY:        { multiplier: 1.00, eventsPerMonth: 4.33, label: 'Semanal Estándar (4.33 visitas/mes)' },
    MONTHLY_DAILY: { multiplier: 0.85, eventsPerMonth: 20,   label: 'Mensual Fijo L-V (Descuento fidelidad -15%)' },
  },
};

// ============================================================
// Motor de cálculo
// ============================================================
export function calculateExteriorQuote(
  input: ExteriorQuoteInput,
  params = DEFAULT_EXTERIOR_EC_PARAMS
) {
  const fVeg    = params.vegetation[input.vegetationLevel];
  const fSlope  = params.slope[input.terrainSlope];
  const fAccess = params.access[input.accessibility];
  const freqConfig = params.frequency[input.frequencyType];

  const wantsDesbroce   = input.servicesRequested.includes('DESBROCE');
  const wantsBarrido    = input.servicesRequested.includes('BARRIDO_CALLES');
  const wantsEscombros  = input.servicesRequested.includes('RETIRO_ESCOMBROS');

  // ------------------------------------------------------------
  // FASE 1: DESBROCE
  // ------------------------------------------------------------
  const isManual = input.accessibility === 'MANUAL_ONLY';
  const baseRateM2 = isManual
    ? params.baseRateDesbroceManual
    : params.baseRateDesbroceM2;

  const vegetationFactor = isManual ? 1.0 : fVeg; // si ya es manual, la tarifa ya incluye maleza
  const slopeFactor      = fSlope;
  const accessFactor     = fAccess;

  const effectiveRateM2 = Number(
    (baseRateM2 * vegetationFactor * slopeFactor * accessFactor).toFixed(4)
  );

  const treesExtra = input.hasTrees ? input.areaM2 * params.treesSurchargeM2 : 0;

  const cleaningCost = wantsDesbroce
    ? Number((input.areaM2 * effectiveRateM2 + treesExtra).toFixed(2))
    : 0;

  // ------------------------------------------------------------
  // FASE 2: BARRIDO DE CALLES (por metro lineal)
  // ------------------------------------------------------------
  const linearMeters = input.linearMeters ?? 0;
  const barridoCost = wantsBarrido
    ? Number((linearMeters * params.baseRateBarridoML * fAccess).toFixed(2))
    : 0;

  // ------------------------------------------------------------
  // FASE 3: RETIRO DE ESCOMBROS
  // ------------------------------------------------------------
  const debrisVolume = input.debrisVolumeM3 ?? 0;
  const volquetasEstimated = debrisVolume > 0
    ? Math.ceil(debrisVolume / params.volquetaCapacityM3)
    : 0;

  const debrisTransportCost = volquetasEstimated * params.costVolquetaTrip;
  const debrisDumpFee       = debrisVolume * params.dumpFeeM3;
  const debrisDisposalCost  = wantsEscombros
    ? Number((debrisTransportCost + debrisDumpFee).toFixed(2))
    : 0;

  // ------------------------------------------------------------
  // FASE 4: MOVILIZACIÓN
  // ------------------------------------------------------------
  const km = input.distanceToDumpKm ?? 0;
  const mobilizationCost = input.mobilizationNeeded
    ? Number((params.mobilizationBase + km * params.mobilizationPerKm).toFixed(2))
    : 0;

  // ------------------------------------------------------------
  // FASE 5: COSTO DIRECTO TOTAL
  // ------------------------------------------------------------
  const directCost = Number(
    (cleaningCost + barridoCost + debrisDisposalCost + mobilizationCost).toFixed(2)
  );

  // ------------------------------------------------------------
  // FASE 6: OVERHEAD, MARGEN, FRECUENCIA, IVA
  // ------------------------------------------------------------
  const overheadCost = Number((directCost * params.overheadPct).toFixed(2));
  const totalCost    = Number((directCost + overheadCost).toFixed(2));

  const basePriceWithMargin = Number((totalCost / (1 - params.marginPct)).toFixed(2));
  const marginAmount = Number((basePriceWithMargin - totalCost).toFixed(2));

  const subtotalPrice = Number((basePriceWithMargin * freqConfig.multiplier).toFixed(2));
  const frequencyAdjustment = Number((subtotalPrice - basePriceWithMargin).toFixed(2));

  const ivaAmount  = Number((subtotalPrice * params.ivaPct).toFixed(2));
  const finalPrice = Number((subtotalPrice + ivaAmount).toFixed(2));

  const billableArea = input.areaM2 > 0 ? input.areaM2 : linearMeters;
  const pricePerM2 = billableArea > 0
    ? Number((subtotalPrice / billableArea).toFixed(2))
    : 0;

  // ------------------------------------------------------------
  // Nombres traducidos para la UI
  // ------------------------------------------------------------
  const nombresVegetacion: Record<VegetationLevel, string> = {
    LIGHT:  'Ligera (pasto alto)',
    MEDIUM: 'Media (maleza densa y arbustos)',
    SEVERE: 'Severa (vegetación leñosa, abandono)',
  };
  const nombresPendiente: Record<TerrainSlope, string> = {
    FLAT:     'Plana',
    MODERATE: 'Moderada',
    STEEP:    'Pronunciada',
  };
  const nombresAcceso: Record<Accessibility, string> = {
    MACHINERY:   'Con maquinaria',
    MIXED:       'Mixto',
    MANUAL_ONLY: 'Solo manual',
  };

  // ------------------------------------------------------------
  // LINE ITEMS explicables para Tailwind
  // ------------------------------------------------------------
  const lineItems: Array<{
    category: string;
    concept: string;
    formulaUsed: string;
    explanation: string;
    amountUsd: number;
  }> = [];

  if (wantsDesbroce) {
    lineItems.push({
      category: 'LABOR',
      concept: 'Desbroce y limpieza vegetal',
      formulaUsed: `${input.areaM2} m² × $${effectiveRateM2}/m²`,
      explanation: `Tarifa base $${baseRateM2}/m² (${isManual ? 'manual' : 'mecánica'}) × Vegetación(${vegetationFactor}x) × Pendiente(${slopeFactor}x) × Acceso(${accessFactor}x). Vegetación: ${nombresVegetacion[input.vegetationLevel]}. Pendiente: ${nombresPendiente[input.terrainSlope]}. Acceso: ${nombresAcceso[input.accessibility]}.`,
      amountUsd: cleaningCost,
    });

    if (input.hasTrees && treesExtra > 0) {
      lineItems.push({
        category: 'LABOR',
        concept: 'Recargo por árboles (poda / tala menor)',
        formulaUsed: `${input.areaM2} m² × $${params.treesSurchargeM2}/m²`,
        explanation: 'Manejo especial de árboles: motosierra, retiro de ramas, protocolo de seguridad.',
        amountUsd: Number(treesExtra.toFixed(2)),
      });
    }
  }

  if (wantsBarrido) {
    lineItems.push({
      category: 'LABOR',
      concept: 'Barrido de calles y aceras',
      formulaUsed: `${linearMeters} ml × $${params.baseRateBarridoML}/ml × Acceso(${fAccess}x)`,
      explanation: 'Barrido manual o mecánico de superficies lineales (calles, aceras, bordillos).',
      amountUsd: barridoCost,
    });
  }

  if (wantsEscombros && debrisDisposalCost > 0) {
    lineItems.push({
      category: 'DEBRIS_DISPOSAL',
      concept: 'Retiro y desalojo de escombros',
      formulaUsed: `${volquetasEstimated} viaje(s) × $${params.costVolquetaTrip} + ${debrisVolume} m³ × $${params.dumpFeeM3}`,
      explanation: `Transporte en volqueta (${params.volquetaCapacityM3} m³/viaje) + tasa municipal de escombrera autorizada. Tipo de escombro: ${input.debrisType ?? 'N/A'}.`,
      amountUsd: debrisDisposalCost,
    });
  }

  if (mobilizationCost > 0) {
    lineItems.push({
      category: 'MOBILIZATION',
      concept: 'Movilización de maquinaria y personal',
      formulaUsed: `$${params.mobilizationBase} base + ${km} km × $${params.mobilizationPerKm}/km`,
      explanation: 'Traslado de minicargadora, herramienta y personal al sitio.',
      amountUsd: mobilizationCost,
    });
  }

  lineItems.push({
    category: 'OVERHEAD',
    concept: 'Gastos Administrativos y Supervisión (Overhead)',
    formulaUsed: `${(params.overheadPct * 100).toFixed(0)}% sobre Costo Directo ($${directCost})`,
    explanation: 'Cubre supervisión operativa, coordinación y logística administrativa.',
    amountUsd: overheadCost,
  });

  lineItems.push({
    category: 'MARGIN',
    concept: `Margen Comercial (${(params.marginPct * 100).toFixed(0)}%)`,
    formulaUsed: `Costo Total ($${totalCost}) / (1 - ${params.marginPct})`,
    explanation: 'Utilidad bruta comercial antes de ajustes de recurrencia.',
    amountUsd: marginAmount,
  });

  lineItems.push({
    category: 'DISCOUNT_SURCHARGE',
    concept: 'Ajuste por Frecuencia y Fidelidad',
    formulaUsed: `Factor ${freqConfig.multiplier}x sobre Precio Base`,
    explanation: freqConfig.label,
    amountUsd: frequencyAdjustment,
  });

  // ------------------------------------------------------------
  // RETORNO
  // ------------------------------------------------------------
  return {
    // Dimensiones
    areaM2: input.areaM2,
    linearMeters,

    // Factores aplicados (snapshot)
    baseRateM2,
    vegetationFactor,
    slopeFactor,
    accessFactor,
    effectiveRateM2,

    // Resultados por rubro
    cleaningCost,
    barridoCost,
    debrisDisposalCost,
    mobilizationCost,

    // Escombros
    volquetasEstimated,
    debrisVolumeM3: debrisVolume,

    // Totales
    directCost,
    overheadCost,
    totalCost,
    subtotalPrice,
    ivaAmount,
    finalPrice,
    pricePerM2,

    // Desglose y snapshot
    lineItems,
    parameterSnapshot: params,
  };
}