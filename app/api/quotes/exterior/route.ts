// app/api/quotes/exterior/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  calculateExteriorQuote,
  type ExteriorService,
  type VegetationLevel,
  type TerrainSlope,
  type Accessibility,
  type DebrisType,
  type ExteriorQuoteInput,
} from "@/lib/pricing/exteriorEngine";
import { geocodeAddress } from "@/lib/geocoding";

// ---------------------------------------------------------------------------
// Tipos y validación de entrada
// ---------------------------------------------------------------------------
type FrequencyType = "SPOT" | "WEEKLY" | "MONTHLY_DAILY";

const VALID_SERVICES: readonly ExteriorService[] = [
  "DESBROCE",
  "BARRIDO_CALLES",
  "RETIRO_ESCOMBROS",
];

const VALID_VEGETATION: readonly VegetationLevel[] = ["LIGHT", "MEDIUM", "SEVERE"];
const VALID_SLOPE: readonly TerrainSlope[] = ["FLAT", "MODERATE", "STEEP"];
const VALID_ACCESS: readonly Accessibility[] = ["MACHINERY", "MIXED", "MANUAL_ONLY"];
const VALID_DEBRIS: readonly DebrisType[] = ["CONSTRUCTION", "VEGETAL", "MIXED", "DOMESTIC"];
const VALID_FREQUENCY: readonly FrequencyType[] = ["SPOT", "WEEKLY", "MONTHLY_DAILY"];

const isExteriorService = (v: unknown): v is ExteriorService =>
  typeof v === "string" && (VALID_SERVICES as readonly string[]).includes(v);

const isVegetation = (v: unknown): v is VegetationLevel =>
  typeof v === "string" && (VALID_VEGETATION as readonly string[]).includes(v);

const isSlope = (v: unknown): v is TerrainSlope =>
  typeof v === "string" && (VALID_SLOPE as readonly string[]).includes(v);

const isAccess = (v: unknown): v is Accessibility =>
  typeof v === "string" && (VALID_ACCESS as readonly string[]).includes(v);

const isDebris = (v: unknown): v is DebrisType =>
  typeof v === "string" && (VALID_DEBRIS as readonly string[]).includes(v);

const isFrequency = (v: unknown): v is FrequencyType =>
  typeof v === "string" && (VALID_FREQUENCY as readonly string[]).includes(v);

// ---------------------------------------------------------------------------
// Helpers de saneamiento
// ---------------------------------------------------------------------------
const n = (v: unknown, fallback = 0): number => {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
};

const nOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};

const s = (v: unknown, fallback = ""): string =>
  typeof v === "string" && v.length > 0 ? v : fallback;

const sanitizeJson = (obj: unknown): any => {
  if (obj === null || obj === undefined) return null;
  if (typeof obj === "number") return Number.isFinite(obj) ? obj : 0;
  if (typeof obj === "string" || typeof obj === "boolean") return obj;
  if (Array.isArray(obj)) return obj.map(sanitizeJson);
  if (typeof obj === "object") {
    return Object.fromEntries(
      Object.entries(obj as Record<string, unknown>).map(([k, v]) => [
        k,
        sanitizeJson(v),
      ])
    );
  }
  return null;
};

