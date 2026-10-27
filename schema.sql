-- ============================================================================
-- ESQUEMA SQL PARA NEON POSTGRESQL - RYR IMPORTADORA (TOMA DE INVENTARIO)
-- Nota: El aplicativo también crea estas tablas automáticamente si no existen.
-- ============================================================================

CREATE TABLE IF NOT EXISTS inventory_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    folio VARCHAR(50) NOT NULL,
    name VARCHAR(150) NOT NULL,
    operator_name VARCHAR(100),
    recipient_email VARCHAR(150),
    total_skus INTEGER NOT NULL DEFAULT 0,
    total_units NUMERIC(12, 2) NOT NULL DEFAULT 0,
    email_sent BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    closed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS inventory_items (
    id SERIAL PRIMARY KEY,
    session_id UUID NOT NULL REFERENCES inventory_sessions(id) ON DELETE CASCADE,
    barcode VARCHAR(120) NOT NULL,
    quantity NUMERIC(12, 2) NOT NULL DEFAULT 1,
    last_scanned_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_inventory_items_session_id ON inventory_items(session_id);
CREATE INDEX IF NOT EXISTS idx_inventory_items_barcode ON inventory_items(barcode);
