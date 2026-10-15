# CleanQuote — MVP de cotizaciones

Next.js App Router + TypeScript + Prisma + PostgreSQL.

## Qué incluye esta versión
- Formulario editable para clientes/empleados.
- Captura de voz mediante Web Speech API cuando el navegador la soporta; extracción de campos básica y revisable, **no** conversación completa por IA todavía.
- API `GET/POST /api/quotes`, cálculo con tarifas guardadas y listado de las últimas 100 cotizaciones.
- Códigos de descuento que solo aplican si existen en `AuthorizedDiscount` y están activos.
- Vista de desglose e impresión del navegador para guardar como PDF. El botón de correo prepara un `mailto:`; no envía correo en segundo plano.
- No se incluyen valores comerciales por defecto: el motor se niega a cotizar si faltan parámetros.

## Requisitos
Node.js compatible con Next.js 16, Docker y npm.

1. Copia `.env.example` como `.env`.
2. Arranca PostgreSQL: `docker compose up -d postgres`.
3. Instala dependencias: `npm install`.
4. Genera cliente Prisma: `npx prisma generate`.
5. Aplica el esquema en desarrollo: `npx prisma db push`.
6. Arranca: `npm run dev`.

## Configuración obligatoria de tarifas
Crea registros `PricingParameter` en la base de datos (Prisma Studio: `npx prisma studio`) con estas claves. **Los valores deben venir de la empresa; no se proponen tarifas ficticias.**

| key | unidad | significado |
|---|---|---|
| `LABOR_USD_HOUR` | USD/h | costo laboral por hora |
| `PRODUCTIVITY_M2_HOUR` | m²/h | productividad base de limpieza |
| `BATHROOM_HOURS` | h/baño/visita | horas adicionales por baño y visita |
| `WINDOW_M2_HOUR` | m²/h | productividad de ventanas |
| `SUPPLIES_USD_HOUR` | USD/h | costo de insumos por hora |
| `EQUIPMENT_USD_HOUR` | USD/h | costo de equipos por hora |
| `OVERHEAD_PCT` | % | porcentaje de costos indirectos |
| `MARGIN_PCT` | % | margen comercial aplicado al costo |
| `TAX_PCT` | % | tasa tributaria configurada y validada por contabilidad |

La fórmula actual es una **base explícita y revisable**, no una política comercial certificada. `riskLevel`, `trafficLevel`, `floorMaterial` y `disinfectionLevel` se guardan, pero no alteran todavía el cálculo porque el negocio debe definir los factores para cada uno. Confirmar la tasa tributaria aplicable con contabilidad antes de usar cotizaciones reales.

## Descuento autorizado
Crear un registro `AuthorizedDiscount` con `code` en mayúsculas, `maxPct`, `active=true` y opcionalmente `expiresAt`. Este MVP no implementa todavía usuarios/roles ni una pantalla de administración segura; no exponer Prisma Studio ni acceso a la base de datos en producción. La autenticación/autorización es requisito antes de producción.

## Pendiente antes de producción
- Autenticación y roles (cliente/empleado/administrador) y control de acceso por cotización.
- Conversación de voz real con transcripción + modelo IA con salida JSON estructurada, manejo de turnos, preguntas de aclaración y límites de coste.
- Servicio de correo transaccional configurado (SMTP/API), plantillas y registro de envío.
- PDF de servidor con plantilla corporativa y condiciones comerciales.
- Migraciones revisadas, pruebas unitarias del motor, pruebas de integración, protección CSRF/rate limit y validación de correo.
- Fórmulas aprobadas por negocio, incluida la periodicidad mensual y los factores por tipo de instalación/riesgo/tráfico/suelo/desinfección.
