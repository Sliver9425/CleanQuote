// lib/pricing/chemicals.ts
// Catálogo de químicos especiales por tipo de establecimiento + cálculo de su cargo.
// Sin dependencias de servidor: se puede importar desde la página (cliente) y desde la ruta API.

export type ChemicalBasis = "M2" | "BATHROOM" | "WINDOW_M2" | "FLAT";

export interface SpecialChemical {
  id: string;
  name: string;
  description: string;
  facilityTypes: string[]; // OFFICE | RESIDENTIAL | HEALTH | POST_CONSTRUCTION | INDUSTRIAL
  basis: ChemicalBasis; // sobre qué se aplica
  unitCostUsd: number; // costo del producto por unidad base y por aplicación (USD)
  applicationsPerMonth: number; // aplicaciones al mes en servicios recurrentes (en "Única Vez" siempre 1)
}

export const BASIS_LABEL: Record<ChemicalBasis, string> = {
  M2: "m² de área",
  BATHROOM: "baño",
  WINDOW_M2: "m² de vidrio",
  FLAT: "servicio",
};

// ⚠️ PRECIOS REFERENCIALES: reemplázalos por los de tus proveedores.
export const SPECIAL_CHEMICALS: SpecialChemical[] = [
  // ---------------- OFICINA ----------------
  { id: "office-carpet-shampoo", name: "Shampoo para extracción de alfombra", description: "Limpieza profunda de alfombras y tapizados.", facilityTypes: ["OFFICE"], basis: "M2", unitCostUsd: 0.12, applicationsPerMonth: 1 },
  { id: "office-floor-polish", name: "Abrillantador / cera para pisos", description: "Brillo y protección de pisos de alto tráfico.", facilityTypes: ["OFFICE"], basis: "M2", unitCostUsd: 0.08, applicationsPerMonth: 1 },
  { id: "office-glass-pro", name: "Limpiavidrios profesional antiestático", description: "Acabado sin vetas en superficies vidriadas.", facilityTypes: ["OFFICE"], basis: "WINDOW_M2", unitCostUsd: 0.1, applicationsPerMonth: 4 },
  { id: "office-descaler", name: "Descalcificante sanitario", description: "Elimina sarro en baños y grifería.", facilityTypes: ["OFFICE"], basis: "BATHROOM", unitCostUsd: 1.5, applicationsPerMonth: 4 },

  // ---------------- RESIDENCIAL ----------------
  { id: "res-degreaser", name: "Desengrasante para cocina", description: "Grasa adherida en cocina, campana y azulejos.", facilityTypes: ["RESIDENTIAL"], basis: "FLAT", unitCostUsd: 6, applicationsPerMonth: 1 },
  { id: "res-limescale", name: "Removedor de sarro y cal", description: "Baños con incrustaciones de agua dura.", facilityTypes: ["RESIDENTIAL"], basis: "BATHROOM", unitCostUsd: 1.8, applicationsPerMonth: 1 },
  { id: "res-anti-mold", name: "Tratamiento antimoho", description: "Humedad y moho en paredes y juntas.", facilityTypes: ["RESIDENTIAL"], basis: "M2", unitCostUsd: 0.1, applicationsPerMonth: 1 },

  // ---------------- SALUD / CLÍNICO ----------------
  { id: "health-quat-disinfectant", name: "Desinfectante hospitalario (amonios cuaternarios)", description: "Desinfección de superficies de contacto frecuente.", facilityTypes: ["HEALTH"], basis: "M2", unitCostUsd: 0.06, applicationsPerMonth: 4 },
  { id: "health-high-level", name: "Desinfectante de alto nivel (peróxido / ácido peracético)", description: "Áreas críticas y zonas de riesgo biológico.", facilityTypes: ["HEALTH"], basis: "M2", unitCostUsd: 0.15, applicationsPerMonth: 1 },
  { id: "health-bio-spill", name: "Kit de derrames biológicos", description: "Absorbente + desinfectante para fluidos corporales.", facilityTypes: ["HEALTH"], basis: "FLAT", unitCostUsd: 12, applicationsPerMonth: 1 },
  { id: "health-enzymatic", name: "Neutralizador enzimático de olores", description: "Control de olores en áreas clínicas y baños.", facilityTypes: ["HEALTH"], basis: "M2", unitCostUsd: 0.04, applicationsPerMonth: 1 },

  // ---------------- POST-OBRA ----------------
  { id: "post-cement-remover", name: "Desincrustante ácido para cemento y lechada", description: "Restos de cemento, mortero y lechada en pisos.", facilityTypes: ["POST_CONSTRUCTION"], basis: "M2", unitCostUsd: 0.35, applicationsPerMonth: 1 },
  { id: "post-paint-remover", name: "Removedor de pintura y adhesivos", description: "Salpicaduras de pintura y pegamentos.", facilityTypes: ["POST_CONSTRUCTION"], basis: "M2", unitCostUsd: 0.25, applicationsPerMonth: 1 },
  { id: "post-glass-cleaner", name: "Limpiador de vidrios post-obra", description: "Residuos de silicona, pintura y polvo fino en vidrios.", facilityTypes: ["POST_CONSTRUCTION"], basis: "WINDOW_M2", unitCostUsd: 0.3, applicationsPerMonth: 1 },
  { id: "post-tile-protector", name: "Limpiador y protector de porcelanato", description: "Limpieza final y protección de pisos nuevos.", facilityTypes: ["POST_CONSTRUCTION"], basis: "M2", unitCostUsd: 0.2, applicationsPerMonth: 1 },

  // ---------------- INDUSTRIAL ----------------
  { id: "ind-degreaser", name: "Desengrasante industrial alcalino", description: "Aceites y grasas en pisos de planta o bodega.", facilityTypes: ["INDUSTRIAL"], basis: "M2", unitCostUsd: 0.18, applicationsPerMonth: 1 },
  { id: "ind-epoxy-cleaner", name: "Limpiador para pisos epóxicos", description: "Mantenimiento sin dañar el recubrimiento.", facilityTypes: ["INDUSTRIAL"], basis: "M2", unitCostUsd: 0.12, applicationsPerMonth: 1 },
  { id: "ind-rust-remover", name: "Removedor de óxido", description: "Manchas de óxido en pisos y estructuras.", facilityTypes: ["INDUSTRIAL"], basis: "FLAT", unitCostUsd: 15, applicationsPerMonth: 1 },
];

