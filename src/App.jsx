import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Barcode,
  Send,
  Download,
  History,
  Plus,
  Minus,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Volume2,
  VolumeX,
  Keyboard,
  Cloud,
  CloudOff,
  RefreshCw,
  FileSpreadsheet,
  FolderPlus,
  Search,
  Sparkles,
  Mail,
  User,
  Warehouse,
  Hash,
  Eye,
  X,
  ArrowUpRight,
  Layers,
} from 'lucide-react';
import { playScanBeep, playErrorBeep } from './utils/sound.js';
import { downloadSapExcel } from './utils/excel.js';

const STORAGE_KEYS = {
  ACTIVE_SESSION: 'ryr_active_inventory_v1',
  HISTORY: 'ryr_inventory_history_v1',
  SETTINGS: 'ryr_inventory_settings_v1',
};

const DEMO_BARCODES = [
  '7801610001234',
  '7802800543219',
  '7804650998812',
  '7809102345678',
  '6934177710293',
  '8412345678905',
];

function generateFolio() {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  const rnd = String(Math.floor(10 + Math.random() * 90));
  return `INV-${dd}${mm}-${hh}${min}-${rnd}`;
}

function createEmptySession(defaultOperator = '') {
  return {
    id: crypto.randomUUID ? crypto.randomUUID() : `id-${Date.now()}-${Math.random()}`,
    folio: generateFolio(),
    name: 'Bodega Antofagasta',
    operatorName: defaultOperator || '',
    items: [], // Array consolidado: [{ barcode, quantity, lastScannedAt }]
    createdAt: new Date().toISOString(),
  };
}

