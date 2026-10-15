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

export function calculateCleanQuote(input: QuoteInput, params = DEFAULT_EC_PARAMS) {
  const fComp = params.complexity[input.facilityType];
  const fFloor = params.floor[input.floorMaterial];
  const fRisk = params.risk[input.riskLevel];
  const fTraffic = params.traffic[input.trafficLevel];
  const fShift = input.isNightShift ? 1.25 : 1.0;
  const freqConfig = params.frequency[input.frequencyType];

  // FASE 1: Productividad y Horas-Hombre
  const effectiveRateM2H = Number((params.rBaseM2H / (fComp * fFloor)).toFixed(2));
  const baseAreaHours = input.areaM2 / effectiveRateM2H;
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
    parameterSnapshot: params,
  };
}