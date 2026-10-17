// lib/geocoding.ts
import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

// Convierte una dirección informal de Quito en coordenadas reales:
// 1) IA (Gemini, con Groq de respaldo) limpia la dirección
// 2) Nominatim (OpenStreetMap) la busca en el mapa
// 3) Si todo falla, devuelve un punto aleatorio en el centro de Quito
export async function geocodeAddress(rawAddress: string): Promise<{ lat: number; lon: number }> {
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

    // INTENTO 1: GOOGLE GEMINI
    try {
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
      const aiResult = await model.generateContent(prompt);
      cleanAddress = aiResult.response.text().trim();
    } catch (geminiError) {
      console.warn("⚠️ Gemini falló en geocoding. Activando Fallback a Groq...");

      // INTENTO 2: FALLBACK A GROQ
      const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        },
        body: JSON.stringify({
          model: "qwen/qwen3.8-27b",
          messages: [{ role: "user", content: prompt }],
        }),
      });

      if (!groqRes.ok) {
        throw new Error("Ambas APIs de IA fallaron procesando la dirección.");
      }

      const groqData = await groqRes.json();
      cleanAddress = groqData.choices[0].message.content.trim();
    }

    console.log(`[IA GEOCODING] Original: "${rawAddress}" -> Entendió: "${cleanAddress}"`);

    // PASO 2: Buscar el lugar limpio en Nominatim
    const query = encodeURIComponent(`${cleanAddress}, Quito, Ecuador`);
    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${query}&limit=1`,
      { headers: { "User-Agent": "CleanQuote-Hackathon-App/1.0" } }
    );

    const data = await response.json();

    if (data && data.length > 0) {
      console.log(`[EXITO] Coordenadas encontradas para ${cleanAddress}`);
      return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
    } else {
      console.log(`[FALLO] El mapa no encontró: ${cleanAddress}`);
    }
  } catch (error) {
    console.error("Error general en geocodificación:", error);
  }

  // PASO 3: Salvavidas (dispersión aleatoria en el centro de Quito)
  return {
    lat: -0.1806 + (Math.random() * 0.03 - 0.015),
    lon: -78.4678 + (Math.random() * 0.03 - 0.015),
  };
}