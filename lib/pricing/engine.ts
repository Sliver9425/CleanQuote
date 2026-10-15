// lib/pricing/engine.ts
// Motor de cálculo alineado con los campos del schema.prisma de CleanQuote.

export const BASE_PARAMS = {
  laborCostPerHour: 4,
  baseProductivityM2H: 30,
  overheadPct: 0.15,
  marginPct: 0.2,
  ivaPct: 0.15,
} as const;

export const FACTORS = {
  facilityComplexity: {
    OFFICE: 1,
    RESIDENTIAL: 1.2,
    HEALTH: 1.4,
    INDUSTRIAL: 2,
  },
  floor: { TILE: 1, VINYL: 1.1, CARPET: 1.3, MARBLE: 1.5 },
  risk: { LOW: 1, MEDIUM: 1.3, HIGH: 1.5 },
  traffic: { LOW: 0.9, MEDIUM: 1, HIGH: 1.2 },
  disinfectionSupplyRate: {
    BASIC: 0.05,
    STANDARD_SPOT: 0.1,
    CLINICAL: 0.35,
  },
  equipmentHourlyCost: { BASIC: 0.4, FLOOR: 1.33, INDUSTRIAL: 2.1 },
  frequency: { SPOT: 1.1, WEEKLY: 1, MONTHLY_DAILY: 0.85 },
  shift: { DIURNO: 1, NOCTURNO: 1.25 },
} as const;

export type FacilityType = keyof typeof FACTORS.facilityComplexity;
export type FloorMaterial = keyof typeof FACTORS.floor;
export type RiskLevel = keyof typeof FACTORS.risk;
export type TrafficLevel = keyof typeof FACTORS.traffic;
export type DisinfectionLevel = keyof typeof FACTORS.disinfectionSupplyRate;
export type FrequencyType = keyof typeof FACTORS.frequency;
export type ShiftType = keyof typeof FACTORS.shift;
export type EquipmentKit = keyof typeof FACTORS.equipmentHourlyCost;

export type QuoteParams = {
  clientName: string;
  clientEmail?: string | null;
  facilityName: string;
  facilityType: FacilityType;
  floorMaterial: FloorMaterial;
  areaM2: number;
  bathroomsCount: number;
  windowsM2: number;
  riskLevel: RiskLevel;
  trafficLevel: TrafficLevel;
  disinfectionLevel: DisinfectionLevel;
  frequencyType?: FrequencyType;
  eventsPerMonth: number;
  shiftType?: ShiftType;
  equipmentKit?: EquipmentKit;
  discountCode?: string;
};

export type QuoteLineItem = {
  category: string;
  concept: string;
  formulaUsed: string;
  explanation: string;
  amountUsd: number;
};

export type CleanQuoteResult = {
  effectiveRateM2H: number;
  hoursPerEvent: number;
  totalHoursMonth: number;
  directCost: number;
  overheadCost: number;
  totalCost: number;
  marginPct: number;
  subtotalPrice: number;
  ivaAmount: number;
  finalPrice: number;
  pricePerM2: number;
  frequencyType: FrequencyType;
  discountPct: number;
  discountAmount: number;
  parameterSnapshot: Record<string, unknown>;
  lineItems: QuoteLineItem[];
};

const money = (value: number) => Number(value.toFixed(2));

function assertEnum(name: string, value: string, options: object): void {
  if (!Object.prototype.hasOwnProperty.call(options, value)) {
    throw new Error(`Valor no válido para ${name}: ${value}`);
  }
}

function inferFrequency(eventsPerMonth: number): FrequencyType {
  if (eventsPerMonth <= 1) return "SPOT";
  if (eventsPerMonth >= 20) return "MONTHLY_DAILY";
  return "WEEKLY";
}

