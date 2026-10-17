// lib/geocoding.ts
import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

// Modelos configurables desde .env (verifica que existan en tu cuenta)
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

// ---------------------------------------------------------------------------
// LECTOR LOCAL (sin IA): separa "Av. X y Calle Y" con reglas simples
// ---------------------------------------------------------------------------
const STREET_PREFIX =
  /^(av\.?|avenida|calle|c\.|pasaje|psj\.?|autopista|via|vía|ruta|camino)\s+/i;

const cleanStreet = (s: string) =>
  s.replace(STREET_PREFIX, "").replace(/[.,;]+$/g, "").replace(/\s+/g, " ").trim();

function parseAddressLocal(raw: string): ParsedAddress {
  const text = raw.replace(/\s+/g, " ").trim();
  const parts = text.split(/\s+(?:y|&|esquina|con)\s+/i);

  if (parts.length >= 2) {
    const s1 = cleanStreet(parts[0]);
    const s2 = cleanStreet(parts[1]);
    if (s1 && s2) return { street1: s1, street2: s2, landmark: null, sector: null };
  }

  if (STREET_PREFIX.test(text)) {
    return { street1: cleanStreet(text), street2: null, landmark: null, sector: null };
  }

  // Sin calles reconocibles: lo tratamos como lugar conocido
  return { street1: null, street2: null, landmark: text || null, sector: null };
}

// ---------------------------------------------------------------------------
// LECTOR CON IA (solo ordena el texto, no inventa lugares)
// ---------------------------------------------------------------------------
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
    console.warn("⚠️ Gemini respondió, pero no en JSON válido.");
  } catch (e) {
    console.warn(`⚠️ Gemini falló (modelo: ${GEMINI_MODEL}):`, String(e).slice(0, 300));
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
    if (!groqRes.ok) {
      const errBody = await groqRes.text().catch(() => "");
      console.warn(`⚠️ Groq falló (modelo: ${GROQ_MODEL}) HTTP ${groqRes.status}:`, errBody.slice(0, 300));
      return null;
    }
    const data = await groqRes.json();
    const parsed = parseJson(data.choices[0].message.content);
    if (!parsed) console.warn("⚠️ Groq respondió, pero no en JSON válido.");
    return parsed;
  } catch (e) {
    console.warn("⚠️ Groq falló:", String(e).slice(0, 300));
    return null;
  }
}

// ---------------------------------------------------------------------------
// BÚSQUEDA EN MAPA
// ---------------------------------------------------------------------------
// Regex que ignora mayúsculas y tildes ("Garcia" encuentra "García")
const accentInsensitive = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[.*+?^${}()|[\]\\"]/g, "\\$&")
    .replace(/a/gi, "[aáàäAÁ]")
    .replace(/e/gi, "[eéèëEÉ]")
    .replace(/i/gi, "[iíìïIÍ]")
    .replace(/o/gi, "[oóòöOÓ]")
    .replace(/u/gi, "[uúùüUÚ]")
    .replace(/n/gi, "[nñNÑ]");

// Servidores de Overpass: si uno falla (red, bloqueo, saturación) se prueba el siguiente
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

async function overpassQuery(q: string) {
  for (const url of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "data=" + encodeURIComponent(q),
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) {
        console.warn(`⚠️ Overpass ${new URL(url).host} respondió HTTP ${res.status}`);
        continue;
      }
      return await res.json();
    } catch (e: any) {
      const cause = e?.cause?.code || e?.cause?.message || e?.name || String(e);
      console.warn(`⚠️ Overpass ${new URL(url).host} falló: ${cause}`);
    }
  }
  return null;
}

// Punto exacto donde se cruzan dos calles (OpenStreetMap / Overpass)
async function findIntersection(street1: string, street2: string) {
  const q = `[out:json][timeout:20];
    way["highway"]["name"~"${accentInsensitive(street1)}",i](${QUITO_BBOX})->.a;
    way["highway"]["name"~"${accentInsensitive(street2)}",i](${QUITO_BBOX})->.b;
    node(w.a)(w.b);
    out 1;`;
  const data = await overpassQuery(q);
  const node = data?.elements?.[0];
  if (data && !node) console.log(`[INFO] Overpass no encontró cruce entre "${street1}" y "${street2}"`);
  return node ? { lat: node.lat as number, lon: node.lon as number } : null;
}

