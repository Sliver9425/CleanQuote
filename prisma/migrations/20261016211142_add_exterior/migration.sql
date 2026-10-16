-- CreateTable
CREATE TABLE "PricingParameter" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL,
    "explanation" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PricingParameter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Quote" (
    "id" TEXT NOT NULL,
    "quoteType" TEXT NOT NULL,
    "clientName" TEXT NOT NULL,
    "facilityName" TEXT NOT NULL,
    "totalHoursMonth" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "directCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "overheadCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "marginPct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "subtotalPrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "ivaAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "finalPrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "pricePerM2" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "parameterSnapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Quote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InteriorQuoteDetails" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "facilityType" TEXT NOT NULL,
    "floorMaterial" TEXT NOT NULL,
    "areaM2" DOUBLE PRECISION NOT NULL,
    "bathroomsCount" INTEGER NOT NULL DEFAULT 0,
    "windowsM2" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "riskLevel" TEXT NOT NULL,
    "trafficLevel" TEXT NOT NULL,
    "disinfectionLevel" TEXT NOT NULL,
    "frequencyType" TEXT NOT NULL,
    "eventsPerMonth" DOUBLE PRECISION NOT NULL,
    "effectiveRateM2H" DOUBLE PRECISION NOT NULL,
    "hoursPerEvent" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InteriorQuoteDetails_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExteriorQuoteDetails" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "servicesRequested" TEXT[],
    "areaM2" DOUBLE PRECISION NOT NULL,
    "linearMeters" DOUBLE PRECISION,
    "vegetationLevel" TEXT NOT NULL,
    "terrainSlope" TEXT NOT NULL,
    "accessibility" TEXT NOT NULL,
    "hasTrees" BOOLEAN NOT NULL DEFAULT false,
    "debrisVolumeM3" DOUBLE PRECISION,
    "debrisType" TEXT,
    "volquetasEstimated" DOUBLE PRECISION,
    "distanceToDumpKm" DOUBLE PRECISION,
    "mobilizationNeeded" BOOLEAN NOT NULL DEFAULT false,
    "baseRateM2" DOUBLE PRECISION NOT NULL,
    "vegetationFactor" DOUBLE PRECISION NOT NULL,
    "slopeFactor" DOUBLE PRECISION NOT NULL,
    "accessFactor" DOUBLE PRECISION NOT NULL,
    "effectiveRateM2" DOUBLE PRECISION NOT NULL,
    "cleaningCost" DOUBLE PRECISION NOT NULL,
    "debrisDisposalCost" DOUBLE PRECISION NOT NULL,
    "mobilizationCost" DOUBLE PRECISION NOT NULL,
    "totalExteriorCost" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExteriorQuoteDetails_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteLineItem" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "concept" TEXT NOT NULL,
    "formulaUsed" TEXT NOT NULL,
    "explanation" TEXT NOT NULL,
    "amountUsd" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "QuoteLineItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PricingParameter_key_key" ON "PricingParameter"("key");

-- CreateIndex
CREATE UNIQUE INDEX "InteriorQuoteDetails_quoteId_key" ON "InteriorQuoteDetails"("quoteId");

-- CreateIndex
CREATE UNIQUE INDEX "ExteriorQuoteDetails_quoteId_key" ON "ExteriorQuoteDetails"("quoteId");

-- AddForeignKey
ALTER TABLE "InteriorQuoteDetails" ADD CONSTRAINT "InteriorQuoteDetails_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExteriorQuoteDetails" ADD CONSTRAINT "ExteriorQuoteDetails_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteLineItem" ADD CONSTRAINT "QuoteLineItem_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;
