import nodemailer from 'nodemailer';
import * as XLSX from 'xlsx';
import { consolidateItems, saveSessionToNeon } from './_db.js';

/**
 * Genera el archivo Excel (.xlsx) en memoria con las columnas exactas para SAP Business One:
 * - CodigoBarra (Texto, preservando ceros a la izquierda)
 * - Cantidad (Numérico, consolidado por código)
 */
function buildSapExcelBuffer(consolidatedItems) {
  const rows = consolidatedItems.map((item) => ({
    CodigoBarra: String(item.barcode),
    Cantidad: Number(item.quantity),
  }));

  const worksheet = XLSX.utils.json_to_sheet(rows, {
    header: ['CodigoBarra', 'Cantidad'],
  });

  // Forzar formato texto en la columna A (CodigoBarra) para evitar notación científica en EAN13
  const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1:B1');
  for (let R = range.s.r + 1; R <= range.e.r; ++R) {
    const cellAddress = XLSX.utils.encode_cell({ r: R, c: 0 });
    const cell = worksheet[cellAddress];
    if (cell) {
      cell.t = 's';
      cell.z = '@';
    }
  }

  worksheet['!cols'] = [{ wch: 24 }, { wch: 14 }];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Inventario_SAP');

  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Método no permitido' });
  }

  try {
    const {
      id,
      folio,
      name,
      operatorName,
      recipientEmail,
      items = [],
      createdAt,
      closedAt,
      saveToDb = true,
    } = req.body || {};

    const consolidated = consolidateItems(items);
    if (consolidated.length === 0) {
      return res.status(400).json({
        ok: false,
        error: 'La toma de inventario no contiene códigos de barra válidos.',
      });
    }

    if (!recipientEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail.trim())) {
      return res.status(400).json({
        ok: false,
        error: 'Debes ingresar un correo electrónico válido.',
      });
    }

    const cleanEmail = recipientEmail.trim();
    const safeFolio = (folio || `INV-${Date.now().toString().slice(-6)}`).replace(/[^a-zA-Z0-9_-]/g, '');
    const fileName = `Inventario_RYR_${safeFolio}.xlsx`;
    const excelBuffer = buildSapExcelBuffer(consolidated);

    const totalSkus = consolidated.length;
    const totalUnits = consolidated.reduce((sum, it) => sum + Number(it.quantity), 0);

    // 1. Verificar configuración SMTP (Nodemailer)
    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASS;
    const smtpHost = process.env.SMTP_HOST || 'smtp.gmail.com';
    const smtpPort = Number(process.env.SMTP_PORT || 465);
    const smtpSecure = process.env.SMTP_SECURE !== 'false' && smtpPort === 465;
    const fromName = process.env.SMTP_FROM_NAME || 'Inventario RYR Importadora';

    let emailSent = false;
    let emailError = null;

    if (smtpUser && smtpPass && !smtpUser.includes('tu-correo@')) {
      try {
        const transporter = nodemailer.createTransport({
          host: smtpHost,
          port: smtpPort,
          secure: smtpSecure,
          auth: {
            user: smtpUser,
            pass: smtpPass,
          },
          tls: {
            rejectUnauthorized: false,
          },
        });

        const fechaStr = new Date(closedAt || Date.now()).toLocaleString('es-CL', {
          timeZone: 'America/Santiago',
        });

        await transporter.sendMail({
          from: `"${fromName}" <${smtpUser}>`,
          to: cleanEmail,
          subject: `[Importadora R&R] Toma de Inventario ${safeFolio} - ${name || 'Bodega'}`,
          html: `
            <div style="font-family: 'Inter', Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #0f172a; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
              <div style="background-color: #c01323; color: #ffffff; padding: 20px 24px;">
                <h2 style="margin: 0; font-size: 20px; color: #ffffff;">IMPORTADORA R&amp;R · ANTOFAGASTA</h2>
                <p style="margin: 4px 0 0; font-size: 14px; color: #ffe4e6;">Reporte de Toma de Inventario para SAP Business One</p>
              </div>
              <div style="padding: 24px; background-color: #ffffff;">
                <p style="margin-top: 0;">Se adjunta el archivo Excel <strong>${fileName}</strong> consolidado y listo para importar en <strong>SAP Business One</strong>.</p>
                <table style="width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 14px;">
                  <tr style="border-bottom: 1px solid #e2e8f0;">
                    <td style="padding: 8px 0; color: #64748b;">Folio Toma:</td>
                    <td style="padding: 8px 0; font-weight: bold;">${safeFolio}</td>
                  </tr>
                  <tr style="border-bottom: 1px solid #e2e8f0;">
                    <td style="padding: 8px 0; color: #64748b;">Referencia / Bodega:</td>
                    <td style="padding: 8px 0; font-weight: bold;">${name || 'General'}</td>
                  </tr>
                  <tr style="border-bottom: 1px solid #e2e8f0;">
                    <td style="padding: 8px 0; color: #64748b;">Operario (iMin Lark 1):</td>
                    <td style="padding: 8px 0;">${operatorName || 'No especificado'}</td>
                  </tr>
                  <tr style="border-bottom: 1px solid #e2e8f0;">
                    <td style="padding: 8px 0; color: #64748b;">Fecha de cierre:</td>
                    <td style="padding: 8px 0;">${fechaStr}</td>
                  </tr>
                  <tr style="border-bottom: 1px solid #e2e8f0;">
                    <td style="padding: 8px 0; color: #64748b;">Códigos únicos (SKUs):</td>
                    <td style="padding: 8px 0; font-weight: bold; color: #0f172a;">${totalSkus}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; color: #64748b;">Total Unidades Contadas:</td>
                    <td style="padding: 8px 0; font-weight: bold; font-size: 16px; color: #c01323;">${totalUnits}</td>
                  </tr>
                </table>
                <p style="font-size: 12px; color: #64748b; margin-top: 24px;">
                  Columnas incluidas en el archivo adjunto: <code>CodigoBarra</code> y <code>Cantidad</code>.
                </p>
              </div>
            </div>
          `,
          attachments: [
            {
              filename: fileName,
              content: excelBuffer,
              contentType:
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            },
          ],
        });

        emailSent = true;
      } catch (err) {
        console.error('[Error SMTP Nodemailer]:', err);
        emailError = err.message || 'Error al conectar con el servidor SMTP';
      }
    } else {
      emailError =
        'Variables SMTP_USER / SMTP_PASS aún no configuradas en el servidor (.env / Vercel).';
    }

    // 2. Guardar respaldo en Neon PostgreSQL
    let neonResult = { saved: false, reason: 'Omitido' };
    if (saveToDb) {
      try {
        neonResult = await saveSessionToNeon(
          {
            id,
            folio: safeFolio,
            name,
            operatorName,
            recipientEmail: cleanEmail,
            items: consolidated,
            createdAt,
            closedAt,
          },
          emailSent
        );
      } catch (dbErr) {
        console.error('[Error Neon DB]:', dbErr);
        neonResult = { saved: false, reason: dbErr.message };
      }
    }

    return res.status(200).json({
      ok: true,
      emailSent,
      emailError,
      savedToNeon: neonResult.saved,
      neonInfo: neonResult,
      fileName,
      totalSkus,
      totalUnits,
    });
  } catch (error) {
    console.error('[API /api/send-inventory Error]:', error);
    return res.status(500).json({
      ok: false,
      error: error.message || 'Error interno procesando el inventario',
    });
  }
}
