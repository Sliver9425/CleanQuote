import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  calculateCleanQuote,
  type QuoteParams,
  type QuoteLineItem,
} from "@/lib/pricing/engine";

function validText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

const requiredTextFields = [
  "clientName",
  "facilityName",
  "facilityType",
  "floorMaterial",
  "riskLevel",
  "trafficLevel",
  "disinfectionLevel",
  "frequencyType",
] as const;

const numericFields = [
  "areaM2",
  "bathroomsCount",
  "windowsM2",
  "eventsPerMonth",
] as const;

export async function GET() {
  try {
    const quotes = await prisma.quote.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { lineItems: true },
    });
    return NextResponse.json({ quotes });
  } catch (error) {
    console.error("Error consultando historial de cotizaciones:", error);
    return NextResponse.json(
      {
        error:
          "No se pudo consultar el historial. Verifica DATABASE_URL y las migraciones.",
      },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const raw: unknown = await req.json();
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return NextResponse.json(
        { error: "El cuerpo de la solicitud no es válido." },
        { status: 400 },
      );
    }
    const body = raw as Record<string, unknown>;

    for (const key of requiredTextFields) {
      if (!validText(body[key])) {
        return NextResponse.json(
          { error: `El campo ${key} es obligatorio.` },
          { status: 400 },
        );
      }
    }

    for (const key of numericFields) {
      const value = body[key];
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
        return NextResponse.json(
          { error: `El campo ${key} debe ser un número válido no negativo.` },
          { status: 400 },
        );
      }
    }

    if (
      (body.areaM2 as number) <= 0 ||
      (body.eventsPerMonth as number) <= 0 ||
      !Number.isInteger(body.bathroomsCount)
    ) {
      return NextResponse.json(
        {
          error:
            "La superficie y las visitas mensuales deben ser mayores que cero; baños debe ser entero.",
        },
        { status: 400 },
      );
    }

    if (
      body.clientEmail !== undefined &&
      body.clientEmail !== null &&
      body.clientEmail !== "" &&
      (typeof body.clientEmail !== "string" ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.clientEmail))
    ) {
      return NextResponse.json(
        { error: "El correo del cliente no es válido." },
        { status: 400 },
      );
    }

    const params = body as unknown as QuoteParams;
    const calculated = calculateCleanQuote(params);

    // Los descuentos solo se aceptan si existen, están activos y no han vencido.
    let discountPct = 0; // fracción: 0.10 = 10 %
    let discountCode: string | null = null;
    const submittedCode =
      typeof body.discountCode === "string" ? body.discountCode.trim() : "";

    if (submittedCode) {
      const authorized = await prisma.authorizedDiscount.findUnique({
        where: { code: submittedCode },
      });
      if (
        !authorized ||
        !authorized.active ||
        (authorized.expiresAt && authorized.expiresAt < new Date())
      ) {
        return NextResponse.json(
          {
            error:
              "El código de descuento no existe, está inactivo o ha vencido.",
          },
          { status: 400 },
        );
      }
      // Admite maxPct expresado como 10 o como 0.10.
      discountPct =
        authorized.maxPct > 1 ? authorized.maxPct / 100 : authorized.maxPct;
      if (discountPct < 0 || discountPct > 1) {
        return NextResponse.json(
          { error: "El porcentaje del código de descuento no es válido." },
          { status: 400 },
        );
      }
      discountCode = authorized.code;
    }

    const discountAmount = Number(
      (calculated.subtotalPrice * discountPct).toFixed(2),
    );
    const subtotalPrice = Number(
      (calculated.subtotalPrice - discountAmount).toFixed(2),
    );
    const ivaAmount = Number((subtotalPrice * 0.15).toFixed(2));
    const finalPrice = Number((subtotalPrice + ivaAmount).toFixed(2));

    const lineItems: QuoteLineItem[] = calculated.lineItems.map((item) => {
      if (item.category === "TAX") {
        return {
          ...item,
          amountUsd: ivaAmount,
          explanation: `IVA del 15 % aplicado al subtotal después del descuento (${subtotalPrice.toFixed(2)} USD).`,
        };
      }
      return item;
    });

    if (discountAmount > 0) {
      lineItems.push({
        category: "DISCOUNT_SURCHARGE",
        concept: `Descuento autorizado${discountCode ? ` (${discountCode})` : ""}`,
        formulaUsed: "subtotal antes de descuento × porcentaje autorizado",
        explanation: `Descuento del ${(discountPct * 100).toFixed(2)} % aplicado antes del IVA.`,
        amountUsd: -discountAmount,
      });
    }

    const parameterSnapshot = {
      ...calculated.parameterSnapshot,
      discount: {
        code: discountCode,
        pct: discountPct,
        amount: discountAmount,
      },
      finalAmounts: { subtotalPrice, ivaAmount, finalPrice },
    } as Prisma.InputJsonValue;

    const quote = await prisma.quote.create({
      data: {
        clientName: params.clientName.trim(),
        clientEmail:
          typeof params.clientEmail === "string" && params.clientEmail.trim()
            ? params.clientEmail.trim()
            : null,
        facilityName: params.facilityName.trim(),
        facilityType: params.facilityType,
        floorMaterial: params.floorMaterial,
        areaM2: params.areaM2,
        bathroomsCount: params.bathroomsCount,
        windowsM2: params.windowsM2,
        riskLevel: params.riskLevel,
        trafficLevel: params.trafficLevel,
        disinfectionLevel: params.disinfectionLevel,
        frequencyType: calculated.frequencyType,
        eventsPerMonth: params.eventsPerMonth,
        discountPct: Number((discountPct * 100).toFixed(4)),
        discountAmount,
        effectiveRateM2H: calculated.effectiveRateM2H,
        hoursPerEvent: calculated.hoursPerEvent,
        totalHoursMonth: calculated.totalHoursMonth,
        directCost: calculated.directCost,
        overheadCost: calculated.overheadCost,
        totalCost: calculated.totalCost,
        marginPct: calculated.marginPct,
        subtotalPrice,
        ivaAmount,
        finalPrice,
        pricePerM2: Number((finalPrice / params.areaM2).toFixed(2)),
        parameterSnapshot,
        lineItems: {
          create: lineItems,
        },
      },
      include: { lineItems: true },
    });

    return NextResponse.json({ quote }, { status: 201 });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Error interno al crear la cotización.";
    console.error("Error creando cotización:", error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