export function calculateCleanQuote(params: QuoteParams): CleanQuoteResult {
  const numericFields: [string, number][] = [
    ["Superficie", params.areaM2],
    ["Cantidad de baños", params.bathroomsCount],
    ["Área de ventanas", params.windowsM2],
    ["Visitas al mes", params.eventsPerMonth],
  ];
  for (const [name, value] of numericFields) {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`${name} debe ser un número válido no negativo.`);
    }
  }
  if (params.areaM2 <= 0)
    throw new Error("La superficie debe ser mayor que cero.");
  if (params.eventsPerMonth <= 0)
    throw new Error("Las visitas al mes deben ser mayores que cero.");
  if (!Number.isInteger(params.bathroomsCount))
    throw new Error("La cantidad de baños debe ser un entero.");

  assertEnum(
    "tipo de instalación",
    params.facilityType,
    FACTORS.facilityComplexity,
  );
  assertEnum("material del piso", params.floorMaterial, FACTORS.floor);
  assertEnum("riesgo", params.riskLevel, FACTORS.risk);
  assertEnum("tráfico", params.trafficLevel, FACTORS.traffic);
  assertEnum(
    "desinfección",
    params.disinfectionLevel,
    FACTORS.disinfectionSupplyRate,
  );

  const frequencyType =
    params.frequencyType ?? inferFrequency(params.eventsPerMonth);
  const shiftType = params.shiftType ?? "DIURNO";
  const equipmentKit = params.equipmentKit ?? "BASIC";
  assertEnum("frecuencia", frequencyType, FACTORS.frequency);
  assertEnum("turno", shiftType, FACTORS.shift);
  assertEnum("kit de equipos", equipmentKit, FACTORS.equipmentHourlyCost);

  const complexityFactor = FACTORS.facilityComplexity[params.facilityType];
  const floorFactor = FACTORS.floor[params.floorMaterial];
  const effectiveRateM2H =
    BASE_PARAMS.baseProductivityM2H / (complexityFactor * floorFactor);
  const hoursPerEvent =
    params.areaM2 / effectiveRateM2H +
    params.bathroomsCount * 0.25 +
    params.windowsM2 * 0.05;
  const totalHoursMonth = hoursPerEvent * params.eventsPerMonth;

  const laborCost =
    totalHoursMonth *
    BASE_PARAMS.laborCostPerHour *
    FACTORS.risk[params.riskLevel] *
    FACTORS.shift[shiftType];
  const suppliesCost =
    params.areaM2 *
    params.eventsPerMonth *
    FACTORS.disinfectionSupplyRate[params.disinfectionLevel] *
    FACTORS.traffic[params.trafficLevel];
  const equipmentCost =
    totalHoursMonth * FACTORS.equipmentHourlyCost[equipmentKit];
  const directCost = laborCost + suppliesCost + equipmentCost;
  const overheadCost = directCost * BASE_PARAMS.overheadPct;
  const totalCost = directCost + overheadCost;
  const basePrice = totalCost / (1 - BASE_PARAMS.marginPct);
  const frequencyFactor = FACTORS.frequency[frequencyType];
  const subtotalPrice = basePrice * frequencyFactor;
  const ivaAmount = subtotalPrice * BASE_PARAMS.ivaPct;
  const finalPrice = subtotalPrice + ivaAmount;
  const commercialMargin = basePrice - totalCost;
  const frequencyAdjustment = subtotalPrice - basePrice;

  const lineItems: QuoteLineItem[] = [
    {
      category: "LABOR",
      concept: "Mano de obra",
      formulaUsed:
        "horas mensuales × costo/hora × factor de riesgo × factor de turno",
      explanation: `${totalHoursMonth.toFixed(2)} h/mes × $${BASE_PARAMS.laborCostPerHour}/h; complejidad ${complexityFactor}x, piso ${floorFactor}x, riesgo ${FACTORS.risk[params.riskLevel]}x, turno ${FACTORS.shift[shiftType]}x.`,
      amountUsd: money(laborCost),
    },
    {
      category: "SUPPLIES",
      concept: "Insumos y químicos",
      formulaUsed: "m² × eventos/mes × tarifa de insumos × factor de tráfico",
      explanation: `${params.areaM2} m² × ${params.eventsPerMonth} eventos × $${FACTORS.disinfectionSupplyRate[params.disinfectionLevel]}/m² × tráfico ${FACTORS.traffic[params.trafficLevel]}x.`,
      amountUsd: money(suppliesCost),
    },
    {
      category: "EQUIPMENT",
      concept: "Equipos y maquinaria",
      formulaUsed: "horas mensuales × costo horario del kit",
      explanation: `Kit ${equipmentKit}: $${FACTORS.equipmentHourlyCost[equipmentKit]}/h × ${totalHoursMonth.toFixed(2)} h/mes.`,
      amountUsd: money(equipmentCost),
    },
    {
      category: "OVERHEAD",
      concept: "Costos indirectos (overhead)",
      formulaUsed: "costos directos × porcentaje de costos indirectos",
      explanation: `${BASE_PARAMS.overheadPct * 100}% de los costos directos.`,
      amountUsd: money(overheadCost),
    },
    {
      category: "MARGIN",
      concept: "Margen comercial",
      formulaUsed: "precio base − costo total operativo",
      explanation: `Margen objetivo del ${BASE_PARAMS.marginPct * 100}%, antes del ajuste de frecuencia.`,
      amountUsd: money(commercialMargin),
    },
    {
      category: "DISCOUNT_SURCHARGE",
      concept: "Ajuste por frecuencia",
      formulaUsed: "precio base × (factor de frecuencia − 1)",
      explanation: `Frecuencia ${frequencyType}; factor ${frequencyFactor}x.`,
      amountUsd: money(frequencyAdjustment),
    },
    {
      category: "TAX",
      concept: "IVA",
      formulaUsed: "subtotal × porcentaje de IVA",
      explanation: `IVA del ${BASE_PARAMS.ivaPct * 100}% aplicado al subtotal.`,
      amountUsd: money(ivaAmount),
    },
  ];

  const parameterSnapshot = {
    base: BASE_PARAMS,
    factors: FACTORS,
    inputs: {
      facilityType: params.facilityType,
      floorMaterial: params.floorMaterial,
      areaM2: params.areaM2,
      bathroomsCount: params.bathroomsCount,
      windowsM2: params.windowsM2,
      riskLevel: params.riskLevel,
      trafficLevel: params.trafficLevel,
      disinfectionLevel: params.disinfectionLevel,
      frequencyType,
      eventsPerMonth: params.eventsPerMonth,
      shiftType,
      equipmentKit,
    },
    calculations: {
      effectiveRateM2H,
      hoursPerEvent,
      totalHoursMonth,
      directCost,
      overheadCost,
      totalCost,
      marginPct: BASE_PARAMS.marginPct,
      frequencyFactor,
      subtotalPrice,
      ivaPct: BASE_PARAMS.ivaPct,
    },
  };

  return {
    effectiveRateM2H: Number(effectiveRateM2H.toFixed(4)),
    hoursPerEvent: Number(hoursPerEvent.toFixed(4)),
    totalHoursMonth: Number(totalHoursMonth.toFixed(4)),
    directCost: money(directCost),
    overheadCost: money(overheadCost),
    totalCost: money(totalCost),
    marginPct: BASE_PARAMS.marginPct,
    subtotalPrice: money(subtotalPrice),
    ivaAmount: money(ivaAmount),
    finalPrice: money(finalPrice),
    pricePerM2: money(finalPrice / params.areaM2),
    frequencyType,
    discountPct: 0,
    discountAmount: 0,
    parameterSnapshot,
    lineItems,
  };
}