export default function App() {
  // Configuración persistente (Correo recordado, sonido, teclado virtual, modo)
  const [settings, setSettings] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.SETTINGS);
      if (saved) return JSON.parse(saved);
    } catch {}
    return {
      recipientEmail: '',
      operatorName: '',
      soundEnabled: true,
      allowVirtualKeyboard: false, // false = bloquea el teclado en pantalla en el iMin Lark 1
      scanMode: 'burst', // 'burst' (+1/multiplicador automático) | 'prompt' (preguntar cantidad al pistolear)
      defaultMultiplier: 1,
    };
  });

  // Sesión de inventario activa en curso
  const [session, setSession] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.ACTIVE_SESSION);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && Array.isArray(parsed.items)) return parsed;
      }
    } catch {}
    return createEmptySession(settings.operatorName);
  });

  // Historial local de tomas cerradas
  const [localHistory, setLocalHistory] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.HISTORY);
      if (saved) return JSON.parse(saved);
    } catch {}
    return [];
  });

  // Historial en Neon PostgreSQL y estado del servidor
  const [cloudHistory, setCloudHistory] = useState([]);
  const [serverStatus, setServerStatus] = useState({
    neonConfigured: false,
    smtpConfigured: false,
    loading: false,
  });
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  // Navegación principal: 'scanner' | 'history'
  const [activeTab, setActiveTab] = useState('scanner');

  // Estados de captura de código de barra
  const [barcodeInput, setBarcodeInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [lastScanned, setLastScanned] = useState(null);
  const [flashKey, setFlashKey] = useState(0);

  // Modal de cantidad cuando está en modo "Preguntar Cantidad" o al editar un ítem
  const [qtyModal, setQtyModal] = useState({
    open: false,
    barcode: '',
    mode: 'add', // 'add' (sumar al código escaneado) | 'set' (reemplazar cantidad total)
    currentTotal: 0,
    inputValue: '1',
  });

  // Modal de Finalizar Toma y Enviar por Correo
  const [finishModalOpen, setFinishModalOpen] = useState(false);
  const [sendingState, setSendingState] = useState({
    loading: false,
    completed: false,
    result: null,
    error: null,
  });

  // Modal para ver detalle o reenviar una toma del historial
  const [selectedHistoryItem, setSelectedHistoryItem] = useState(null);
  const [resendEmailInput, setResendEmailInput] = useState('');
  const [resendingId, setResendingId] = useState(null);

  // Notificación flotante (Toast)
  const [toast, setToast] = useState(null);

  const scannerInputRef = useRef(null);
  const qtyModalInputRef = useRef(null);
  const hardwareBufferRef = useRef({ chars: '', lastTime: 0 });

  const showToast = (message, type = 'success') => {
    setToast({ message, type, id: Date.now() });
  };

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3800);
    return () => clearTimeout(timer);
  }, [toast]);

  // Guardar sesión activa en localStorage cada vez que cambie (100% Offline-First)
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.ACTIVE_SESSION, JSON.stringify(session));
    } catch (e) {
      console.error('Error guardando sesión en localStorage:', e);
    }
  }, [session]);

  // Guardar configuración
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
    } catch {}
  }, [settings]);

  // Guardar historial local
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.HISTORY, JSON.stringify(localHistory));
    } catch {}
  }, [localHistory]);

  // Detectar conexión a internet
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Cargar estado de servidor y respaldos desde Neon PostgreSQL
  const fetchCloudInventories = async () => {
    setServerStatus((prev) => ({ ...prev, loading: true }));
    try {
      const resp = await fetch('/api/inventories');
      if (resp.ok) {
        const data = await resp.json();
        setServerStatus({
          neonConfigured: Boolean(data.neonConfigured),
          smtpConfigured: Boolean(data.smtpConfigured),
          loading: false,
        });
        if (Array.isArray(data.sessions)) {
          setCloudHistory(data.sessions);
        }
      } else {
        setServerStatus((prev) => ({ ...prev, loading: false }));
      }
    } catch {
      setServerStatus((prev) => ({ ...prev, loading: false }));
    }
  };

  useEffect(() => {
    fetchCloudInventories();
  }, []);

  // Mantener foco en el lector del iMin Lark 1 cuando estamos en la vista de escaneo y sin modales abiertos
  const focusScannerInput = () => {
    if (
      activeTab === 'scanner' &&
      !qtyModal.open &&
      !finishModalOpen &&
      !selectedHistoryItem
    ) {
      scannerInputRef.current?.focus();
    }
  };

  useEffect(() => {
    focusScannerInput();
  }, [activeTab, qtyModal.open, finishModalOpen, selectedHistoryItem]);

  // Listener global de hardware para el iMin Lark 1:
  // Si el operario hizo scroll y el input perdió el foco, captura la ráfaga del lector láser + Enter
  useEffect(() => {
    const handleGlobalKeyDown = (e) => {
      if (activeTab !== 'scanner' || qtyModal.open || finishModalOpen || selectedHistoryItem) {
        return;
      }

      const activeTag = document.activeElement?.tagName?.toLowerCase();
      const isOtherInput =
        (activeTag === 'input' || activeTag === 'textarea') &&
        document.activeElement !== scannerInputRef.current;

      if (isOtherInput) return;

      // Si ya está enfocado el input principal del escáner, su propio onKeyDown lo maneja
      if (document.activeElement === scannerInputRef.current) return;

      const now = Date.now();
      if (now - hardwareBufferRef.current.lastTime > 120) {
        hardwareBufferRef.current.chars = '';
      }
      hardwareBufferRef.current.lastTime = now;

      if (e.key === 'Enter' || e.key === 'Tab') {
        const captured = hardwareBufferRef.current.chars.trim();
        if (captured.length >= 2) {
          e.preventDefault();
          hardwareBufferRef.current.chars = '';
          handleProcessBarcode(captured);
        }
      } else if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
        hardwareBufferRef.current.chars += e.key;
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  });

  // Agregar o consolidar un código de barras en la sesión actual
  const commitBarcodeQuantity = (rawCode, deltaQty, mode = 'add') => {
    const code = String(rawCode || '').trim();
    const numericQty = Number(deltaQty);

    if (!code || Number.isNaN(numericQty) || numericQty <= 0) {
      playErrorBeep(settings.soundEnabled);
      return;
    }

    const nowIso = new Date().toISOString();
    let newTotalForCode = numericQty;

    setSession((prev) => {
      const existingIndex = prev.items.findIndex((it) => it.barcode === code);
      let updatedItems;

      if (existingIndex >= 0) {
        const currentItem = prev.items[existingIndex];
        newTotalForCode =
          mode === 'set'
            ? Number(numericQty.toFixed(4))
            : Number((Number(currentItem.quantity) + numericQty).toFixed(4));

        const updatedItem = {
          ...currentItem,
          quantity: newTotalForCode,
          lastScannedAt: nowIso,
        };

        // Mover el ítem recién pistoleado al principio de la lista para feedback inmediato
        updatedItems = [
          updatedItem,
          ...prev.items.slice(0, existingIndex),
          ...prev.items.slice(existingIndex + 1),
        ];
      } else {
        newTotalForCode = Number(numericQty.toFixed(4));
        updatedItems = [
          {
            barcode: code,
            quantity: newTotalForCode,
            lastScannedAt: nowIso,
          },
          ...prev.items,
        ];
      }

      return {
        ...prev,
        items: updatedItems,
      };
    });

    setLastScanned({
      barcode: code,
      added: numericQty,
      mode,
      total: newTotalForCode,
      timestamp: nowIso,
    });
    setFlashKey((k) => k + 1);
    playScanBeep(settings.soundEnabled);
  };

  // Procesa el código cuando el iMin Lark 1 dispara código + Enter
  const handleProcessBarcode = (rawInput) => {
    const cleanCode = String(rawInput || '').trim();
    if (!cleanCode) return;

    setBarcodeInput('');

    if (settings.scanMode === 'prompt') {
      const existing = session.items.find((it) => it.barcode === cleanCode);
      playScanBeep(settings.soundEnabled);
      setQtyModal({
        open: true,
        barcode: cleanCode,
        mode: 'add',
        currentTotal: existing ? existing.quantity : 0,
        inputValue: String(settings.defaultMultiplier || 1),
      });
      setTimeout(() => {
        qtyModalInputRef.current?.focus();
        qtyModalInputRef.current?.select();
      }, 60);
    } else {
      commitBarcodeQuantity(cleanCode, settings.defaultMultiplier || 1, 'add');
      setTimeout(focusScannerInput, 20);
    }
  };

  // Ajustar +1 / -1 directamente en una fila de la lista
  const adjustItemQuantity = (barcode, delta) => {
    setSession((prev) => {
      const idx = prev.items.findIndex((it) => it.barcode === barcode);
      if (idx === -1) return prev;

      const currentQty = Number(prev.items[idx].quantity);
      const nextQty = Number((currentQty + delta).toFixed(4));

      if (nextQty <= 0) {
        return {
          ...prev,
          items: prev.items.filter((it) => it.barcode !== barcode),
        };
      }

      const nextItems = [...prev.items];
      nextItems[idx] = {
        ...nextItems[idx],
        quantity: nextQty,
        lastScannedAt: new Date().toISOString(),
      };
      return { ...prev, items: nextItems };
    });
  };

  const removeItem = (barcode) => {
    setSession((prev) => ({
      ...prev,
      items: prev.items.filter((it) => it.barcode !== barcode),
    }));
    showToast(`Código ${barcode} eliminado de la toma`, 'info');
  };

  // Totales calculados en tiempo real
  const totals = useMemo(() => {
    const totalSkus = session.items.length;
    const totalUnits = session.items.reduce(
      (sum, item) => sum + Number(item.quantity || 0),
      0
    );
    return {
      totalSkus,
      totalUnits: Number(totalUnits.toFixed(2)),
    };
  }, [session.items]);

  // Filtrado de ítems por buscador
  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return session.items;
    return session.items.filter((it) => it.barcode.toLowerCase().includes(q));
  }, [session.items, searchQuery]);

  // Combinar historial Local + Neon PostgreSQL sin duplicar por ID
  const mergedHistory = useMemo(() => {
    const map = new Map();

    for (const item of localHistory) {
      map.set(item.id, { ...item, savedLocally: true });
    }
    for (const cloudItem of cloudHistory) {
      if (map.has(cloudItem.id)) {
        const local = map.get(cloudItem.id);
        map.set(cloudItem.id, {
          ...local,
          ...cloudItem,
          items:
            cloudItem.items && cloudItem.items.length > 0
              ? cloudItem.items
              : local.items || [],
          savedLocally: true,
          savedToNeon: true,
        });
      } else {
        map.set(cloudItem.id, {
          ...cloudItem,
          savedLocally: false,
          savedToNeon: true,
        });
      }
    }

    return Array.from(map.values()).sort(
      (a, b) =>
        new Date(b.closedAt || b.createdAt || 0).getTime() -
        new Date(a.closedAt || a.createdAt || 0).getTime()
    );
  }, [localHistory, cloudHistory]);

  const saveToLocalHistory = (closedSession) => {
    setLocalHistory((prev) => {
      const filtered = prev.filter((s) => s.id !== closedSession.id);
      return [closedSession, ...filtered];
    });
  };

  const startNewInventorySession = (archiveCurrentFirst = false) => {
    if (archiveCurrentFirst && session.items.length > 0) {
      const closedRecord = {
        ...session,
        recipientEmail: settings.recipientEmail || '',
        totalSkus: totals.totalSkus,
        totalUnits: totals.totalUnits,
        closedAt: new Date().toISOString(),
      };
      saveToLocalHistory(closedRecord);
    }

    const fresh = createEmptySession(session.operatorName || settings.operatorName);
    setSession(fresh);
    setLastScanned(null);
    setSearchQuery('');
    setFinishModalOpen(false);
    setSendingState({ loading: false, completed: false, result: null, error: null });
    showToast(`Nueva toma iniciada (${fresh.folio})`, 'success');
    setTimeout(focusScannerInput, 80);
  };

  // Enviar Excel por correo + Respaldar en Neon + Guardar en Historial Local
  const handleSendAndSaveInventory = async (e) => {
    if (e) e.preventDefault();

    const email = (settings.recipientEmail || '').trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      playErrorBeep(settings.soundEnabled);
      setSendingState((prev) => ({
        ...prev,
        error: 'Ingresa un correo electrónico válido para enviar el Excel.',
      }));
      return;
    }

    if (session.items.length === 0) {
      setSendingState((prev) => ({
        ...prev,
        error: 'No hay productos escaneados en esta toma.',
      }));
      return;
    }

    setSendingState({ loading: true, completed: false, result: null, error: null });

    const closedAt = new Date().toISOString();
    const payload = {
      id: session.id,
      folio: session.folio,
      name: session.name || 'Bodega Antofagasta',
      operatorName: session.operatorName || settings.operatorName || 'Operario iMin',
      recipientEmail: email,
      items: session.items,
      createdAt: session.createdAt,
      closedAt,
      saveToDb: true,
    };

    try {
      const response = await fetch('/api/send-inventory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await response.json();

      const localRecord = {
        ...payload,
        totalSkus: totals.totalSkus,
        totalUnits: totals.totalUnits,
        emailSent: Boolean(data.emailSent),
        savedToNeon: Boolean(data.savedToNeon),
      };

      saveToLocalHistory(localRecord);

      if (data.savedToNeon) {
        fetchCloudInventories();
      }

      if (!response.ok || !data.ok) {
        throw new Error(data.error || 'Error al procesar el envío en el servidor.');
      }

      setSendingState({
        loading: false,
        completed: true,
        result: data,
        error: data.emailSent ? null : data.emailError,
      });

      playScanBeep(settings.soundEnabled);
    } catch (err) {
      const offlineRecord = {
        ...payload,
        totalSkus: totals.totalSkus,
        totalUnits: totals.totalUnits,
        emailSent: false,
        savedToNeon: false,
      };
      saveToLocalHistory(offlineRecord);

      setSendingState({
        loading: false,
        completed: true,
        result: {
          emailSent: false,
          savedToNeon: false,
          offlineSaved: true,
        },
        error:
          'Sin conexión al servidor de correo. La toma quedó guardada en el dispositivo y puedes descargar el Excel o reenviarlo al recuperar Wi-Fi.',
      });
    }
  };

  const handleResendHistorySession = async (histSession, customEmail) => {
    const targetEmail = (
      customEmail ||
      histSession.recipientEmail ||
      settings.recipientEmail ||
      ''
    ).trim();
    if (!targetEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(targetEmail)) {
      showToast('Ingresa un correo electrónico válido para enviar el Excel', 'error');
      return;
    }

    setResendingId(histSession.id);
    try {
      const resp = await fetch('/api/send-inventory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...histSession,
          recipientEmail: targetEmail,
          saveToDb: true,
        }),
      });
      const data = await resp.json();

      const updated = {
        ...histSession,
        recipientEmail: targetEmail,
        emailSent: Boolean(data.emailSent) || histSession.emailSent,
        savedToNeon: Boolean(data.savedToNeon) || histSession.savedToNeon,
      };
      saveToLocalHistory(updated);
      if (selectedHistoryItem?.id === histSession.id) {
        setSelectedHistoryItem(updated);
      }
      fetchCloudInventories();

      if (data.emailSent) {
        showToast(`Excel enviado a ${targetEmail}`, 'success');
      } else {
        showToast(
          data.emailError || 'Guardado en historial. Configura SMTP para envío directo.',
          'info'
        );
      }
    } catch (err) {
      showToast(`Error de red al enviar: ${err.message}`, 'error');
    } finally {
      setResendingId(null);
    }
  };

  const triggerSimulatedScan = () => {
    const randomBarcode =
      DEMO_BARCODES[Math.floor(Math.random() * DEMO_BARCODES.length)];
    handleProcessBarcode(randomBarcode);
  };

  return (
    <div className="min-h-screen text-[#0f172a] flex flex-col pb-24">
      {/* NOTIFICACIÓN TOAST */}
      {toast && (
        <div className="fixed top-3 left-1/2 -translate-x-1/2 z-50 w-[92%] max-w-md pointer-events-none">
          <div
            className={`px-4 py-3 rounded-xl shadow-xl border flex items-center gap-3 text-sm font-semibold backdrop-blur-md ${
              toast.type === 'error'
                ? 'bg-[#fee2e2] border-[#fecaca] text-[#991b1b]'
                : toast.type === 'info'
                ? 'bg-[#e0f2fe] border-[#bae6fd] text-[#075985]'
                : 'bg-[#dcfce7] border-[#bbf7d0] text-[#166534]'
            }`}
          >
            <CheckCircle2 className="w-5 h-5 shrink-0" />
            <span>{toast.message}</span>
          </div>
        </div>
      )}

      {/* CABECERA CORPORATIVA R&R IMPORTADORA */}
      <header className="bg-white/95 border-b-2 border-slate-200/80 sticky top-0 z-30 backdrop-blur-md shadow-sm">
        <div className="max-w-2xl mx-auto px-3 py-2.5 flex items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <img
              src="/RYR.jpg"
              alt="Importadora R&R"
              className="h-12 w-auto object-contain rounded-lg border border-slate-200 bg-white p-0.5 shadow-sm"
            />
            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-extrabold text-base tracking-tight text-[#0f172a]">
                  Captura de Inventario
                </h1>
                <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-[#c01323]/10 text-[#c01323] border border-[#c01323]/25">
                  iMin Lark 1
                </span>
              </div>
              <p className="text-xs text-[#64748b] leading-tight">
                Sistema de Bodega · SAP Business One
              </p>
            </div>
          </div>

          {/* Controles rápidos de estado */}
          <div className="flex items-center gap-1.5">
            {/* Estado Online / Neon */}
            <div
              title={
                isOnline
                  ? serverStatus.neonConfigured
                    ? 'Conectado a Neon DB'
                    : 'Online (Modo Local + API)'
                  : 'Modo Offline en Bodega'
              }
              className={`px-2 py-1.5 rounded-lg border text-xs font-semibold flex items-center gap-1 ${
                isOnline
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                  : 'bg-amber-50 border-amber-300 text-amber-800'
              }`}
            >
              {isOnline ? (
                <Cloud className="w-3.5 h-3.5" />
              ) : (
                <CloudOff className="w-3.5 h-3.5" />
              )}
              <span className="hidden sm:inline">
                {isOnline ? 'Online' : 'Offline'}
              </span>
            </div>

            {/* Botón Sonido Beep */}
            <button
              type="button"
              onClick={() =>
                setSettings((s) => ({ ...s, soundEnabled: !s.soundEnabled }))
              }
              className={`p-2 rounded-lg border transition ${
                settings.soundEnabled
                  ? 'bg-[#c01323]/10 border-[#c01323]/30 text-[#c01323]'
                  : 'bg-slate-100 border-slate-200 text-slate-400'
              }`}
              title="Activar/Desactivar Beep de escaneo"
            >
              {settings.soundEnabled ? (
                <Volume2 className="w-4 h-4" />
              ) : (
                <VolumeX className="w-4 h-4" />
              )}
            </button>

            {/* Botón Teclado Virtual en pantalla */}
            <button
              type="button"
              onClick={() => {
                setSettings((s) => ({
                  ...s,
                  allowVirtualKeyboard: !s.allowVirtualKeyboard,
                }));
                setTimeout(focusScannerInput, 50);
              }}
              className={`px-2.5 py-1.5 rounded-lg border text-xs font-semibold flex items-center gap-1 transition ${
                settings.allowVirtualKeyboard
                  ? 'bg-[#c01323] border-[#c01323] text-white shadow-sm'
                  : 'bg-slate-100 border-slate-200 text-[#0f172a]'
              }`}
              title="Mostrar u ocultar el teclado virtual de Android al pistolear"
            >
              <Keyboard className="w-4 h-4" />
              <span className="text-[11px]">
                {settings.allowVirtualKeyboard ? 'Teclado ON' : 'Solo Láser'}
              </span>
            </button>
          </div>
        </div>

        {/* PESTAÑAS PRINCIPALES: PISTOLEAR TOMA ACTUAL vs HISTORIAL DE TOMAS */}
        <div className="max-w-2xl mx-auto px-3 pb-2.5 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setActiveTab('scanner')}
            className={`py-2.5 px-3 rounded-lg font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition ${
              activeTab === 'scanner'
                ? 'bg-[#c01323] text-white shadow-md shadow-[#c01323]/25'
                : 'bg-slate-100 text-[#0f172a] border border-slate-200 hover:bg-slate-200/70'
            }`}
          >
            <Barcode className="w-4 h-4" />
            <span>Toma Actual ({totals.totalSkus})</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTab('history');
              fetchCloudInventories();
            }}
            className={`py-2.5 px-3 rounded-lg font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition ${
              activeTab === 'history'
                ? 'bg-[#c01323] text-white shadow-md shadow-[#c01323]/25'
                : 'bg-slate-100 text-[#0f172a] border border-slate-200 hover:bg-slate-200/70'
            }`}
          >
            <History className="w-4 h-4" />
            <span>Historial Tomas ({mergedHistory.length})</span>
          </button>
        </div>
      </header>

      {/* =====================================================================
          VISTA 1: PISTOLEO DE TOMA DE INVENTARIO
      ===================================================================== */}
      {activeTab === 'scanner' && (
        <main className="max-w-2xl w-full mx-auto px-3 pt-3 space-y-3 flex-1">
          {/* RESUMEN DE LA TOMA ACTUAL Y CONTADORES GRANDES */}
          <div className="ryr-panel rounded-2xl p-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 mb-2.5 border-b border-slate-200">
              <div className="flex items-center gap-2 flex-1 min-w-[180px]">
                <Warehouse className="w-4 h-4 text-[#c01323] shrink-0" />
                <input
                  type="text"
                  value={session.name}
                  onChange={(e) =>
                    setSession((prev) => ({ ...prev, name: e.target.value }))
                  }
                  placeholder="Nombre Bodega / Ubicación..."
                  className="bg-white border border-slate-300 focus:border-[#c01323] focus:ring-2 focus:ring-[#c01323]/15 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-[#0f172a] w-full outline-none"
                />
              </div>

              <div className="flex items-center gap-2">
                <span className="text-[11px] font-mono font-bold bg-[#c01323]/10 text-[#c01323] px-2.5 py-1 rounded-md border border-[#c01323]/20">
                  {session.folio}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    if (session.items.length === 0) {
                      startNewInventorySession(false);
                    } else if (
                      window.confirm(
                        '¿Iniciar una toma nueva desde cero? (Se guardará una copia de la toma actual en el Historial).'
                      )
                    ) {
                      startNewInventorySession(true);
                    }
                  }}
                  className="text-xs px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-[#0f172a] border border-slate-300 font-semibold flex items-center gap-1 transition"
                  title="Guardar actual e iniciar nueva toma"
                >
                  <FolderPlus className="w-3.5 h-3.5 text-[#c01323]" />
                  <span>Nueva Toma</span>
                </button>
              </div>
            </div>

            {/* Tarjetas de Métricas: SKUs Únicos vs Total Unidades */}
            <div className="grid grid-cols-2 gap-2.5">
              <div className="bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 flex items-center justify-between">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[#64748b] block">
                    Códigos Únicos (SKUs)
                  </span>
                  <span className="text-2xl font-black text-[#0f172a]">
                    {totals.totalSkus}
                  </span>
                </div>
                <Hash className="w-7 h-7 text-slate-300" />
              </div>

              <div className="bg-[#c01323]/[0.06] border border-[#c01323]/25 rounded-xl px-3.5 py-2.5 flex items-center justify-between">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[#c01323] block">
                    Total Unidades
                  </span>
                  <span className="text-2xl font-black text-[#c01323]">
                    {totals.totalUnits}
                  </span>
                </div>
                <Layers className="w-7 h-7 text-[#c01323]/40" />
              </div>
            </div>
          </div>

          {/* MODO DE CAPTURA Y MULTIPLICADOR PARA EL IMIN LARK 1 */}
          <div className="ryr-panel rounded-2xl p-3.5 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="inline-flex rounded-xl bg-slate-100 p-1 border border-slate-200">
                <button
                  type="button"
                  onClick={() => {
                    setSettings((s) => ({ ...s, scanMode: 'burst' }));
                    setTimeout(focusScannerInput, 30);
                  }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                    settings.scanMode === 'burst'
                      ? 'bg-[#c01323] text-white shadow-sm'
                      : 'text-[#64748b] hover:text-[#0f172a]'
                  }`}
                >
                  ⚡ Ráfaga (+{settings.defaultMultiplier || 1} auto)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSettings((s) => ({ ...s, scanMode: 'prompt' }));
                    setTimeout(focusScannerInput, 30);
                  }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                    settings.scanMode === 'prompt'
                      ? 'bg-[#c01323] text-white shadow-sm'
                      : 'text-[#64748b] hover:text-[#0f172a]'
                  }`}
                >
                  🔢 Pedir Cantidad
                </button>
              </div>

              {/* Multiplicadores rápidos para cajas cerradas */}
              <div className="flex items-center gap-1">
                <span className="text-[11px] font-semibold text-[#64748b] mr-1">
                  Suma:
                </span>
                {[1, 6, 12, 24].map((mult) => (
                  <button
                    key={mult}
                    type="button"
                    onClick={() => {
                      setSettings((s) => ({ ...s, defaultMultiplier: mult }));
                      setTimeout(focusScannerInput, 30);
                    }}
                    className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition ${
                      (settings.defaultMultiplier || 1) === mult
                        ? 'bg-[#c01323]/10 border-[#c01323] text-[#c01323]'
                        : 'bg-white border-slate-200 text-[#64748b] hover:border-slate-300'
                    }`}
                  >
                    +{mult}
                  </button>
                ))}
              </div>
            </div>

            {/* CAMPO PRINCIPAL DE ESCANEO LÁSER IMIN LARK 1 */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleProcessBarcode(barcodeInput);
              }}
              className="relative"
            >
              <div className="relative flex items-center">
                <Barcode className="w-5 h-5 text-[#c01323] absolute left-3.5 pointer-events-none" />
                <input
                  ref={scannerInputRef}
                  type="text"
                  inputMode={settings.allowVirtualKeyboard ? 'text' : 'none'}
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  value={barcodeInput}
                  onChange={(e) => setBarcodeInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === 'Tab') {
                      e.preventDefault();
                      handleProcessBarcode(barcodeInput);
                    }
                  }}
                  placeholder="Escanea o pistolea el código de barra..."
                  className="w-full pl-11 pr-28 py-3.5 rounded-xl bg-white border-2 border-[#c01323] focus:ring-4 focus:ring-[#c01323]/15 text-[#0f172a] font-mono font-bold text-base placeholder:text-[#64748b] placeholder:font-sans placeholder:font-normal outline-none shadow-sm"
                />
                {barcodeInput ? (
                  <button
                    type="submit"
                    className="absolute right-2 px-3 py-2 rounded-lg bg-[#c01323] hover:bg-[#990f1c] text-white font-bold text-xs transition"
                  >
                    Agregar
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={triggerSimulatedScan}
                    className="absolute right-2 px-2.5 py-1.5 rounded-lg bg-[#e06666] hover:bg-[#c01323] text-white font-bold text-[11px] flex items-center gap-1 transition shadow-sm"
                    title="Simular disparo del lector láser para probar"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Simular</span>
                  </button>
                )}
              </div>
            </form>
          </div>

          {/* FEEDBACK DEL ÚLTIMO PRODUCTO PISTOLEADO */}
          {lastScanned && (
            <div
              key={flashKey}
              className="scan-flash bg-[#c01323]/[0.06] border-2 border-[#c01323] rounded-2xl p-3.5 flex items-center justify-between gap-3 shadow-sm"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded bg-[#c01323] text-white">
                    Última Lectura
                  </span>
                  <span className="text-xs text-[#c01323] font-bold">
                    {lastScanned.mode === 'set'
                      ? `Fijado en ${lastScanned.total}`
                      : `+${lastScanned.added} unid.`}
                  </span>
                </div>
                <p className="font-mono font-black text-lg text-[#0f172a] truncate mt-1">
                  {lastScanned.barcode}
                </p>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <div className="text-right mr-1">
                  <span className="text-[10px] uppercase font-bold text-[#64748b] block">
                    Acumulado
                  </span>
                  <span className="text-2xl font-black text-[#c01323]">
                    {session.items.find((i) => i.barcode === lastScanned.barcode)
                      ?.quantity ?? lastScanned.total}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const currentItem = session.items.find(
                      (i) => i.barcode === lastScanned.barcode
                    );
                    const currentQty = currentItem ? currentItem.quantity : 1;
                    setQtyModal({
                      open: true,
                      barcode: lastScanned.barcode,
                      mode: 'set',
                      currentTotal: currentQty,
                      inputValue: String(currentQty),
                    });
                    setTimeout(() => {
                      qtyModalInputRef.current?.focus();
                      qtyModalInputRef.current?.select();
                    }, 60);
                  }}
                  className="px-3 py-2 rounded-xl bg-white hover:bg-slate-50 border border-[#c01323]/40 text-xs font-bold text-[#c01323] shadow-sm transition"
                >
                  Editar Cant.
                </button>
              </div>
            </div>
          )}

          {/* TABLA / LISTA DE ÍTEMS ESCANEADOS (CONSOLIDADA PARA SAP BUSINESS ONE) */}
          <div className="ryr-panel rounded-2xl overflow-hidden">
            <div className="p-3 border-b border-slate-200 flex items-center justify-between gap-2 bg-white">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="w-4 h-4 text-[#c01323]" />
                <h2 className="text-xs font-extrabold uppercase tracking-wider text-[#0f172a]">
                  Vista Previa Excel SAP ({session.items.length})
                </h2>
              </div>

              {session.items.length > 0 && (
                <div className="relative w-44 sm:w-56">
                  <Search className="w-3.5 h-3.5 text-[#64748b] absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Buscar código..."
                    className="w-full pl-8 pr-6 py-1 rounded-lg bg-slate-50 border border-slate-300 text-xs text-[#0f172a] placeholder:text-[#64748b] outline-none focus:border-[#c01323]"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery('')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Encabezado de columnas SAP Business One */}
            <div className="grid grid-cols-12 px-3.5 py-2 bg-slate-100 border-b border-slate-200 text-[11px] font-bold uppercase tracking-wider text-[#64748b]">
              <div className="col-span-6">CodigoBarra</div>
              <div className="col-span-6 text-right pr-2">Cantidad</div>
            </div>

            {filteredItems.length === 0 ? (
              <div className="py-12 px-4 text-center space-y-2 bg-white">
                <Barcode className="w-10 h-10 text-slate-300 mx-auto" />
                <p className="text-sm font-bold text-[#0f172a]">
                  {session.items.length === 0
                    ? 'Aún no hay productos escaneados en esta toma'
                    : 'No se encontraron códigos que coincidan con la búsqueda'}
                </p>
                {session.items.length === 0 && (
                  <p className="text-xs text-[#64748b] max-w-xs mx-auto">
                    Presiona el gatillo lateral del <strong>iMin Lark 1</strong> o usa el botón{' '}
                    <button
                      type="button"
                      onClick={triggerSimulatedScan}
                      className="text-[#c01323] underline font-bold"
                    >
                      Simular
                    </button>{' '}
                    para registrar códigos de barra.
                  </p>
                )}
              </div>
            ) : (
              <div className="divide-y divide-slate-200 max-h-[420px] overflow-y-auto bg-white">
                {filteredItems.map((item, idx) => (
                  <div
                    key={item.barcode}
                    className={`px-3.5 py-2.5 flex items-center justify-between gap-2 transition ${
                      idx === 0 && !searchQuery
                        ? 'bg-[#c01323]/[0.05] border-l-4 border-l-[#c01323]'
                        : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <span className="font-mono font-bold text-sm sm:text-base text-[#c01323] bg-[#c01323]/[0.08] px-2 py-0.5 rounded inline-block truncate max-w-full">
                        {item.barcode}
                      </span>
                      <p className="text-[11px] text-[#64748b] mt-0.5">
                        Últ. lectura:{' '}
                        {new Date(item.lastScannedAt).toLocaleTimeString('es-CL', {
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                        })}
                      </p>
                    </div>

                    {/* Controles rápidos de cantidad */}
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => adjustItemQuantity(item.barcode, -1)}
                        className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 active:scale-95 flex items-center justify-center text-[#0f172a] border border-slate-300"
                        title="Restar 1"
                      >
                        <Minus className="w-4 h-4" />
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setQtyModal({
                            open: true,
                            barcode: item.barcode,
                            mode: 'set',
                            currentTotal: item.quantity,
                            inputValue: String(item.quantity),
                          });
                          setTimeout(() => {
                            qtyModalInputRef.current?.focus();
                            qtyModalInputRef.current?.select();
                          }, 60);
                        }}
                        className="min-w-[54px] h-8 px-2 rounded-lg bg-white border-2 border-[#c01323]/40 hover:border-[#c01323] font-mono font-black text-base text-[#0f172a] flex items-center justify-center shadow-sm"
                        title="Tocar para escribir cantidad exacta"
                      >
                        {item.quantity}
                      </button>

                      <button
                        type="button"
                        onClick={() => adjustItemQuantity(item.barcode, 1)}
                        className="w-8 h-8 rounded-lg bg-[#c01323] hover:bg-[#990f1c] active:scale-95 flex items-center justify-center text-white shadow-sm"
                        title="Sumar 1"
                      >
                        <Plus className="w-4 h-4" />
                      </button>

                      <button
                        type="button"
                        onClick={() => removeItem(item.barcode)}
                        className="w-8 h-8 rounded-lg bg-rose-50 hover:bg-rose-100 text-[#c01323] border border-rose-200 flex items-center justify-center ml-1"
                        title="Eliminar código de la toma"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </main>
      )}

      {/* =====================================================================
          VISTA 2: HISTORIAL DE TOMAS (LOCAL + NEON POSTGRESQL)
      ===================================================================== */}
      {activeTab === 'history' && (
        <main className="max-w-2xl w-full mx-auto px-3 pt-3 space-y-3 flex-1">
          <div className="ryr-panel rounded-2xl p-3.5 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-extrabold text-[#0f172a] flex items-center gap-2">
                <History className="w-4 h-4 text-[#c01323]" />
                <span>Tomas de Inventario Guardadas</span>
              </h2>
              <p className="text-xs text-[#64748b] mt-0.5">
                Respaldo híbrido: Memoria interna del iMin Lark 1 + Base de datos Neon
              </p>
            </div>

            <button
              type="button"
              onClick={fetchCloudInventories}
              disabled={serverStatus.loading}
              className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-xs font-bold text-[#0f172a] flex items-center gap-1.5 border border-slate-300"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${
                  serverStatus.loading ? 'animate-spin text-[#c01323]' : 'text-[#c01323]'
                }`}
              />
              <span>Actualizar Neon</span>
            </button>
          </div>

          {mergedHistory.length === 0 ? (
            <div className="ryr-panel rounded-2xl py-14 px-4 text-center space-y-2">
              <History className="w-10 h-10 text-slate-300 mx-auto" />
              <p className="text-sm font-bold text-[#0f172a]">
                Aún no hay tomas cerradas en el historial
              </p>
              <p className="text-xs text-[#64748b] max-w-sm mx-auto">
                Cuando finalices y envíes una toma de inventario, quedará almacenada aquí para descargar o reenviar su Excel a SAP Business One.
              </p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {mergedHistory.map((hist) => (
                <div
                  key={hist.id}
                  className="ryr-panel rounded-2xl p-3.5 space-y-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-[#c01323]/10 text-[#c01323] border border-[#c01323]/20">
                          {hist.folio}
                        </span>
                        <h3 className="font-bold text-sm text-[#0f172a]">
                          {hist.name || 'Bodega R&R'}
                        </h3>
                      </div>
                      <p className="text-xs text-[#64748b] mt-1">
                        {new Date(hist.closedAt || hist.createdAt).toLocaleString(
                          'es-CL'
                        )}
                        {hist.recipientEmail ? ` · Destino: ${hist.recipientEmail}` : ''}
                      </p>
                    </div>

                    <div className="text-right shrink-0">
                      <span className="text-xs font-semibold text-[#64748b] block">
                        {hist.totalSkus || hist.items?.length || 0} SKUs
                      </span>
                      <span className="text-base font-black text-[#c01323]">
                        {hist.totalUnits ?? 0} unid.
                      </span>
                    </div>
                  </div>

                  {/* Badges de Estado (Correo + Neon + Local) */}
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span
                        className={`text-[11px] font-semibold px-2 py-0.5 rounded-md border ${
                          hist.emailSent
                            ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                            : 'bg-amber-50 border-amber-200 text-amber-800'
                        }`}
                      >
                        {hist.emailSent ? '✓ Correo Enviado' : 'Correo Pendiente'}
                      </span>

                      <span
                        className={`text-[11px] font-semibold px-2 py-0.5 rounded-md border ${
                          hist.savedToNeon
                            ? 'bg-sky-50 border-sky-200 text-sky-700'
                            : 'bg-slate-100 border-slate-200 text-[#64748b]'
                        }`}
                      >
                        {hist.savedToNeon ? '☁️ Respaldado en Neon' : '📱 Memoria Local'}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedHistoryItem(hist);
                          setResendEmailInput(
                            hist.recipientEmail || settings.recipientEmail || ''
                          );
                        }}
                        className="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-xs font-semibold text-[#0f172a] flex items-center gap-1 border border-slate-300"
                      >
                        <Eye className="w-3.5 h-3.5 text-[#c01323]" />
                        <span>Detalle / Reenviar</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          const file = downloadSapExcel(hist);
                          showToast(`Excel ${file} descargado`, 'success');
                        }}
                        className="px-2.5 py-1.5 rounded-lg bg-[#c01323] hover:bg-[#990f1c] text-xs font-bold text-white flex items-center gap-1 shadow-sm"
                        title="Descargar Excel para SAP Business One"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Excel SAP</span>
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </main>
      )}

      {/* =====================================================================
          BARRA INFERIOR FIJA EN EL IMIN LARK 1 PARA CERRAR Y ENVIAR TOMA
      ===================================================================== */}
      {activeTab === 'scanner' && (
        <div className="fixed bottom-0 left-0 right-0 z-30 bg-white/95 border-t border-slate-200 backdrop-blur-md px-3 py-2.5 shadow-lg">
          <div className="max-w-2xl mx-auto flex items-center justify-between gap-2">
            <button
              type="button"
              disabled={session.items.length === 0}
              onClick={() => {
                const fileName = downloadSapExcel(session);
                showToast(`Archivo ${fileName} descargado`, 'success');
              }}
              className="px-3.5 py-3 rounded-xl bg-slate-100 hover:bg-slate-200 disabled:opacity-40 text-[#0f172a] font-bold text-xs flex items-center gap-1.5 border border-slate-300 shrink-0 transition"
            >
              <Download className="w-4 h-4 text-[#c01323]" />
              <span>Descargar Excel</span>
            </button>

            <button
              type="button"
              disabled={session.items.length === 0}
              onClick={() => {
                setSendingState({
                  loading: false,
                  completed: false,
                  result: null,
                  error: null,
                });
                setFinishModalOpen(true);
              }}
              className="flex-1 py-3 px-4 rounded-xl bg-[#c01323] hover:bg-[#990f1c] disabled:opacity-40 text-white font-extrabold text-sm flex items-center justify-center gap-2 shadow-md shadow-[#c01323]/25 transition"
            >
              <Send className="w-4 h-4" />
              <span>Finalizar y Enviar al Correo ({totals.totalUnits})</span>
            </button>
          </div>
        </div>
      )}

      {/* =====================================================================
          MODAL 1: INGRESAR O EDITAR CANTIDAD (CAJAS / BULTO)
      ===================================================================== */}
      {qtyModal.open && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl max-w-sm w-full p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <span className="text-xs font-extrabold uppercase tracking-wider text-[#c01323]">
                {qtyModal.mode === 'set'
                  ? 'Modificar Cantidad Total'
                  : 'Ingresar Cantidad Escaneada'}
              </span>
              <button
                type="button"
                onClick={() => setQtyModal((m) => ({ ...m, open: false }))}
                className="text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
              <span className="text-[11px] font-semibold text-[#64748b] block">
                Código de Barra
              </span>
              <p className="font-mono font-black text-lg text-[#0f172a]">
                {qtyModal.barcode}
              </p>
              {qtyModal.currentTotal > 0 && qtyModal.mode === 'add' && (
                <p className="text-xs font-bold text-[#c01323] mt-0.5">
                  Cantidad actual acumulada: {qtyModal.currentTotal}
                </p>
              )}
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                const val = Number(qtyModal.inputValue);
                if (!Number.isNaN(val) && val > 0) {
                  commitBarcodeQuantity(qtyModal.barcode, val, qtyModal.mode);
                  setQtyModal((m) => ({ ...m, open: false }));
                }
              }}
              className="space-y-3"
            >
              <div>
                <label className="text-xs font-bold text-[#0f172a] block mb-1">
                  {qtyModal.mode === 'set'
                    ? 'Nueva Cantidad Total:'
                    : 'Cantidad a sumar:'}
                </label>
                <input
                  ref={qtyModalInputRef}
                  type="number"
                  step="any"
                  min="1"
                  inputMode="numeric"
                  value={qtyModal.inputValue}
                  onChange={(e) =>
                    setQtyModal((m) => ({ ...m, inputValue: e.target.value }))
                  }
                  className="w-full px-4 py-3 rounded-xl bg-white border-2 border-[#c01323] text-2xl font-mono font-black text-center text-[#0f172a] outline-none"
                />
              </div>

              {/* Botones rápidos de cajas comunes en importadora */}
              <div className="grid grid-cols-4 gap-2">
                {[6, 12, 24, 48].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() =>
                      setQtyModal((m) => ({ ...m, inputValue: String(preset) }))
                    }
                    className="py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-xs font-bold text-[#0f172a] border border-slate-300"
                  >
                    {preset} un.
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setQtyModal((m) => ({ ...m, open: false }))}
                  className="py-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-[#0f172a] font-bold text-xs border border-slate-300"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="py-3 rounded-xl bg-[#c01323] hover:bg-[#990f1c] text-white font-extrabold text-xs shadow-sm"
                >
                  Confirmar Cantidad
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =====================================================================
          MODAL 2: FINALIZAR TOMA, ENVIAR EXCEL POR CORREO Y GUARDAR EN NEON
      ===================================================================== */}
      {finishModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white border border-slate-200 rounded-2xl max-w-md w-full p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div className="flex items-center gap-2.5">
                <img
                  src="/RYR.jpg"
                  alt="R&R"
                  className="h-9 w-auto object-contain rounded border border-slate-200"
                />
                <div>
                  <h3 className="font-extrabold text-base text-[#0f172a]">
                    Finalizar Toma de Inventario
                  </h3>
                  <p className="text-xs text-[#64748b]">
                    Folio {session.folio} · Formato SAP Business One (.xlsx)
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setFinishModalOpen(false)}
                className="text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Resumen previo al envío */}
            <div className="grid grid-cols-2 gap-2.5 bg-slate-50 p-3 rounded-xl border border-slate-200">
              <div>
                <span className="text-[10px] uppercase text-[#64748b] font-bold block">
                  Códigos Consolidados
                </span>
                <span className="text-xl font-black text-[#0f172a]">
                  {totals.totalSkus} SKUs
                </span>
              </div>
              <div>
                <span className="text-[10px] uppercase text-[#c01323] font-bold block">
                  Total Unidades
                </span>
                <span className="text-xl font-black text-[#c01323]">
                  {totals.totalUnits}
                </span>
              </div>
            </div>

            {!sendingState.completed ? (
              <form onSubmit={handleSendAndSaveInventory} className="space-y-3.5">
                <div>
                  <label className="text-xs font-bold text-[#0f172a] flex items-center gap-1.5 mb-1">
                    <Mail className="w-3.5 h-3.5 text-[#c01323]" />
                    <span>Correo Electrónico Destino (recibirá el Excel):</span>
                  </label>
                  <input
                    type="email"
                    required
                    inputMode="email"
                    value={settings.recipientEmail}
                    onChange={(e) =>
                      setSettings((s) => ({ ...s, recipientEmail: e.target.value }))
                    }
                    placeholder="ejemplo@ryrimportadora.cl"
                    className="w-full px-3.5 py-3 rounded-xl bg-white border border-slate-300 focus:border-[#c01323] focus:ring-2 focus:ring-[#c01323]/15 text-sm text-[#0f172a] outline-none"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs font-semibold text-[#64748b] flex items-center gap-1 mb-1">
                      <Warehouse className="w-3.5 h-3.5" />
                      <span>Bodega / Toma:</span>
                    </label>
                    <input
                      type="text"
                      value={session.name}
                      onChange={(e) =>
                        setSession((prev) => ({ ...prev, name: e.target.value }))
                      }
                      className="w-full px-3 py-2 rounded-xl bg-white border border-slate-300 text-xs text-[#0f172a] outline-none focus:border-[#c01323]"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-[#64748b] flex items-center gap-1 mb-1">
                      <User className="w-3.5 h-3.5" />
                      <span>Operario (opcional):</span>
                    </label>
                    <input
                      type="text"
                      value={session.operatorName}
                      onChange={(e) => {
                        const val = e.target.value;
                        setSession((prev) => ({ ...prev, operatorName: val }));
                        setSettings((s) => ({ ...s, operatorName: val }));
                      }}
                      placeholder="Nombre operario"
                      className="w-full px-3 py-2 rounded-xl bg-white border border-slate-300 text-xs text-[#0f172a] outline-none focus:border-[#c01323]"
                    />
                  </div>
                </div>

                {sendingState.error && (
                  <div className="p-3 rounded-xl bg-[#fee2e2] border border-[#fecaca] text-xs text-[#991b1b] flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{sendingState.error}</span>
                  </div>
                )}

                <div className="pt-2 space-y-2">
                  <button
                    type="submit"
                    disabled={sendingState.loading}
                    className="w-full py-3.5 rounded-xl bg-[#c01323] hover:bg-[#990f1c] disabled:opacity-50 text-white font-extrabold text-sm flex items-center justify-center gap-2 shadow-md shadow-[#c01323]/25"
                  >
                    {sendingState.loading ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        <span>Generando Excel y Enviando...</span>
                      </>
                    ) : (
                      <>
                        <Send className="w-4 h-4" />
                        <span>Enviar Excel al Correo y Guardar Toma</span>
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      const file = downloadSapExcel(session);
                      showToast(`Archivo ${file} descargado en el dispositivo`, 'success');
                    }}
                    className="w-full py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-[#0f172a] font-semibold text-xs flex items-center justify-center gap-1.5 border border-slate-300"
                  >
                    <Download className="w-4 h-4 text-[#c01323]" />
                    <span>Descargar también copia del Excel en el dispositivo</span>
                  </button>
                </div>
              </form>
            ) : (
              /* PANTALLA POST-ENVÍO: CONFIRMACIÓN + INICIAR NUEVA TOMA */
              <div className="space-y-4">
                <div className="p-3.5 rounded-xl bg-[#dcfce7] border border-[#bbf7d0] space-y-2">
                  <div className="flex items-center gap-2 text-[#166534] font-bold text-sm">
                    <CheckCircle2 className="w-5 h-5 shrink-0" />
                    <span>Toma de Inventario Guardada en Historial</span>
                  </div>

                  <ul className="text-xs text-[#166534] space-y-1 pl-7 list-disc">
                    <li>
                      Guardada en el historial local del <strong>iMin Lark 1</strong>.
                    </li>
                    <li>
                      Respaldo en <strong>Neon PostgreSQL</strong>:{' '}
                      {sendingState.result?.savedToNeon
                        ? '✅ Sincronizado correctamente'
                        : '⏳ Pendiente de configurar DATABASE_URL en Vercel'}
                    </li>
                    <li>
                      Envío por correo a <strong>{settings.recipientEmail}</strong>:{' '}
                      {sendingState.result?.emailSent
                        ? '✅ Excel enviado con éxito'
                        : '⚠️ Descarga el Excel abajo o configura SMTP_USER / SMTP_PASS'}
                    </li>
                  </ul>
                </div>

                {sendingState.error && (
                  <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900">
                    {sendingState.error}
                  </div>
                )}

                <div className="space-y-2 pt-1">
                  <button
                    type="button"
                    onClick={() => startNewInventorySession(false)}
                    className="w-full py-3.5 rounded-xl bg-[#c01323] hover:bg-[#990f1c] text-white font-extrabold text-sm flex items-center justify-center gap-2 shadow-md shadow-[#c01323]/25"
                  >
                    <FolderPlus className="w-5 h-5" />
                    <span>Iniciar Nueva Toma de Inventario (Limpiar)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      const file = downloadSapExcel(session);
                      showToast(`Excel ${file} descargado`, 'success');
                    }}
                    className="w-full py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-[#0f172a] font-bold text-xs flex items-center justify-center gap-1.5 border border-slate-300"
                  >
                    <Download className="w-4 h-4 text-[#c01323]" />
                    <span>Descargar Excel (.xlsx) para SAP Business One</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* =====================================================================
          MODAL 3: DETALLE Y REENVÍO DE UNA TOMA DEL HISTORIAL
      ===================================================================== */}
      {selectedHistoryItem && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white border border-slate-200 rounded-2xl max-w-lg w-full p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div>
                <span className="font-mono text-xs font-bold text-[#c01323]">
                  {selectedHistoryItem.folio}
                </span>
                <h3 className="font-extrabold text-base text-[#0f172a]">
                  {selectedHistoryItem.name || 'Toma de Inventario'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedHistoryItem(null)}
                className="text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Reenviar a correo */}
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2">
              <label className="text-xs font-bold text-[#0f172a] block">
                Enviar / Reenviar archivo Excel (.xlsx) a correo:
              </label>
              <div className="flex gap-2">
                <input
                  type="email"
                  value={resendEmailInput}
                  onChange={(e) => setResendEmailInput(e.target.value)}
                  placeholder="correo@ryrimportadora.cl"
                  className="flex-1 px-3 py-2 rounded-lg bg-white border border-slate-300 text-xs text-[#0f172a] outline-none focus:border-[#c01323]"
                />
                <button
                  type="button"
                  disabled={resendingId === selectedHistoryItem.id}
                  onClick={() =>
                    handleResendHistorySession(selectedHistoryItem, resendEmailInput)
                  }
                  className="px-3.5 py-2 rounded-lg bg-[#c01323] hover:bg-[#990f1c] disabled:opacity-50 text-white font-bold text-xs flex items-center gap-1.5 shrink-0"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>
                    {resendingId === selectedHistoryItem.id ? 'Enviando...' : 'Enviar'}
                  </span>
                </button>
              </div>
            </div>

            {/* Tabla de ítems de esa toma */}
            <div className="border border-slate-200 rounded-xl overflow-hidden">
              <div className="grid grid-cols-12 px-3 py-2 bg-slate-100 text-[11px] font-bold uppercase text-[#64748b] border-b border-slate-200">
                <div className="col-span-8">CodigoBarra</div>
                <div className="col-span-4 text-right">Cantidad</div>
              </div>
              <div className="max-h-60 overflow-y-auto divide-y divide-slate-200 bg-white">
                {(selectedHistoryItem.items || []).map((it) => (
                  <div
                    key={it.barcode}
                    className="grid grid-cols-12 px-3 py-2 text-xs items-center"
                  >
                    <div className="col-span-8 font-mono font-bold text-[#c01323]">
                      {it.barcode}
                    </div>
                    <div className="col-span-4 text-right font-mono font-black text-[#0f172a]">
                      {it.quantity}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  if (
                    window.confirm(
                      '¿Cargar esta toma como Toma Activa para seguir agregando productos?'
                    )
                  ) {
                    setSession({
                      id: selectedHistoryItem.id,
                      folio: selectedHistoryItem.folio,
                      name: selectedHistoryItem.name,
                      operatorName: selectedHistoryItem.operatorName || '',
                      items: selectedHistoryItem.items || [],
                      createdAt: selectedHistoryItem.createdAt,
                    });
                    setSelectedHistoryItem(null);
                    setActiveTab('scanner');
                    showToast('Toma reabierta para continuar escaneando', 'info');
                  }
                }}
                className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-xs font-semibold text-[#0f172a] flex items-center gap-1 border border-slate-300"
              >
                <ArrowUpRight className="w-4 h-4 text-[#c01323]" />
                <span>Reabrir Toma</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  const file = downloadSapExcel(selectedHistoryItem);
                  showToast(`Excel ${file} descargado`, 'success');
                }}
                className="px-4 py-2 rounded-xl bg-[#c01323] hover:bg-[#990f1c] text-xs font-bold text-white flex items-center gap-1.5 shadow-sm"
              >
                <Download className="w-4 h-4" />
                <span>Descargar Excel SAP (.xlsx)</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
