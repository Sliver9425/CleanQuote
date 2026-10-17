// app/api/quotes/route.ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { calculateCleanQuote, QuoteInput } from '@/lib/pricing/engine';
import { geocodeAddress } from '@/lib/geocoding';

export async function POST(request: Request) {
  try {
    const body = await request.json();

    // 1. SMART DEFAULTS (Hidratación)
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

    // 2. Usamos el motor matemático
    const result = calculateCleanQuote(safeInput);

    // 3. OBTENEMOS COORDENADAS REALES EN TIEMPO REAL
    const facilityName = body.facilityName || 'Instalación Principal';
    const coordinates = await geocodeAddress(facilityName);

    // 4. Guardamos en la base de datos con las coordenadas reales
    const savedQuote = await prisma.quote.create({
      data: {
        clientName: body.clientName || 'Cliente Demo',
        facilityName: facilityName,
        facilityType: safeInput.facilityType,
        floorMaterial: safeInput.floorMaterial,
        areaM2: safeInput.areaM2,
        
        // INYECTAMOS LA LATITUD Y LONGITUD REAL
        latitude: coordinates.lat,
        longitude: coordinates.lon,
        
        bathroomsCount: safeInput.bathroomsCount,
        windowsM2: body.windowsM2 !== undefined ? Number(body.windowsM2) : Math.floor(Number(body.areaM2) * 0.05) || 0,
        riskLevel: safeInput.riskLevel,
        trafficLevel: safeInput.trafficLevel,
        disinfectionLevel: safeInput.disinfectionLevel,
        frequencyType: safeInput.frequencyType,
        
        eventsPerMonth: Number(result.totalHoursMonth / (result.hoursPerEvent || 1)) || 1,
        effectiveRateM2H: Number(result.effectiveRateM2H) || 0,
        hoursPerEvent: Number(result.hoursPerEvent) || 0,
        totalHoursMonth: Number(result.totalHoursMonth) || 0,
        directCost: Number(result.directCost) || 0,
        overheadCost: Number(result.overheadCost) || 0,
        totalCost: Number(result.totalCost) || 0,
        marginPct: 0.20,
        subtotalPrice: Number(result.subtotalPrice) || 0,
        ivaAmount: Number(result.ivaAmount) || 0,
        finalPrice: Number(result.finalPrice) || 0,
        pricePerM2: Number(result.pricePerM2) || 0,
        
        parameterSnapshot: result.parameterSnapshot,
        lineItems: {
          create: result.lineItems,
        },
      },
      include: {
        lineItems: true
      }
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