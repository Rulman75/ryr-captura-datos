import { neon } from '@neondatabase/serverless';

let schemaInitialized = false;

/**
 * Obtiene el cliente SQL de Neon si DATABASE_URL está configurado.
 */
export function getNeonClient() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl || dbUrl.includes('ep-ejemplo')) {
    return null;
  }
  return neon(dbUrl);
}

/**
 * Crea automáticamente las tablas en Neon PostgreSQL si no existen.
 */
export async function ensureSchema(sql) {
  if (!sql || schemaInitialized) return;

  await sql`
    CREATE TABLE IF NOT EXISTS inventory_sessions (
      id UUID PRIMARY KEY,
      folio VARCHAR(50) NOT NULL,
      name VARCHAR(150) NOT NULL,
      operator_name VARCHAR(100),
      recipient_email VARCHAR(150),
      total_skus INTEGER NOT NULL DEFAULT 0,
      total_units NUMERIC(12, 2) NOT NULL DEFAULT 0,
      email_sent BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      closed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS inventory_items (
      id SERIAL PRIMARY KEY,
      session_id UUID NOT NULL REFERENCES inventory_sessions(id) ON DELETE CASCADE,
      barcode VARCHAR(120) NOT NULL,
      quantity NUMERIC(12, 2) NOT NULL DEFAULT 1,
      last_scanned_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_inventory_items_session_id ON inventory_items(session_id)
  `;

  schemaInitialized = true;
}

/**
 * Consolida códigos de barra repetidos sumando sus cantidades.
 */
export function consolidateItems(rawItems = []) {
  const map = new Map();

  for (const item of rawItems) {
    const code = String(item.barcode || item.CodigoBarra || '').trim();
    const qty = Number(item.quantity ?? item.Cantidad ?? 0);
    if (!code || Number.isNaN(qty) || qty <= 0) continue;

    if (map.has(code)) {
      const existing = map.get(code);
      existing.quantity = Number((existing.quantity + qty).toFixed(4));
      if (item.lastScannedAt && item.lastScannedAt > existing.lastScannedAt) {
        existing.lastScannedAt = item.lastScannedAt;
      }
    } else {
      map.set(code, {
        barcode: code,
        quantity: Number(qty.toFixed(4)),
        lastScannedAt: item.lastScannedAt || new Date().toISOString(),
      });
    }
  }

  return Array.from(map.values());
}

/**
 * Guarda o actualiza una sesión de inventario y sus ítems consolidados en Neon.
 */
export async function saveSessionToNeon(sessionData, emailSent = false) {
  const sql = getNeonClient();
  if (!sql) {
    return { saved: false, reason: 'DATABASE_URL no configurado' };
  }

  await ensureSchema(sql);

  const items = consolidateItems(sessionData.items || []);
  const totalSkus = items.length;
  const totalUnits = items.reduce((acc, it) => acc + Number(it.quantity), 0);

  const sessionId = sessionData.id || crypto.randomUUID();
  const folio = sessionData.folio || `INV-${Date.now().toString().slice(-6)}`;
  const name = sessionData.name || 'Toma General RYR';
  const operatorName = sessionData.operatorName || 'Operario Bodega';
  const recipientEmail = sessionData.recipientEmail || '';
  const createdAt = sessionData.createdAt || new Date().toISOString();
  const closedAt = sessionData.closedAt || new Date().toISOString();

  await sql`
    INSERT INTO inventory_sessions (
      id, folio, name, operator_name, recipient_email, total_skus, total_units, email_sent, created_at, closed_at
    ) VALUES (
      ${sessionId},
      ${folio},
      ${name},
      ${operatorName},
      ${recipientEmail},
      ${totalSkus},
      ${totalUnits},
      ${emailSent},
      ${createdAt},
      ${closedAt}
    )
    ON CONFLICT (id) DO UPDATE SET
      recipient_email = EXCLUDED.recipient_email,
      total_skus = EXCLUDED.total_skus,
      total_units = EXCLUDED.total_units,
      email_sent = EXCLUDED.email_sent OR inventory_sessions.email_sent,
      closed_at = EXCLUDED.closed_at
  `;

  // Reemplazar ítems de la sesión para asegurar consolidación exacta
  await sql`DELETE FROM inventory_items WHERE session_id = ${sessionId}`;

  for (const item of items) {
    await sql`
      INSERT INTO inventory_items (session_id, barcode, quantity, last_scanned_at)
      VALUES (${sessionId}, ${item.barcode}, ${item.quantity}, ${item.lastScannedAt})
    `;
  }

  return { saved: true, sessionId, totalSkus, totalUnits };
}
