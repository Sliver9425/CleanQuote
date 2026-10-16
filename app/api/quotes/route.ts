// app/api/quotes/route.ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { calculateCleanQuote, QuoteInput } from '@/lib/pricing/engine';

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const safeInput: QuoteInput = {
      areaM2: Number(body.areaM2) || 100,
      facilityType: body.facilityType || 'OFFICE',
      frequencyType: body.frequencyType || 'SPOT',
      floorMaterial: body.floorMaterial || 'TILE',
      riskLevel: body.riskLevel || 'LOW',
      trafficLevel: body.trafficLevel || 'MEDIUM',
      disinfectionLevel: body.disinfectionLevel || 'CONTINUOUS_BASIC',
      bathroomsCount: Number(body.bathroomsCount) || Math.floor(Number(body.areaM2) / 100) || 0,
      windowsM2: body.windowsM2 !== undefined ? Number(body.windowsM2) : Math.floor(Number(body.areaM2) * 0.05) || 0,
      isNightShift: body.isNightShift || false,
    };

    const result = calculateCleanQuote(safeInput);

    // 🔑 helper para limpiar NaN antes de Prisma
    const n = (v: any, fallback = 0) => {
      const x = Number(v);
      return Number.isFinite(x) ? x : fallback;
    };

    const savedQuote = await prisma.quote.create({
      data: {
        quoteType: 'INTERIOR',
        clientName: body.clientName || 'Cliente Demo',
        facilityName: body.facilityName || 'Instalación Principal',

        // Campos comunes que SÍ existen en Quote
        totalHoursMonth: n(result.totalHoursMonth),
        directCost: n(result.directCost),
        overheadCost: n(result.overheadCost),
        totalCost: n(result.totalCost),
        marginPct: 0.20,
        subtotalPrice: n(result.subtotalPrice),
        ivaAmount: n(result.ivaAmount),
        finalPrice: n(result.finalPrice),
        pricePerM2: n(result.pricePerM2),
        parameterSnapshot: result.parameterSnapshot ?? {},

        // 🔑 Aquí va el detalle específico de interior
        interiorDetails: {
          create: {
            facilityType: safeInput.facilityType,
            floorMaterial: safeInput.floorMaterial,
            areaM2: n(safeInput.areaM2),
            bathroomsCount: Math.round(n(safeInput.bathroomsCount)),
            windowsM2: n(safeInput.windowsM2),
            riskLevel: safeInput.riskLevel,
            trafficLevel: safeInput.trafficLevel,
            disinfectionLevel: safeInput.disinfectionLevel,
            frequencyType: safeInput.frequencyType,
            eventsPerMonth: n(result.totalHoursMonth / (result.hoursPerEvent || 1), 1),
            effectiveRateM2H: n(result.effectiveRateM2H),
            hoursPerEvent: n(result.hoursPerEvent),
          },
        },

        lineItems: {
          create: result.lineItems.map((li: any) => ({
            category: li.category ?? 'LABOR',
            concept: li.concept ?? '',
            formulaUsed: li.formulaUsed ?? '',
            explanation: li.explanation ?? '',
            amountUsd: n(li.amountUsd),
          })),
        },
      },
      include: { lineItems: true, interiorDetails: true },
    });

    return NextResponse.json(savedQuote, { status: 201 });
  } catch (error) {
    console.error('Error al guardar cotización:', error);
    return NextResponse.json(
      { error: 'Error procesando la cotización', details: String(error) },
      { status: 500 }
    );
  }
}