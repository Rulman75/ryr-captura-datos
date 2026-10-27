import * as XLSX from 'xlsx';

/**
 * Consolida códigos de barra repetidos sumando sus cantidades.
 */
export function consolidateInventoryItems(items = []) {
  const map = new Map();

  for (const item of items) {
    const code = String(item.barcode || item.CodigoBarra || '').trim();
    const qty = Number(item.quantity ?? item.Cantidad ?? 0);
    if (!code || Number.isNaN(qty) || qty <= 0) continue;

    if (map.has(code)) {
      const prev = map.get(code);
      prev.quantity = Number((prev.quantity + qty).toFixed(4));
      if (item.lastScannedAt && item.lastScannedAt > prev.lastScannedAt) {
        prev.lastScannedAt = item.lastScannedAt;
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
 * Crea el Workbook de Excel con las dos columnas exactas para SAP Business One:
 * CodigoBarra | Cantidad
 */
export function createSapWorkbook(items = []) {
  const consolidated = consolidateInventoryItems(items);

  const rows = consolidated.map((item) => ({
    CodigoBarra: String(item.barcode),
    Cantidad: Number(item.quantity),
  }));

  const worksheet = XLSX.utils.json_to_sheet(rows, {
    header: ['CodigoBarra', 'Cantidad'],
  });

  // Asegurar que la columna CodigoBarra sea siempre Texto en Excel (preserva ceros iniciales)
  const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1:B1');
  for (let R = range.s.r + 1; R <= range.e.r; ++R) {
    const addr = XLSX.utils.encode_cell({ r: R, c: 0 });
    if (worksheet[addr]) {
      worksheet[addr].t = 's';
      worksheet[addr].z = '@';
    }
  }

  worksheet['!cols'] = [{ wch: 24 }, { wch: 14 }];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Inventario_SAP');

  return { workbook, consolidated };
}

/**
 * Descarga directamente el archivo .xlsx en el dispositivo (iMin Lark 1 o PC)
 */
export function downloadSapExcel(session) {
  const { workbook } = createSapWorkbook(session.items || []);
  const safeFolio = (session.folio || 'INV').replace(/[^a-zA-Z0-9_-]/g, '');
  const fileName = `Inventario_RYR_${safeFolio}.xlsx`;
  XLSX.writeFile(workbook, fileName);
  return fileName;
}