export function getChemicalsForFacility(facilityType: string): SpecialChemical[] {
  return SPECIAL_CHEMICALS.filter((c) => c.facilityTypes.includes(facilityType));
}

// ---------------------------------------------------------------------------
// Cálculo
// ---------------------------------------------------------------------------
export interface ChemicalPricingInput {
  facilityType: string;
  frequencyType?: string;
  areaM2: number;
  bathroomsCount: number;
  windowsM2: number;
  chemicalIds: string[];
}

export interface ChemicalCharge {
  id: string;
  name: string;
  basis: ChemicalBasis;
  quantity: number;
  unitCostUsd: number;
  applications: number;
  directCostUsd: number;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const num = (v: unknown, fallback = 0) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
};

export function computeChemicalCharges(input: ChemicalPricingInput): ChemicalCharge[] {
  const allowed = new Map(getChemicalsForFacility(input.facilityType).map((c) => [c.id, c]));
  const seen = new Set<string>();
  const charges: ChemicalCharge[] = [];

  for (const id of input.chemicalIds) {
    const chem = allowed.get(id);
    if (!chem || seen.has(id)) continue; // ignora ids inválidos o de otro tipo de establecimiento
    seen.add(id);

    const quantity =
      chem.basis === "M2" ? num(input.areaM2)
      : chem.basis === "BATHROOM" ? num(input.bathroomsCount)
      : chem.basis === "WINDOW_M2" ? num(input.windowsM2)
      : 1;
    if (quantity <= 0) continue;

    const applications = input.frequencyType === "SPOT" ? 1 : chem.applicationsPerMonth;
    charges.push({
      id: chem.id,
      name: chem.name,
      basis: chem.basis,
      quantity,
      unitCostUsd: chem.unitCostUsd,
      applications,
      directCostUsd: round2(quantity * chem.unitCostUsd * applications),
    });
  }
  return charges;
}

// Suma los químicos al resultado del motor de precios SIN modificar el motor:
// - Aplica el mismo recargo que el motor ya usa (overhead, margen, frecuencia, IVA),
//   deducido de su propio resultado (subtotal / costo directo).
// - Agrega una línea por cada químico (categoría "SPECIAL_CHEMICAL") y las guarda en parameterSnapshot.
export function applySpecialChemicals<R extends object>(result: R, input: ChemicalPricingInput): R {
  const charges = computeChemicalCharges(input);
  if (charges.length === 0) return result;

  const r = result as any;
  const D = num(r.directCost);
  const O = num(r.overheadCost);
  const Tc = num(r.totalCost);
  const S = num(r.subtotalPrice);
  const V = num(r.ivaAmount);

  const ohPct = D > 0 ? O / D : 0.15;
  const ivaPct = S > 0 ? V / S : 0.15;
  // Factor precio-antes-de-IVA por cada $1 de costo directo (incluye overhead, margen y frecuencia)
  const k = D > 0 && S > 0 ? S / D : (1 + ohPct) / (1 - 0.2);

  const items = charges.map((c) => ({
    category: "SPECIAL_CHEMICAL",
    concept: `Químico especial: ${c.name}`,
    formulaUsed:
      `${c.quantity} ${BASIS_LABEL[c.basis]} × $${c.unitCostUsd.toFixed(2)} × ${c.applications} aplic. ` +
      `= $${c.directCostUsd.toFixed(2)} de producto × factor ${k.toFixed(2)} (overhead + margen)`,
    explanation:
      "Producto especializado según el tipo de establecimiento. El valor incluye el costo del producto, gastos administrativos y margen comercial.",
    amountUsd: round2(c.directCostUsd * k),
  }));

  const C = charges.reduce((a, c) => a + c.directCostUsd, 0);
  const addedSubtotal = items.reduce((a, i) => a + i.amountUsd, 0);
  const newSubtotal = round2(S + addedSubtotal); // las líneas siempre suman el subtotal
  const newIva = round2(newSubtotal * ivaPct);

  return {
    ...result,
    directCost: round2(D + C),
    overheadCost: round2(O + C * ohPct),
    totalCost: round2(Tc + C * (1 + ohPct)),
    subtotalPrice: newSubtotal,
    ivaAmount: newIva,
    finalPrice: round2(newSubtotal + newIva),
    pricePerM2: S > 0 ? round2(num(r.pricePerM2) * (newSubtotal / S)) : r.pricePerM2,
    lineItems: [...(Array.isArray(r.lineItems) ? r.lineItems : []), ...items],
    parameterSnapshot: {
      ...(r.parameterSnapshot ?? {}),
      specialChemicals: charges,
    },
  } as R;
}