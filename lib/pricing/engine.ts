// src/lib/pricing/engine.ts

export interface QuoteInput {
  areaM2: number;
  bathroomsCount: number;
  windowsM2: number;
  facilityType: 'OFFICE' | 'RESIDENTIAL' | 'HEALTH' | 'POST_CONSTRUCTION';
  floorMaterial: 'TILE' | 'VINYL' | 'CARPET' | 'MARBLE';
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  trafficLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  disinfectionLevel: 'CONTINUOUS_BASIC' | 'SPOT_STANDARD' | 'CLINICAL';
  frequencyType: 'SPOT' | 'WEEKLY' | 'MONTHLY_DAILY';
  isNightShift?: boolean;
  // OPCIONAL: pisos mixtos. Con 2+ materiales distintos, la mano de obra se calcula por zona.
  // Sin este campo (o con un solo material) el cálculo es exactamente el de siempre.
  floorZones?: { floorMaterial: 'TILE' | 'VINYL' | 'CARPET' | 'MARBLE'; areaM2: number }[];
}

// Diccionario de factores por defecto (Mercado Ecuador)
export const DEFAULT_EC_PARAMS = {
  cBaseHour: 4.00,      // $4.00 USD/h (SBU $470 + IESS + Décimos + EPP básico)
  rBaseM2H: 30.0,       // 30 m²/hora estándar
  overheadPct: 0.15,    // 15% gastos administrativos
  marginPct: 0.20,      // 20% margen comercial sobre precio
  ivaPct: 0.15,         // 15% IVA Ecuador
  complexity: { OFFICE: 1.0, RESIDENTIAL: 1.2, HEALTH: 1.4, POST_CONSTRUCTION: 2.0 },
  floor: { TILE: 1.0, VINYL: 1.1, CARPET: 1.3, MARBLE: 1.5 },
  risk: { LOW: 1.0, MEDIUM: 1.3, HIGH: 1.5 },
  traffic: { LOW: 0.9, MEDIUM: 1.0, HIGH: 1.2 },
  suppliesRateM2: { CONTINUOUS_BASIC: 0.05, SPOT_STANDARD: 0.10, CLINICAL: 0.35 },
  equipmentKitHour: { OFFICE: 0.40, RESIDENTIAL: 0.40, HEALTH: 1.33, POST_CONSTRUCTION: 2.10 },
  frequency: {
    SPOT: { multiplier: 1.10, eventsPerMonth: 1, label: 'Servicio Único (Recargo logístico +10%)' },
    WEEKLY: { multiplier: 1.00, eventsPerMonth: 4.33, label: 'Semanal Estándar (4.33 visitas/mes)' },
    MONTHLY_DAILY: { multiplier: 0.85, eventsPerMonth: 20, label: 'Mensual Fijo L-V (Descuento fidelidad -15%)' },
  }
};

const FLOOR_NAMES: Record<string, string> = {
  TILE: 'Baldosa / Cerámica',
  VINYL: 'Vinílico / PVC',
  CARPET: 'Alfombra',
  MARBLE: 'Mármol / Piedra',
};

// Devuelve las zonas de piso (una por material) o null si NO hay pisos mixtos.
function buildFloorZones(input: QuoteInput, params: typeof DEFAULT_EC_PARAMS, fComp: number) {
  if (!input.floorZones || input.floorZones.length < 2) return null;

  const merged = new Map<string, number>();
  for (const z of input.floorZones) {
    const a = Number(z.areaM2);
    if (!(z.floorMaterial in params.floor) || !Number.isFinite(a) || a <= 0) continue;
    merged.set(z.floorMaterial, (merged.get(z.floorMaterial) ?? 0) + a);
  }
  if (merged.size < 2) return null;

  // Se reescala a input.areaM2 para que el total siempre coincida con el área cotizada
  const total = Array.from(merged.values()).reduce((a, b) => a + b, 0);
  return Array.from(merged.entries()).map(([material, area]) => {
    const areaM2 = (area / total) * input.areaM2;
    const factor = params.floor[material as keyof typeof params.floor];
    const rate = Number((params.rBaseM2H / (fComp * factor)).toFixed(2));
    return { floorMaterial: material, areaM2, factor, rate, hours: areaM2 / rate };
  });
}

