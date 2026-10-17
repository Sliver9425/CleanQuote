// lib/geocoding.ts
import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

// Modelos configurables desde .env (si no existen, usa los valores actuales)
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-1.5-flash";
const GROQ_MODEL = process.env.GROQ_MODEL || "qwen/qwen3.8-27b";

// Caja geográfica de Quito (izquierda, arriba, derecha, abajo) y bbox para Overpass (sur, oeste, norte, este)
const QUITO_VIEWBOX = "-78.58,-0.05,-78.38,-0.35";
const QUITO_BBOX = "-0.35,-78.58,-0.05,-78.38";

type ParsedAddress = {
  street1: string | null; // calle principal, SIN "Av."/"Calle" (ej: "Amazonas")
  street2: string | null; // calle que cruza
  landmark: string | null; // lugar conocido SOLO si el cliente lo mencionó
  sector: string | null; // barrio/sector SOLO si el cliente lo mencionó
};

const PROMPT = (raw: string) => `
Eres un normalizador de direcciones de Quito, Ecuador. Tu trabajo es ORDENAR el texto del cliente, NO adivinar ni inventar lugares.

Extrae estos campos del texto:
- street1: calle o avenida principal, escrita sin el prefijo ("Av.", "Avenida", "Calle"). Corrige solo ortografía evidente.
- street2: la calle que la cruza, si el cliente la mencionó.
- landmark: un lugar conocido (parque, centro comercial, universidad, hospital) SOLO si el cliente lo escribió.
- sector: barrio o sector SOLO si el cliente lo escribió.

Reglas estrictas:
- NUNCA agregues información que no esté en el texto del cliente.
- NO reemplaces las calles por un lugar que "crees" que queda cerca.
- Si no estás seguro de un campo, devuelve null.
- Responde SOLO un JSON válido, sin texto extra.

Ejemplos:
"Av. Universitaria y Bolivia" -> {"street1":"Universitaria","street2":"Bolivia","landmark":null,"sector":null}
"Frente al Quicentro" -> {"street1":null,"street2":null,"landmark":"Quicentro Shopping","sector":null}
"Amazonas y Naciones Unidas" -> {"street1":"Amazonas","street2":"Naciones Unidas","landmark":null,"sector":null}
"Parque La Carolina" -> {"street1":null,"street2":null,"landmark":"Parque La Carolina","sector":null}
"Lote en Cumbayá por la Interoceánica" -> {"street1":"Interoceánica","street2":null,"landmark":null,"sector":"Cumbayá"}

Texto del cliente: "${raw}"
`;

function parseJson(text: string): ParsedAddress | null {
  try {
    const clean = text.replace(/```json|```/g, "").trim();
    const obj = JSON.parse(clean);
    const f = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
    return {
      street1: f(obj.street1),
      street2: f(obj.street2),
      landmark: f(obj.landmark),
      sector: f(obj.sector),
    };
  } catch {
    return null;
  }
}

// Paso 1: la IA solo ordena la dirección (Gemini, con Groq de respaldo)
async function parseAddressWithAI(raw: string): Promise<ParsedAddress | null> {
  const prompt = PROMPT(raw);

  try {
    const model = genAI.getGenerativeModel({
      model: GEMINI_MODEL,
      generationConfig: { temperature: 0, responseMimeType: "application/json" },
    });
    const res = await model.generateContent(prompt);
    const parsed = parseJson(res.response.text());
    if (parsed) return parsed;
  } catch {
    console.warn("⚠️ Gemini falló en geocoding. Activando Fallback a Groq...");
  }

  try {
    const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [{ role: "user", content: prompt }],
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!groqRes.ok) return null;
    const data = await groqRes.json();
    return parseJson(data.choices[0].message.content);
  } catch {
    return null;
  }
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\"]/g, "\\$&");

// Paso 2a: punto exacto donde se cruzan dos calles (OpenStreetMap / Overpass)
async function findIntersection(street1: string, street2: string) {
  try {
    const q = `[out:json][timeout:15];
      way["highway"]["name"~"${escapeRegex(street1)}",i](${QUITO_BBOX})->.a;
      way["highway"]["name"~"${escapeRegex(street2)}",i](${QUITO_BBOX})->.b;
      node(w.a)(w.b);
      out 1;`;
    const res = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "data=" + encodeURIComponent(q),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const node = data?.elements?.[0];
    return node ? { lat: node.lat as number, lon: node.lon as number } : null;
  } catch {
    return null;
  }
}

// Paso 2b: búsqueda en Nominatim limitada a Quito
async function nominatim(query: string) {
  try {
    const url =
      `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=ec` +
      `&viewbox=${QUITO_VIEWBOX}&bounded=1&q=${encodeURIComponent(query)}`;
    const res = await fetch(url, {
      headers: { "User-Agent": "CleanQuote-Hackathon-App/1.0" },
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json();
    if (data && data.length > 0) {
      return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
    }
  } catch {}
  return null;
}

export async function geocodeAddress(rawAddress: string): Promise<{ lat: number; lon: number }> {
  try {
    const parsed = await parseAddressWithAI(rawAddress);
    console.log(`[GEOCODING] Original: "${rawAddress}" -> IA:`, parsed);

    let hit: { lat: number; lon: number } | null = null;

    // 1) Esquina exacta (calle + calle)
    if (parsed?.street1 && parsed?.street2) {
      hit = await findIntersection(parsed.street1, parsed.street2);
      if (hit) console.log("[EXITO] Esquina encontrada en OpenStreetMap");
    }

    // 2) Lugar conocido
    if (!hit && parsed?.landmark) {
      hit = await nominatim(`${parsed.landmark}, Quito, Ecuador`);
      if (hit) console.log(`[EXITO] Lugar encontrado: ${parsed.landmark}`);
    }

    // 3) Calle principal (con sector si existe)
    if (!hit && parsed?.street1) {
      const sector = parsed.sector ? `${parsed.sector}, ` : "";
      hit = await nominatim(`${parsed.street1}, ${sector}Quito, Ecuador`);
      if (hit) console.log(`[EXITO] Calle encontrada: ${parsed.street1}`);
    }

    // 4) Último intento: el texto original tal cual
    if (!hit) {
      hit = await nominatim(`${rawAddress}, Quito, Ecuador`);
    }

    if (hit) return hit;
    console.log(`[FALLO] El mapa no encontró: ${rawAddress}`);
  } catch (error) {
    console.error("Error general en geocodificación:", error);
  }

  // Salvavidas (dispersión aleatoria en el centro de Quito)
  return {
    lat: -0.1806 + (Math.random() * 0.03 - 0.015),
    lon: -78.4678 + (Math.random() * 0.03 - 0.015),
  };
}