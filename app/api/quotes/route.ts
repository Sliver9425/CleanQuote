import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { calculateCleanQuote, QuoteInput } from '@/lib/pricing/engine';
import { GoogleGenerativeAI } from '@google/generative-ai'; // NUEVO

// Inicializamos Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

// FUNCIÓN PARA CONVERTIR DIRECCIÓN A COORDENADAS REALES
async function geocodeAddress(rawAddress: string) {
  try {
    const prompt = `
      Convierte esta dirección informal de Quito, Ecuador en un nombre oficial de lugar, parque, institución o avenida principal que sea fácil de buscar en un mapa GPS.
      Ejemplo 1: "Av. Universitaria y Bolivia" -> "Universidad Central del Ecuador"
      Ejemplo 2: "Frente al Quicentro" -> "Quicentro Shopping"
      Ejemplo 3: "En la Amazonas por la Carolina" -> "Parque La Carolina"
      
      Dirección informal del cliente: "${rawAddress}"
      
      Responde ÚNICAMENTE con el nombre del lugar limpio y oficial. No uses comillas ni explicaciones extra.
    `;

    let cleanAddress = "";

    // ==========================================
    // INTENTO 1: GOOGLE GEMINI
    // ==========================================
    try {
      const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
      const aiResult = await model.generateContent(prompt);
      cleanAddress = aiResult.response.text().trim();
    } catch (geminiError) {
      console.warn('⚠️ Gemini falló en geocoding. Activando Fallback a Groq...');
      
      // ==========================================
      // INTENTO 2: FALLBACK A GROQ (QWEN)
      // ==========================================
      const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.GROQ_API_KEY}` // Usa tu misma variable de entorno
        },
        body: JSON.stringify({
          model: "qwen/qwen3.8-27b", // Mismo modelo usado en la visión
          messages: [
            {
              role: "user",
              content: prompt
            }
          ]
        })
      });

      if (!groqRes.ok) {
        throw new Error('Ambas APIs de IA fallaron procesando la dirección.');
      }

      const groqData = await groqRes.json();
      cleanAddress = groqData.choices[0].message.content.trim();
    }

    console.log(`[IA GEOCODING] Original: "${rawAddress}" -> Entendió: "${cleanAddress}"`);

    // PASO 2: Buscar el lugar limpio en el mapa gratuito (Nominatim)
    const query = encodeURIComponent(`${cleanAddress}, Quito, Ecuador`);
    const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${query}&limit=1`, {
      headers: { 'User-Agent': 'CleanQuote-Hackathon-App/1.0' }
    });

    const data = await response.json();

    if (data && data.length > 0) {
      console.log(`[EXITO] Coordenadas encontradas para ${cleanAddress}`);
      return {
        lat: parseFloat(data[0].lat),
        lon: parseFloat(data[0].lon)
      };
    } else {
      console.log(`[FALLO] El mapa no encontró: ${cleanAddress}`);
    }
  } catch (error) {
    console.error("Error general en geocodificación:", error);
  }

  // PASO 3: Salvavidas (Dispersión aleatoria en el centro de Quito)
  // Mantiene la estabilidad del mapa del Hackathon si todo lo anterior falla
  return { 
    lat: -0.1806 + (Math.random() * 0.03 - 0.015), 
    lon: -78.4678 + (Math.random() * 0.03 - 0.015) 
  };
}

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