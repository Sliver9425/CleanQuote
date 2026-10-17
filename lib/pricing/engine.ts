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
  floorZones?: { floorMaterial: 'TILE' | 'VINYL' | 'CARPET' | 'MARBLE'; areaM2: number }[];
}

// Diccionario Base (Calibrado inicialmente para superficies pequeñas/medianas)
export const DEFAULT_EC_PARAMS = {
  cBaseHour: 4.00,      // $4.00 USD/h (SBU + Beneficios de Ley Ecuador)
  rBaseM2H: 30.0,       // RENDIMIENTO BASE: 30 m²/hora (Limpieza manual tradicional)
  overheadPct: 0.15,    // 15% gastos administrativos
  marginPct: 0.20,      // 20% margen comercial
  ivaPct: 0.15,         // 15% IVA Ecuador
  complexity: { OFFICE: 1.0, RESIDENTIAL: 1.2, HEALTH: 1.5, POST_CONSTRUCTION: 2.0 },
  floor: { TILE: 1.0, VINYL: 1.1, CARPET: 1.3, MARBLE: 1.5 },
  risk: { LOW: 1.0, MEDIUM: 1.3, HIGH: 1.5 },
  traffic: { LOW: 0.9, MEDIUM: 1.0, HIGH: 1.2 },
  
  // Costo base minorista por m2 de químico
  suppliesRateM2: { CONTINUOUS_BASIC: 0.05, SPOT_STANDARD: 0.08, CLINICAL: 0.25 },
  equipmentKitHour: { OFFICE: 0.40, RESIDENTIAL: 0.40, HEALTH: 1.00, POST_CONSTRUCTION: 2.10 },
  
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

function buildFloorZones(input: QuoteInput, params: typeof DEFAULT_EC_PARAMS, fComp: number, efficiencyScale: number) {
  if (!input.floorZones || input.floorZones.length < 2) return null;

  const merged = new Map<string, number>();
  for (const z of input.floorZones) {
    const a = Number(z.areaM2);
    if (!(z.floorMaterial in params.floor) || !Number.isFinite(a) || a <= 0) continue;
    merged.set(z.floorMaterial, (merged.get(z.floorMaterial) ?? 0) + a);
  }
  if (merged.size < 2) return null;

  const total = Array.from(merged.values()).reduce((a, b) => a + b, 0);
  const baseRate = params.rBaseM2H * efficiencyScale; // Aplicamos escala

  return Array.from(merged.entries()).map(([material, area]) => {
    const areaM2 = (area / total) * input.areaM2;
    const factor = params.floor[material as keyof typeof params.floor];
    const rate = Number((baseRate / (fComp * factor)).toFixed(2));
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

  // ==========================================
  // ECONOMÍA DE ESCALA DINÁMICA (EL CEREBRO DEL NEGOCIO)
  // ==========================================
  let efficiencyScale = 1.0;
  let suppliesDiscount = 1.0;
  let marginOverride = params.marginPct; // Permite reducir el margen en contratos estatales

  if (input.areaM2 >= 40000) {
    // TIER 1: Mega Licitaciones SERCOP (Hospitales Titánicos, Aeropuertos)
    efficiencyScale = 5.0;    // Rendimiento real con obstáculos clínicos (aprox 100 m2/h efectivos)
    suppliesDiscount = 0.03;  // Insumos de grado clínico comprados en tambores industriales
    marginOverride = 0.12;    // Margen estatal de utilidad ajustado al 12%
  } else if (input.areaM2 >= 15000) {
    // TIER 2: Mega-Instalaciones (Clínicas grandes, Malls)
    efficiencyScale = 4.0;    
    suppliesDiscount = 0.10;  
  } else if (input.areaM2 >= 5000) {
    // TIER 3: Grandes Industrias y Oficinas Corporativas
    efficiencyScale = 2.5;    
    suppliesDiscount = 0.30;  
  } else if (input.areaM2 >= 1000) {
    // TIER 4: Oficinas medianas
    efficiencyScale = 1.5;    
    suppliesDiscount = 0.60;  
  } else if (input.areaM2 >= 300) {
    // TIER 5: Oficinas pequeñas o casas grandes
    efficiencyScale = 1.2;    
    suppliesDiscount = 0.85;  
  }
  // Menos de 300 m2 mantienen los valores base minoristas puros.

  // FASE 1: Productividad y Horas-Hombre
  const baseRate = params.rBaseM2H * efficiencyScale;
  const zones = buildFloorZones(input, params, fComp, efficiencyScale);
  const zonesHours = zones ? zones.reduce((a, z) => a + z.hours, 0) : 0;
  
  const effectiveRateM2H = zones
    ? Number((input.areaM2 / zonesHours).toFixed(2))
    : Number((baseRate / (fComp * fFloor)).toFixed(2));
    
  const baseAreaHours = zones ? zonesHours : input.areaM2 / effectiveRateM2H;
  const extraBathroomsHours = input.bathroomsCount * 0.25;
  const extraWindowsHours = input.windowsM2 * 0.05;

  const hoursPerEvent = Number((baseAreaHours + extraBathroomsHours + extraWindowsHours).toFixed(2));
  const totalHoursMonth = Number((hoursPerEvent * freqConfig.eventsPerMonth).toFixed(2));

  // FASE 2: Costos Directos
  const laborCost = Number((totalHoursMonth * params.cBaseHour * fRisk * fShift).toFixed(2));
  
  const supplyRate = params.suppliesRateM2[input.disinfectionLevel] * suppliesDiscount;
  const suppliesCost = Number((input.areaM2 * freqConfig.eventsPerMonth * supplyRate * fTraffic).toFixed(2));

  const equipRate = params.equipmentKitHour[input.facilityType];
  const equipmentCost = Number((totalHoursMonth * equipRate).toFixed(2));

  const directCost = Number((laborCost + suppliesCost + equipmentCost).toFixed(2));

  // FASE 3: Indirectos y Margen
  const overheadCost = Number((directCost * params.overheadPct).toFixed(2));
  const totalCost = Number((directCost + overheadCost).toFixed(2));

  // Usamos marginOverride en lugar de params.marginPct directo
  const basePriceWithMargin = Number((totalCost / (1 - marginOverride)).toFixed(2));
  const marginAmount = Number((basePriceWithMargin - totalCost).toFixed(2));

  // ==========================================
  // REGLA DE FIDELIDAD (Límite del 8% para Grandes Superficies)
  // ==========================================
  let appliedMultiplier = freqConfig.multiplier;
  let appliedLabel = freqConfig.label;

  if (input.areaM2 >= 10000 && appliedMultiplier < 1.0) {
    appliedMultiplier = 0.92; // Max 8% de descuento
    appliedLabel = 'Mensual Fijo L-V (Descuento fidelidad ajustado a -8% por Gran Superficie)';
  }

  // Ajuste final
  const subtotalPrice = Number((basePriceWithMargin * appliedMultiplier).toFixed(2));
  const frequencyAdjustment = Number((subtotalPrice - basePriceWithMargin).toFixed(2));

  const ivaAmount = Number((subtotalPrice * params.ivaPct).toFixed(2));
  const finalPrice = Number((subtotalPrice + ivaAmount).toFixed(2));
  const pricePerM2 = Number((subtotalPrice / input.areaM2).toFixed(2));

  // Desglose para el PDF y la interfaz
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

  const lineItems = [
    {
      category: 'LABOR',
      concept: 'Mano de Obra Técnica y Bioseguridad',
      formulaUsed: `${totalHoursMonth} h/mes × $${params.cBaseHour}/h × Riesgo(${fRisk}x)`,
      explanation: `Rendimiento ajustado a ${effectiveRateM2H} m²/h por economía de escala (Complejidad ${fComp}x, Piso ${fFloor}x). Incluye ${input.bathroomsCount} baños y ${input.windowsM2} m² de vidrios.`,
      amountUsd: laborCost,
    },
    {
      category: 'SUPPLIES',
      concept: 'Insumos y Químicos de Desinfección',
      formulaUsed: `${input.areaM2} m² × ${freqConfig.eventsPerMonth} evt × $${supplyRate.toFixed(4)}/m² × Tráfico(${fTraffic}x)`,
      explanation: `Químicos de desinfección ${nombresDesinfeccion[input.disinfectionLevel] || input.disinfectionLevel} con precio ajustado por volumen.`,
      amountUsd: suppliesCost,
    },
    {
      category: 'EQUIPMENT',
      concept: 'Amortización de Maquinaria y Equipos',
      formulaUsed: `${totalHoursMonth} h/mes × $${equipRate}/h`,
      explanation: `Depreciación por hora de uso de maquinaria industrial para ${nombresInstalacion[input.facilityType] || input.facilityType}.`,
      amountUsd: equipmentCost,
    },
    {
      category: 'OVERHEAD',
      concept: 'Gastos Administrativos y Supervisión',
      formulaUsed: `15% sobre Costo Directo ($${directCost})`,
      explanation: `Cubre supervisión operativa, coordinación y logística.`,
      amountUsd: overheadCost,
    },
    {
      category: 'MARGIN',
      concept: `Margen Comercial (${marginOverride * 100}%)`,
      formulaUsed: `Costo Total ($${totalCost}) / (1 - ${marginOverride})`,
      explanation: `Utilidad bruta comercial antes de ajustes de recurrencia.`,
      amountUsd: marginAmount,
    },
    {
      category: 'DISCOUNT_SURCHARGE',
      concept: 'Ajuste por Frecuencia y Fidelidad',
      formulaUsed: `Factor ${appliedMultiplier}x sobre Precio Base`,
      explanation: appliedLabel,
      amountUsd: frequencyAdjustment,
    }
  ];

  if (zones) {
    const extrasHours = extraBathroomsHours + extraWindowsHours;
    const totalWeight = baseAreaHours + extrasHours;
    const parts = [
      ...zones.map((z) => ({
        hours: z.hours,
        concept: `Mano de Obra – Piso ${FLOOR_NAMES[z.floorMaterial] || z.floorMaterial} (${Number(z.areaM2.toFixed(1))} m²)`,
        formula: `${Number(z.areaM2.toFixed(1))} m² ÷ ${z.rate} m²/h × ${freqConfig.eventsPerMonth} eventos × $${params.cBaseHour}/h × Riesgo(${fRisk}x)`,
        explanation: `Rendimiento de ${z.rate} m²/h para este piso.`,
      })),
      ...(extrasHours > 0
        ? [{
            hours: extrasHours,
            concept: 'Mano de Obra – Baños y Ventanas',
            formula: `(${input.bathroomsCount} baños + ${input.windowsM2} m² vidrios) × ${freqConfig.eventsPerMonth} evt × $${params.cBaseHour}/h`,
            explanation: `Incluye mantenimiento de baterías sanitarias y zonas acristaladas.`,
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