// Tipo auxiliar para lineItems crudos del motor
type RawLineItem = {
  category?: unknown;
  concept?: unknown;
  formulaUsed?: unknown;
  explanation?: unknown;
  amountUsd?: unknown;
};

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);

    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { error: "Body JSON inválido o vacío" },
        { status: 400 }
      );
    }

    const b = body as Record<string, unknown>;

    // 1. Servicios solicitados (con type guard)
    const servicesRequested = Array.isArray(b.servicesRequested)
      ? b.servicesRequested.filter(isExteriorService)
      : [];

    if (servicesRequested.length === 0) {
      return NextResponse.json(
        { error: "Debes seleccionar al menos un servicio válido (servicesRequested)." },
        { status: 400 }
      );
    }

    // 2. Área
    const areaM2 = n(b.areaM2, 0);
    if (areaM2 <= 0) {
      return NextResponse.json(
        { error: "El área (areaM2) debe ser mayor a 0." },
        { status: 400 }
      );
    }

    // 3. Input tipado y validado
    const input: ExteriorQuoteInput = {
      servicesRequested,
      areaM2,
      linearMeters: nOrNull(b.linearMeters) ?? undefined,
      vegetationLevel: isVegetation(b.vegetationLevel) ? b.vegetationLevel : "LIGHT",
      terrainSlope: isSlope(b.terrainSlope) ? b.terrainSlope : "FLAT",
      accessibility: isAccess(b.accessibility) ? b.accessibility : "MACHINERY",
      hasTrees: Boolean(b.hasTrees),
      debrisVolumeM3: nOrNull(b.debrisVolumeM3) ?? undefined,
      debrisType: isDebris(b.debrisType) ? b.debrisType : undefined,
      distanceToDumpKm: nOrNull(b.distanceToDumpKm) ?? undefined,
      mobilizationNeeded: Boolean(b.mobilizationNeeded),
      frequencyType: isFrequency(b.frequencyType) ? b.frequencyType : "SPOT",
    };

    // 4. Ejecutamos el motor
    const result = calculateExteriorQuote(input);

    // 5. Saneamos todo antes de tocar Prisma
    const directCost = n(result.directCost);
    const overheadCost = n(result.overheadCost);
    const totalCost = n(result.totalCost);
    const subtotalPrice = n(result.subtotalPrice);
    const ivaAmount = n(result.ivaAmount);
    const finalPrice = n(result.finalPrice);
    const pricePerM2 = n(result.pricePerM2);

    const parameterSnapshot = sanitizeJson(result.parameterSnapshot ?? {});

    // Sumamos cleaning + barrido (barrido puede no existir en el tipo → cast seguro)
    const barridoCost = n((result as { barridoCost?: number }).barridoCost);
    const cleaningCost = n(result.cleaningCost) + barridoCost;

    // 6. Normalizamos los lineItems
    const rawLineItems: RawLineItem[] = Array.isArray(result.lineItems)
      ? (result.lineItems as RawLineItem[])
      : [];

    const lineItems = rawLineItems
      .filter((li): li is RawLineItem => !!li && typeof li === "object")
      .map((li) => ({
        category: s(li.category, "LABOR"),
        concept: s(li.concept, "Concepto sin nombre"),
        formulaUsed: s(li.formulaUsed, ""),
        explanation: s(li.explanation, ""),
        amountUsd: n(li.amountUsd),
      }));

    // 7. Obtenemos coordenadas reales de la dirección
    const facilityName = s(b.facilityName, "Terreno");
    const coordinates = await geocodeAddress(facilityName);

    // 8. Guardamos en Prisma
    const quote = await prisma.quote.create({
      data: {
        quoteType: "EXTERIOR",
        clientName: s(b.clientName, "Cliente Demo"),
        facilityName,
        latitude: coordinates.lat,
        longitude: coordinates.lon,

        totalHoursMonth: 0,
        directCost,
        overheadCost,
        totalCost,
        marginPct: 0.2,
        subtotalPrice,
        ivaAmount,
        finalPrice,
        pricePerM2,
        parameterSnapshot,

        // Relleno de campos obligatorios de interior (no aplican a exterior)
        facilityType: "EXTERIOR",
        floorMaterial: "N/A",
        areaM2: input.areaM2,
        riskLevel: "LOW",
        trafficLevel: "LOW",
        disinfectionLevel: "BASIC",
        frequencyType: input.frequencyType ?? "SPOT",
        eventsPerMonth: 1,
        effectiveRateM2H: 0,
        hoursPerEvent: 0,

        exteriorDetails: {
          create: {
            servicesRequested: input.servicesRequested,
            areaM2: input.areaM2,
            linearMeters: input.linearMeters ?? null,
            vegetationLevel: input.vegetationLevel,
            terrainSlope: input.terrainSlope,
            accessibility: input.accessibility,
            hasTrees: input.hasTrees ?? false,
            debrisVolumeM3: input.debrisVolumeM3 ?? null,
            debrisType: input.debrisType ?? null,
            volquetasEstimated: nOrNull(
              (result as { volquetasEstimated?: number }).volquetasEstimated
            ),
            distanceToDumpKm: input.distanceToDumpKm ?? null,
            mobilizationNeeded: input.mobilizationNeeded ?? false,

            baseRateM2: n(result.baseRateM2),
            vegetationFactor: n(result.vegetationFactor),
            slopeFactor: n(result.slopeFactor),
            accessFactor: n(result.accessFactor),

            effectiveRateM2: n(result.effectiveRateM2),
            cleaningCost,
            debrisDisposalCost: n(result.debrisDisposalCost),
            mobilizationCost: n(result.mobilizationCost),
            totalExteriorCost: directCost,
          },
        },

        lineItems: {
          create: lineItems,
        },
      },
      include: {
        lineItems: true,
        exteriorDetails: true,
      },
    });

    // 9. Respuesta al frontend
    return NextResponse.json(
      {
        id: quote.id,
        finalPrice: quote.finalPrice,
        pricePerM2: quote.pricePerM2,
        lineItems: quote.lineItems.map((li) => ({
          category: li.category,
          concept: li.concept,
          formulaUsed: li.formulaUsed,
          explanation: li.explanation,
          amountUsd: li.amountUsd,
        })),
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("[exterior quote] ERROR:", error);
    return NextResponse.json(
      {
        error: "Error al cotizar",
        details:
          process.env.NODE_ENV === "development" ? String(error) : undefined,
      },
      { status: 500 }
    );
  }
}