// Punto de la calle 1 a menos de 200 m de la calle 2 (cuando no comparten nodo)
async function findNear(street1: string, street2: string) {
  const q = `[out:json][timeout:20];
    way["highway"]["name"~"${accentInsensitive(street1)}",i](${QUITO_BBOX})->.a;
    way["highway"]["name"~"${accentInsensitive(street2)}",i](${QUITO_BBOX})->.b;
    node(w.a)(around.b:200);
    out 1;`;
  const data = await overpassQuery(q);
  const node = data?.elements?.[0];
  return node ? { lat: node.lat as number, lon: node.lon as number } : null;
}

// Geocodificador de Esri: entiende esquinas ("calle & calle").
// Nota: el servicio gratuito es para búsquedas; guardar resultados a largo plazo
// requiere cuenta/licencia de ArcGIS. Aceptable para una demo o hackathon.
async function esriIntersection(street1: string, street2: string) {
  try {
    const url =
      "https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates" +
      `?f=json&maxLocations=1&countryCode=ECU&outFields=Match_addr` +
      `&location=-78.4678,-0.1806` +
      `&singleLine=${encodeURIComponent(`${street1} & ${street2}, Quito, Ecuador`)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) {
      console.warn(`⚠️ Esri respondió HTTP ${res.status}`);
      return null;
    }
    const data = await res.json();
    const c = data?.candidates?.[0];
    if (!c || c.score < 85) return null;
    const lat = c.location.y as number;
    const lon = c.location.x as number;
    // Validar que caiga dentro de Quito
    if (lat < -0.35 || lat > -0.05 || lon < -78.58 || lon > -78.38) return null;
    return { lat, lon };
  } catch (e: any) {
    const cause = e?.cause?.code || e?.cause?.message || e?.name || String(e);
    console.warn(`⚠️ Esri falló: ${cause}`);
    return null;
  }
}

// Búsqueda en Nominatim limitada a Quito
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
  } catch (e) {
    console.warn("⚠️ Nominatim falló:", String(e).slice(0, 200));
  }
  return null;
}

// ---------------------------------------------------------------------------
// FUNCIÓN PRINCIPAL
// ---------------------------------------------------------------------------
export async function geocodeAddress(rawAddress: string): Promise<{ lat: number; lon: number }> {
  try {
    // 1) Primero el lector local; la IA solo se usa si no basta
    const local = parseAddressLocal(rawAddress);
    let parsed: ParsedAddress = local;

    if (!(local.street1 && local.street2)) {
      const ai = await parseAddressWithAI(rawAddress);
      if (ai) parsed = ai;
    }
    console.log(`[GEOCODING] Original: "${rawAddress}" ->`, parsed);

    let hit: { lat: number; lon: number } | null = null;

    // 2) Esquina exacta (calle + calle)
    if (parsed.street1 && parsed.street2) {
      hit = await findIntersection(parsed.street1, parsed.street2);
      if (hit) console.log("[EXITO] Esquina exacta encontrada en OpenStreetMap");
      if (!hit) {
        hit = await findNear(parsed.street1, parsed.street2);
        if (hit) console.log("[EXITO] Punto de la calle 1 a menos de 200 m de la calle 2");
      }
      if (!hit) {
        hit = await esriIntersection(parsed.street1, parsed.street2);
        if (hit) console.log("[EXITO] Esquina encontrada con Esri");
      }
    }

    // 3) Lugar conocido
    if (!hit && parsed.landmark) {
      hit = await nominatim(`${parsed.landmark}, Quito, Ecuador`);
      if (hit) console.log(`[EXITO] Lugar encontrado: ${parsed.landmark}`);
    }

    // 4) Calle principal (con sector si existe), luego la segunda calle
    if (!hit && parsed.street1) {
      const sector = parsed.sector ? `${parsed.sector}, ` : "";
      hit = await nominatim(`${parsed.street1}, ${sector}Quito, Ecuador`);
      if (hit) console.log(`[EXITO] Calle encontrada: ${parsed.street1} (aprox.)`);
    }
    if (!hit && parsed.street2) {
      hit = await nominatim(`${parsed.street2}, Quito, Ecuador`);
      if (hit) console.log(`[EXITO] Calle encontrada: ${parsed.street2} (aprox.)`);
    }

    if (hit) {
      console.log(`[GEOCODING] Coordenadas: ${hit.lat}, ${hit.lon}`);
      console.log(`[GEOCODING] Verifícalas aquí: https://www.openstreetmap.org/?mlat=${hit.lat}&mlon=${hit.lon}#map=17/${hit.lat}/${hit.lon}`);
      return hit;
    }
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