import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { calculateCleanQuote, QuoteInput } from '@/lib/pricing/engine';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get('image') as File;
    const areaM2 = formData.get('areaM2'); // Recibimos el área junto con la foto

    if (!file) {
      return NextResponse.json({ error: 'No se proporcionó ninguna imagen.' }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const base64Image = Buffer.from(arrayBuffer).toString('base64');
    const mimeType = file.type || 'image/jpeg';

    const imagePart = {
      inlineData: {
        data: base64Image,
        mimeType: mimeType,
      },
    };

    const model = genAI.getGenerativeModel({ model: 'gemini-flash-latest' });
    const prompt = `
      Eres un inspector técnico de limpieza comercial. Analiza la imagen de este establecimiento. 
      Devuelve ÚNICAMENTE un objeto JSON válido con estas claves exactas y opciones permitidas:
      {
        "facilityType": "OFFICE o RESIDENTIAL o HEALTH o POST_CONSTRUCTION",
        "floorMaterial": "TILE o VINYL o CARPET o MARBLE",
        "floorMaterials": ["lista de TODOS los tipos de piso distintos que se vean en la imagen, usando solo TILE, VINYL, CARPET o MARBLE; el primero es el predominante"],
        "riskLevel": "LOW o MEDIUM o HIGH",
        "trafficLevel": "LOW o MEDIUM o HIGH",
        "disinfectionLevel": "SPOT_STANDARD o CONTINUOUS_BASIC o CLINICAL"
      }
      Evalúa el nivel de desinfección visualmente: usa CLINICAL si es un entorno médico, POST_CONSTRUCTION si hay escombros, o ajusta a los demás según el nivel de higiene y uso que percibas en la foto. Responde solo el JSON.
    `;

    let detectedData;

    // ==========================================
    // INTENTO 1: GOOGLE GEMINI
    // ==========================================
    try {
      const result = await model.generateContent([prompt, imagePart]);
      const cleanJsonString = result.response.text().replace(/```json/g, '').replace(/```/g, '').trim();
      detectedData = JSON.parse(cleanJsonString);
    } catch (geminiError) {
      console.warn('⚠️ Gemini falló. Activando Fallback a OpenAI (ChatGPT)...');
      console.error('🔍 Detalle del error de Gemini:', geminiError);
      
      // ==========================================
      // INTENTO 2: FALLBACK A OPENAI
      // ==========================================
const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.GROQ_API_KEY}`
        },
        body: JSON.stringify({
          model: "qwen/qwen3.8-27b", 
          response_format: { type: "json_object" },
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: prompt },
                {
                  type: "image_url",
                  image_url: {
                    url: `data:${mimeType};base64,${base64Image}`
                  }
                }
              ]
            }
          ]
        })
      });

      if (!groqRes.ok) {
        const groqErrorDetails = await groqRes.text();
        console.error('🔍 Detalle del error de Groq:', groqErrorDetails);
        throw new Error('Ambas APIs de Inteligencia Artificial fallaron.');
      }

      const groqData = await groqRes.json();
      detectedData = JSON.parse(groqData.choices[0].message.content);
    }

    // Si nos enviaron el área, calculamos la cotización de inmediato
    if (areaM2) {
      const safeInput: QuoteInput = {
        areaM2: Number(areaM2),
        facilityType: detectedData.facilityType || 'OFFICE',
        floorMaterial: detectedData.floorMaterial || 'TILE',
        riskLevel: detectedData.riskLevel || 'LOW',
        trafficLevel: detectedData.trafficLevel || 'MEDIUM',
        disinfectionLevel: detectedData.disinfectionLevel || 'CONTINUOUS_BASIC',
        frequencyType: 'SPOT', // Asumimos servicio único para la prueba
        bathroomsCount: Math.floor(Number(areaM2) / 100) || 1, // 1 baño automático
        windowsM2: 0,
        isNightShift: false,
      };

      const finalQuote = calculateCleanQuote(safeInput);

      // Devolvemos lo que vio la IA + El recibo matemático
      return NextResponse.json({ 
        iaDetection: detectedData, 
        quoteReceipt: finalQuote 
      }, { status: 200 });
    }

    // Si solo enviaron la foto sin el área, devolvemos solo la detección
    return NextResponse.json(detectedData, { status: 200 });

  } catch (error) {
    console.error('Error procesando visión:', error);
    return NextResponse.json({ error: 'Error procesando la IA' }, { status: 500 });
  }
}