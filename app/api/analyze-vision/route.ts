import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

// ============================================================
// Prompts específicos por tipo de servicio
// ============================================================
const PROMPT_INTERIOR = `
  Eres un inspector técnico de limpieza comercial. Analiza la imagen de este establecimiento.
  Devuelve ÚNICAMENTE un objeto JSON válido con estas claves exactas y opciones permitidas:
  {
    "facilityType": "OFFICE o RESIDENTIAL o HEALTH o POST_CONSTRUCTION",
    "floorMaterial": "TILE o VINYL o CARPET o MARBLE",
    "riskLevel": "LOW o MEDIUM o HIGH",
    "trafficLevel": "LOW o MEDIUM o HIGH",
    "disinfectionLevel": "SPOT_STANDARD o CONTINUOUS_BASIC o CLINICAL"
  }
  Evalúa el nivel de desinfección visualmente: usa CLINICAL si es un entorno médico, POST_CONSTRUCTION si hay escombros, o ajusta a los demás según el nivel de higiene y uso que percibas en la foto. Responde solo el JSON.
`;

const PROMPT_EXTERIOR = `
  Eres un inspector técnico de terrenos y espacios exteriores. Analiza la imagen de este terreno o espacio abierto.
  Devuelve ÚNICAMENTE un objeto JSON válido con estas claves exactas y opciones permitidas:
  {
    "servicesRequested": ["DESBROCE", "BARRIDO_CALLES", "RETIRO_ESCOMBROS"],
    "vegetationLevel": "LIGHT o MEDIUM o SEVERE",
    "terrainSlope": "FLAT o MODERATE o STEEP",
    "accessibility": "MACHINERY o MIXED o MANUAL_ONLY",
    "hasTrees": true o false,
    "debrisType": "CONSTRUCTION o VEGETAL o MIXED o DOMESTIC",
    "debrisVolumeM3": número estimado o 0 si no hay
  }
  Reglas:
  - servicesRequested: incluye DESBROCE si hay vegetación que cortar, RETIRO_ESCOMBROS si ves escombros, BARRIDO_CALLES si es superficie pavimentada.
  - vegetationLevel: LIGHT para pasto alto, MEDIUM para maleza densa con arbustos, SEVERE para vegetación leñosa o abandono prolongado.
  - terrainSlope: FLAT, MODERATE o STEEP según la inclinación visible.
  - accessibility: MACHINERY si hay espacio para que entre una minicargadora o volqueta, MANUAL_ONLY si el acceso es muy estrecho o irregular, MIXED si es parcial.
  - hasTrees: true si hay árboles visibles.
  - debrisType: clasifica el escombro predominante.
  - debrisVolumeM3: estima visualmente el volumen de escombros apilados.
  Responde solo el JSON.
`;

// ============================================================
// Helpers
// ============================================================
async function callGemini(prompt: string, base64Image: string, mimeType: string) {
  const model = genAI.getGenerativeModel({ model: 'gemini-flash-latest' });
  const imagePart = { inlineData: { data: base64Image, mimeType } };
  const result = await model.generateContent([prompt, imagePart]);
  const clean = result.response.text().replace(/```json/g, '').replace(/```/g, '').trim();
  return JSON.parse(clean);
}

async function callGroq(prompt: string, base64Image: string, mimeType: string) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: "qwen/qwen3.8-27b",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64Image}` } },
          ],
        },
      ],
    }),
  });

  if (!res.ok) {
    const details = await res.text();
    console.error('🔍 Detalle del error de Groq:', details);
    throw new Error('Groq falló');
  }

  const data = await res.json();
  return JSON.parse(data.choices[0].message.content);
}

// ============================================================
// Endpoint
// ============================================================
export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get('image') as File;
    const serviceType = (formData.get('serviceType') as string) || 'INTERIOR';

    if (!file) {
      return NextResponse.json({ error: 'No se proporcionó ninguna imagen.' }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const base64Image = Buffer.from(arrayBuffer).toString('base64');
    const mimeType = file.type || 'image/jpeg';

    const prompt = serviceType === 'EXTERIOR' ? PROMPT_EXTERIOR : PROMPT_INTERIOR;

    let detectedData: any;

    // Intento 1: Gemini
    try {
      detectedData = await callGemini(prompt, base64Image, mimeType);
    } catch (geminiError) {
      console.warn('⚠️ Gemini falló. Activando fallback a Groq...');
      console.error('🔍 Detalle del error de Gemini:', geminiError);

      // Intento 2: Groq
      detectedData = await callGroq(prompt, base64Image, mimeType);
    }

    // Devolvemos solo la detección. El frontend se encarga del cálculo.
    return NextResponse.json(detectedData, { status: 200 });

  } catch (error) {
    console.error('Error procesando visión:', error);
    return NextResponse.json({ error: 'Error procesando la IA' }, { status: 500 });
  }
}