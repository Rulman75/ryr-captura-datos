import { ensureSchema, getNeonClient, saveSessionToNeon } from './_db.js';

export default async function handler(req, res) {
  const sql = getNeonClient();
  const smtpConfigured = Boolean(
    process.env.SMTP_USER &&
      process.env.SMTP_PASS &&
      !process.env.SMTP_USER.includes('tu-correo@')
  );
  const neonConfigured = Boolean(sql);

  if (req.method === 'GET') {
    if (!sql) {
      return res.status(200).json({
        ok: true,
        neonConfigured: false,
        smtpConfigured,
        sessions: [],
      });
    }

    try {
      await ensureSchema(sql);

      const sessions = await sql`
        SELECT
          id,
          folio,
          name,
          operator_name AS "operatorName",
          recipient_email AS "recipientEmail",
          total_skus AS "totalSkus",
          total_units AS "totalUnits",
          email_sent AS "emailSent",
          created_at AS "createdAt",
          closed_at AS "closedAt"
        FROM inventory_sessions
        ORDER BY closed_at DESC
        LIMIT 30
      `;

      // Cargar ítems si se solicita una sesión específica o para las sesiones recientes
      const sessionIds = sessions.map((s) => s.id);
      let itemsBySession = {};

      if (sessionIds.length > 0) {
        const allItems = await sql`
          SELECT
            session_id AS "sessionId",
            barcode,
            quantity,
            last_scanned_at AS "lastScannedAt"
          FROM inventory_items
          WHERE session_id = ANY(${sessionIds})
          ORDER BY id ASC
        `;

        for (const item of allItems) {
          if (!itemsBySession[item.sessionId]) {
            itemsBySession[item.sessionId] = [];
          }
          itemsBySession[item.sessionId].push({
            barcode: item.barcode,
            quantity: Number(item.quantity),
            lastScannedAt: item.lastScannedAt,
          });
        }
      }

      const enriched = sessions.map((s) => ({
        ...s,
        totalUnits: Number(s.totalUnits),
        savedToNeon: true,
        items: itemsBySession[s.id] || [],
      }));

      return res.status(200).json({
        ok: true,
        neonConfigured: true,
        smtpConfigured,
        sessions: enriched,
      });
    } catch (err) {
      console.error('[GET /api/inventories Error]:', err);
      return res.status(200).json({
        ok: false,
        neonConfigured: true,
        smtpConfigured,
        error: err.message,
        sessions: [],
      });
    }
  }

  if (req.method === 'POST') {
    try {
      const result = await saveSessionToNeon(req.body, Boolean(req.body?.emailSent));
      return res.status(200).json({
        ok: result.saved,
        ...result,
      });
    } catch (err) {
      return res.status(500).json({
        ok: false,
        error: err.message,
      });
    }
  }

  return res.status(405).json({ ok: false, error: 'Método no permitido' });
}