export function calculateCleanQuote(input: QuoteInput, params = DEFAULT_EC_PARAMS) {
  const fComp = params.complexity[input.facilityType];
  const fFloor = params.floor[input.floorMaterial];
  const fRisk = params.risk[input.riskLevel];
  const fTraffic = params.traffic[input.trafficLevel];
  const fShift = input.isNightShift ? 1.25 : 1.0;
  const freqConfig = params.frequency[input.frequencyType];

  // FASE 1: Productividad y Horas-Hombre
  const zones = buildFloorZones(input, params, fComp);
  const zonesHours = zones ? zones.reduce((a, z) => a + z.hours, 0) : 0;
  const effectiveRateM2H = zones
    ? Number((input.areaM2 / zonesHours).toFixed(2))
    : Number((params.rBaseM2H / (fComp * fFloor)).toFixed(2));
  const baseAreaHours = zones ? zonesHours : input.areaM2 / effectiveRateM2H;
  const extraBathroomsHours = input.bathroomsCount * 0.25;
  const extraWindowsHours = input.windowsM2 * 0.05;

  const hoursPerEvent = Number((baseAreaHours + extraBathroomsHours + extraWindowsHours).toFixed(2));
  const totalHoursMonth = Number((hoursPerEvent * freqConfig.eventsPerMonth).toFixed(2));

  // FASE 2: Costos Directos
  const laborCost = Number((totalHoursMonth * params.cBaseHour * fRisk * fShift).toFixed(2));
  
  const supplyRate = params.suppliesRateM2[input.disinfectionLevel];
  const suppliesCost = Number((input.areaM2 * freqConfig.eventsPerMonth * supplyRate * fTraffic).toFixed(2));

  const equipRate = params.equipmentKitHour[input.facilityType];
  const equipmentCost = Number((totalHoursMonth * equipRate).toFixed(2));

  const directCost = Number((laborCost + suppliesCost + equipmentCost).toFixed(2));

  // FASE 3: Indirectos, Margen, Frecuencia e IVA
  const overheadCost = Number((directCost * params.overheadPct).toFixed(2));
  const totalCost = Number((directCost + overheadCost).toFixed(2));

  // Precio base con margen financiero real: Costo / (1 - Margen)
  const basePriceWithMargin = Number((totalCost / (1 - params.marginPct)).toFixed(2));
  const marginAmount = Number((basePriceWithMargin - totalCost).toFixed(2));

  // Ajuste por Frecuencia (Spot +10% o Mensual -15%)
  const subtotalPrice = Number((basePriceWithMargin * freqConfig.multiplier).toFixed(2));
  const frequencyAdjustment = Number((subtotalPrice - basePriceWithMargin).toFixed(2));

  const ivaAmount = Number((subtotalPrice * params.ivaPct).toFixed(2));
  const finalPrice = Number((subtotalPrice + ivaAmount).toFixed(2));
  const pricePerM2 = Number((subtotalPrice / input.areaM2).toFixed(2));

  const nombresDesinfeccion: Record<string, string> = {
      SPOT_STANDARD: "Estándar",
      CONTINUOUS_BASIC: "Continua Básica",
      CLINICAL: "Nivel Clínico"
    };

    const nombresInstalacion: Record<string, string> = {
      OFFICE: "Oficinas",
      RESIDENTIAL: "Residencial",
      HEALTH: "Áreas de Salud/Clínicas",
      POST_CONSTRUCTION: "Post-Construcción"
    };
  // Desglose explicable para renderizar en las tarjetas/tablas de Tailwind CSS
const lineItems = [
    {
      category: 'LABOR',
      concept: 'Mano de Obra Técnica y Bioseguridad',
      formulaUsed: `${totalHoursMonth} h/mes × $${params.cBaseHour}/h × Riesgo(${fRisk}x)`,
      explanation: `Rendimiento ajustado a ${effectiveRateM2H} m²/h (Complejidad ${fComp}x, Piso ${fFloor}x). Incluye ${input.bathroomsCount} baños y ${input.windowsM2} m² de vidrios.`,
      amountUsd: laborCost,
    },
    {
      category: 'SUPPLIES',
      concept: 'Insumos y Químicos de Desinfección',
      formulaUsed: `${input.areaM2} m² × ${freqConfig.eventsPerMonth} eventos × $${supplyRate}/m² × Tráfico(${fTraffic}x)`,
      // AQUÍ TRADUCIMOS EL NIVEL DE DESINFECCIÓN:
      explanation: `Químicos de desinfección ${nombresDesinfeccion[input.disinfectionLevel] || input.disinfectionLevel} ajustados al flujo de personas.`,
      amountUsd: suppliesCost,
    },
    {
      category: 'EQUIPMENT',
      concept: 'Amortización de Maquinaria y Equipos',
      formulaUsed: `${totalHoursMonth} h/mes × $${equipRate}/h`,
      // AQUÍ TRADUCIMOS EL TIPO DE ESTABLECIMIENTO:
      explanation: `Depreciación por hora de uso del kit de maquinaria para ${nombresInstalacion[input.facilityType] || input.facilityType}.`,
      amountUsd: equipmentCost,
    },
    {
      category: 'OVERHEAD',
      concept: 'Gastos Administrativos y Supervisión (Overhead)',
      formulaUsed: `15% sobre Costo Directo ($${directCost})`,
      explanation: `Cubre supervisión operativa, coordinación y logística administrativa.`,
      amountUsd: overheadCost,
    },
    {
      category: 'MARGIN',
      concept: 'Margen Comercial (20%)',
      formulaUsed: `Costo Total ($${totalCost}) / (1 - 0.20)`,
      explanation: `Utilidad bruta comercial antes de ajustes de recurrencia.`,
      amountUsd: marginAmount,
    },
    {
      category: 'DISCOUNT_SURCHARGE',
      concept: 'Ajuste por Frecuencia y Fidelidad',
      formulaUsed: `Factor ${freqConfig.multiplier}x sobre Precio Base`,
      explanation: freqConfig.label,
      amountUsd: frequencyAdjustment,
    }
  ];

  // PISOS MIXTOS: la línea de mano de obra se reemplaza por una línea por tipo de piso
  // (+ una de baños/ventanas). Las partes suman exactamente laborCost.
  if (zones) {
    const extrasHours = extraBathroomsHours + extraWindowsHours;
    const totalWeight = baseAreaHours + extrasHours;
    const parts = [
      ...zones.map((z) => ({
        hours: z.hours,
        concept: `Mano de Obra – Piso ${FLOOR_NAMES[z.floorMaterial] || z.floorMaterial} (${Number(z.areaM2.toFixed(1))} m²)`,
        formula: `${Number(z.areaM2.toFixed(1))} m² ÷ ${z.rate} m²/h × ${freqConfig.eventsPerMonth} eventos × $${params.cBaseHour}/h × Riesgo(${fRisk}x)`,
        explanation: `Rendimiento de ${z.rate} m²/h para este piso (Complejidad ${fComp}x, Piso ${z.factor}x).`,
      })),
      ...(extrasHours > 0
        ? [{
            hours: extrasHours,
            concept: 'Mano de Obra – Baños y Ventanas',
            formula: `(${input.bathroomsCount} baños × 0.25 h + ${input.windowsM2} m² × 0.05 h) × ${freqConfig.eventsPerMonth} eventos × $${params.cBaseHour}/h × Riesgo(${fRisk}x)`,
            explanation: `Incluye ${input.bathroomsCount} baños y ${input.windowsM2} m² de vidrios.`,
          }]
        : []),
    ];

    let allocated = 0;
    const zoneItems = parts.map((p, i) => {
      const isLast = i === parts.length - 1;
      const amount = isLast
        ? Number((laborCost - allocated).toFixed(2))
        : Number(((laborCost * p.hours) / totalWeight).toFixed(2));
      allocated = Number((allocated + amount).toFixed(2));
      return {
        category: 'LABOR',
        concept: p.concept,
        formulaUsed: p.formula,
        explanation: p.explanation,
        amountUsd: amount,
      };
    });
    lineItems.splice(0, 1, ...zoneItems);
  }
  

  return {
    effectiveRateM2H,
    hoursPerEvent,
    totalHoursMonth,
    directCost,
    overheadCost,
    totalCost,
    subtotalPrice,
    ivaAmount,
    finalPrice,
    pricePerM2,
    lineItems,
    parameterSnapshot: zones
      ? {
          ...params,
          floorZones: zones.map((z) => ({
            floorMaterial: z.floorMaterial,
            areaM2: Number(z.areaM2.toFixed(2)),
            ratePerHour: z.rate,
            floorFactor: z.factor,
          })),
        }
      : params,
  };
}