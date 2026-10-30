import { useEffect, useRef, useState, type DependencyList, type FormEvent, type ReactNode } from 'react';
import type { AppStatus } from '../lib/api';
import { Icon } from '../components/Icon';
import * as api from '../lib/pos';

function useRemote<T>(load: () => Promise<T>, deps: DependencyList) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true; setLoading(true); setError('');
    load().then((result) => { if (active) setData(result); }).catch((reason: unknown) => { if (active) setError(String(reason)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [...deps, revision]);
  return { data, error, loading, refresh: () => setRevision((r) => r + 1) };
}
function useAction() {
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  async function run<T>(action: () => Promise<T>, done?: (result: T) => void) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(''); setMessage('');
    try { const result = await action(); done?.(result); }
    catch (reason: unknown) { setError(String(reason)); }
    finally { lock.current = false; setBusy(false); }
  }
  return { busy, error, message, run, setMessage, setError };
}
function Notice({ error, message }: { error?: string; message?: string }) {
  return <>{error && <div className="notice error" role="alert">{error}</div>}{message && <div className="notice success" role="status">{message}</div>}</>;
}
function Modal({ title, children, onClose, busy = false }: { title: string; children: ReactNode; onClose: () => void; busy?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (!ref.current?.open) ref.current?.showModal(); }, []);
  return <dialog ref={ref} className="pos-dialog" aria-label={title} onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
    <div className="dialog-heading"><h2>{title}</h2><button type="button" className="secondary-button" disabled={busy} onClick={onClose}>Cerrar</button></div>{children}
  </dialog>;
}
function Pager({ offset, count, onChange }: { offset: number; count: number; onChange: (offset: number) => void }) {
  return <div className="pager"><button className="secondary-button" disabled={!offset} onClick={() => onChange(Math.max(0, offset - 100))}>Anterior</button><span>Página {offset / 100 + 1} · hasta 100 registros</span><button className="secondary-button" disabled={count < 100} onClick={() => onChange(offset + 100)}>Siguiente</button></div>;
}
function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="control-label">{label}{children}</label>; }
function SearchField({ value, disabled, onChange }: { value: string; disabled?: boolean; onChange: (value: string) => void }) {
  return <Field label="Buscar"><span className="search-input"><Icon name="search" /><input placeholder="Nombre o SKU" disabled={disabled} value={value} onChange={(e) => onChange(e.target.value)} /></span></Field>;
}
const LANGUAGES: Record<string, string> = { es: 'Español', en: 'Inglés', ja: 'Japonés', fr: 'Francés', de: 'Alemán', it: 'Italiano', pt: 'Portugués', ko: 'Coreano', zh: 'Chino' };
const FINISHES: Record<string, string> = { normal: 'Normal', foil: 'Foil', reverse: 'Reverse', etched: 'Etched', other: 'Otro' };
// Variante y datos de colección como texto; idioma, condición y acabado van en CardTags.
function productMeta(p: { sku?: string; variant: string; card: api.CardDetails | null }) {
  return [p.sku, p.variant, p.card && `${p.card.game} · ${p.card.expansion} #${p.card.number}`].filter(Boolean).join(' · ');
}
function CardTags({ card }: { card: api.CardDetails | null }) {
  if (!card) return null;
  return <span className="card-tags"><span className="tag">{card.condition}</span><span className="tag" title={LANGUAGES[card.language]}>{card.language.toUpperCase()}</span>{card.finish !== 'normal' && <span className="tag">{FINISHES[card.finish] ?? card.finish}</span>}</span>;
}
function useMoney(status: AppStatus) {
  const digits = status.currencies.find((c) => c.code === status.settings.currencyCode)?.minorUnits ?? 2;
  return { digits, format: (amount: number) => api.displayMoney(amount, status.settings.currencyCode, digits) };
}
interface Props { status: AppStatus; onChanged: () => void }
const emptyCard: api.CardDetails = { game: '', expansion: '', number: '', language: 'es', condition: 'NM', finish: 'normal' };
function ProductEditor({ product, categories, status, onSaved, onClose }: { product: api.Product | null; categories: api.Category[]; status: AppStatus; onSaved: () => void; onClose: () => void }) {
  const { digits } = useMoney(status);
  const [form, setForm] = useState<api.ProductInput>(product ? { id: product.id, sku: product.sku, name: product.name, categoryId: product.categoryId, variant: product.variant, card: product.card, active: product.active, price: api.decimal(product.price, digits), cost: api.decimal(product.cost, digits), initialStock: 0 } : { id: null, sku: '', name: '', categoryId: null, variant: '', card: null, price: '', cost: '0', initialStock: 0, active: true });
  const action = useAction();
  function field<K extends keyof api.ProductInput>(key: K, value: api.ProductInput[K]) { setForm((f) => ({ ...f, [key]: value })); }
  function cardField(key: keyof api.CardDetails, value: string) { setForm((f) => ({ ...f, card: { ...(f.card ?? emptyCard), [key]: value } })); }
  function submit(event: FormEvent) { event.preventDefault(); void action.run(() => api.saveProduct(form), onSaved); }
  return <Modal title={product ? 'Editar producto' : 'Nuevo producto'} onClose={onClose} busy={action.busy}>
    <form onSubmit={submit}><fieldset disabled={action.busy}><div className="form-grid">
      <Field label="SKU único"><input required maxLength={60} pattern="[A-Za-z0-9_.\-]+" value={form.sku} onChange={(e) => field('sku', e.target.value)} /></Field>
      <Field label="Nombre"><input required maxLength={160} value={form.name} onChange={(e) => field('name', e.target.value)} /></Field>
      <Field label="Categoría"><select value={form.categoryId ?? ''} onChange={(e) => field('categoryId', e.target.value ? Number(e.target.value) : null)}><option value="">Sin categoría</option>{categories.map((c) => <option value={c.id} key={c.id}>{c.name}</option>)}</select></Field>
      <Field label="Variante vendible"><input maxLength={120} placeholder="Talla, color, presentación…" value={form.variant} onChange={(e) => field('variant', e.target.value)} /></Field>
      <Field label={`Precio final (${status.settings.currencyCode})`}><input required inputMode="decimal" value={form.price} onChange={(e) => field('price', e.target.value)} /><small>Mayor que cero, hasta {digits} decimales</small></Field>
      <Field label="Costo de referencia"><input required inputMode="decimal" value={form.cost} onChange={(e) => field('cost', e.target.value)} /><small>Informativo, no calcula utilidad</small></Field>
      {!product && <Field label="Existencias iniciales"><input required type="number" min={0} max={1000000} step={1} value={form.initialStock} onChange={(e) => field('initialStock', Number(e.target.value))} /></Field>}
    </div>
    <label className="check-control"><input type="checkbox" checked={form.active} onChange={(e) => field('active', e.target.checked)} />Producto activo</label>
    <label className="check-control"><input type="checkbox" checked={!!form.card} onChange={(e) => field('card', e.target.checked ? { ...emptyCard } : null)} />Es una carta individual TCG</label>
    {form.card && <div className="form-grid card-fields">
      <Field label="Juego"><input required maxLength={80} value={form.card.game} onChange={(e) => cardField('game', e.target.value)} /></Field>
      <Field label="Expansión"><input required maxLength={100} value={form.card.expansion} onChange={(e) => cardField('expansion', e.target.value)} /></Field>
      <Field label="Número de colección"><input required maxLength={40} value={form.card.number} onChange={(e) => cardField('number', e.target.value)} /></Field>
      <Field label="Idioma"><select value={form.card.language} onChange={(e) => cardField('language', e.target.value)}>{Object.entries(LANGUAGES).map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></Field>
      <Field label="Condición"><select value={form.card.condition} onChange={(e) => cardField('condition', e.target.value)}>{['NM', 'LP', 'MP', 'HP', 'DMG'].map((v) => <option key={v}>{v}</option>)}</select></Field>
      <Field label="Acabado"><select value={form.card.finish} onChange={(e) => cardField('finish', e.target.value)}>{Object.entries(FINISHES).map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></Field>
    </div>}
    <p className="field-help">Cada variante tiene su propio SKU y existencias. {product ? 'Las existencias se modifican únicamente mediante movimientos en Inventario.' : 'Las existencias iniciales generarán un movimiento.'}</p>
    <Notice error={action.error} /><button className="primary-button" type="submit">{action.busy ? 'Guardando…' : 'Guardar producto'}</button>
    </fieldset></form>
  </Modal>;
}
export function Catalog({ status, onChanged }: Props) {
  const [search, setSearch] = useState(''); const [offset, setOffset] = useState(0); const [inactive, setInactive] = useState(false);
  const list = useRemote(() => api.getProducts(search, inactive, offset), [search, inactive, offset]);
  const categories = useRemote(api.getCategories, []); const { format } = useMoney(status);
  const [editing, setEditing] = useState<api.Product | null | undefined>(undefined);
  const [categoryId, setCategoryId] = useState(''); const [categoryName, setCategoryName] = useState(''); const action = useAction();
  return <>
    <section className="workspace-card"><div className="toolbar"><SearchField value={search} onChange={(value) => { setSearch(value); setOffset(0); }} /><button className="primary-button" onClick={() => setEditing(null)}>Nuevo producto</button></div>
      <label className="check-control"><input type="checkbox" checked={inactive} onChange={(e) => { setInactive(e.target.checked); setOffset(0); }} />Incluir desactivados</label>
      <Notice error={list.error || categories.error} />{list.loading && <p role="status">Cargando catálogo…</p>}
      <div className="table-scroll"><table><thead><tr><th>Producto</th><th>Categoría</th><th className="num">Precio final</th><th className="num">Existencias</th><th>Estado</th><th>Acción</th></tr></thead><tbody>{list.data?.map((p) => <tr key={p.id}><td><strong>{p.name}</strong><small>{productMeta(p)}</small><CardTags card={p.card} /></td><td>{p.category ?? 'Sin categoría'}</td><td className="num">{format(p.price)}</td><td className="num">{p.stock}</td><td><span className={`state${p.active ? '' : ' off'}`}>{p.active ? 'Activo' : 'Desactivado'}</span></td><td><button className="secondary-button" onClick={() => setEditing(p)}>Editar</button></td></tr>)}</tbody></table></div>
      {!list.loading && !list.data?.length && !list.error && <p>No hay productos para esta búsqueda. Crea el primero con su propio SKU.</p>}
      <Pager offset={offset} count={list.data?.length ?? 0} onChange={setOffset} />
    </section>
    <section className="workspace-card"><h2>Categorías del negocio</h2><p>Crea o renombra categorías para organizar cualquier giro.</p><form onSubmit={(e) => { e.preventDefault(); void action.run(() => api.saveCategory(categoryId ? Number(categoryId) : null, categoryName), () => { setCategoryId(''); setCategoryName(''); categories.refresh(); list.refresh(); action.setMessage('Categoría guardada'); }); }}><fieldset disabled={action.busy}><div className="toolbar"><Field label="Categoría"><select value={categoryId} onChange={(e) => { setCategoryId(e.target.value); setCategoryName(categories.data?.find((c) => c.id === Number(e.target.value))?.name ?? ''); }}><option value="">Crear nueva</option>{categories.data?.map((c) => <option value={c.id} key={c.id}>{c.name}</option>)}</select></Field><Field label="Nombre"><input required maxLength={80} value={categoryName} onChange={(e) => setCategoryName(e.target.value)} /></Field><button className="secondary-button" type="submit">Guardar categoría</button></div><Notice error={action.error} message={action.message} /></fieldset></form></section>
    {editing !== undefined && <ProductEditor product={editing} categories={categories.data ?? []} status={status} onClose={() => setEditing(undefined)} onSaved={() => { setEditing(undefined); list.refresh(); onChanged(); }} />}
  </>;
}
export function Inventory({ status, onChanged }: Props) {
  const [search, setSearch] = useState(''); const [offset, setOffset] = useState(0);
  const list = useRemote(() => api.getProducts(search, true, offset), [search, offset]);
  const [selected, setSelected] = useState<api.Product | null>(null);
  const [movementOffset, setMovementOffset] = useState(0);
  const ledger = useRemote(() => selected ? api.getMovements(selected.id, movementOffset) : Promise.resolve([]), [selected?.id, movementOffset]);
  const [kind, setKind] = useState('entry'); const [quantity, setQuantity] = useState('1'); const [reason, setReason] = useState(''); const action = useAction();
  function submit(e: FormEvent) { e.preventDefault(); if (!selected) return; void action.run(() => api.recordStock(selected.id, Number(quantity), kind, reason), () => { setReason(''); ledger.refresh(); list.refresh(); setSelected(null); onChanged(); action.setMessage('Movimiento registrado'); }); }
  return <>
    <section className="workspace-card"><div className="toolbar"><SearchField value={search} onChange={(value) => { setSearch(value); setOffset(0); }} /></div><Notice error={list.error} message={action.message} />{list.loading && <p role="status">Cargando existencias…</p>}
      <div className="table-scroll"><table><thead><tr><th>Producto</th><th>Estado</th><th className="num">Existencias</th><th>Acción</th></tr></thead><tbody>{list.data?.map((p) => <tr key={p.id}><td><strong>{p.name}</strong><small>{productMeta(p)}</small><CardTags card={p.card} /></td><td><span className={`state${p.active ? '' : ' off'}`}>{p.active ? 'Activo' : 'Desactivado'}</span></td><td className="num">{p.stock}</td><td><button className="secondary-button" onClick={() => { setSelected(p); setMovementOffset(0); action.setError(''); action.setMessage(''); }}>Movimientos</button></td></tr>)}</tbody></table></div>
      {!list.loading && !list.data?.length && !list.error && <p>Sin productos. Regístralos primero en Catálogo.</p>}<Pager offset={offset} count={list.data?.length ?? 0} onChange={setOffset} />
    </section>
    {selected && <Modal title={`Inventario · ${selected.name}`} onClose={() => setSelected(null)} busy={action.busy}>
      <p>SKU {selected.sku} · {selected.stock} unidades al abrir. Los ajustes suman o restan unidades.</p>
      <form onSubmit={submit}><fieldset disabled={action.busy}><div className="form-grid"><Field label="Tipo"><select value={kind} onChange={(e) => setKind(e.target.value)}><option value="entry">Entrada de mercancía</option><option value="adjustment">Ajuste manual</option></select></Field><Field label="Cantidad entera"><input type="number" step={1} min={kind === 'entry' ? 1 : -1000000} max={1000000} required value={quantity} onChange={(e) => setQuantity(e.target.value)} /></Field><Field label="Motivo obligatorio"><input required maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} /></Field></div><Notice error={action.error} /><button className="primary-button" type="submit">Registrar movimiento</button></fieldset></form>
      <h3>Historial de movimientos</h3><Notice error={ledger.error} />{ledger.loading && <p role="status">Cargando movimientos…</p>}<div className="table-scroll"><table><thead><tr><th>Fecha</th><th>Tipo</th><th className="num">Cantidad</th><th>Motivo / referencia</th></tr></thead><tbody>{ledger.data?.map((m) => <tr key={m.id}><td className="meta">{api.dateTime(m.createdAt, status.settings.timeZone)}</td><td>{api.movementName(m.kind)}</td><td className={`num ${m.quantity > 0 ? 'positive' : 'negative'}`}>{m.quantity > 0 ? '+' : ''}{m.quantity}</td><td>{m.reason}<small>{m.saleId ? `Venta V-${String(m.saleId).padStart(8, '0')}` : `Movimiento ${m.id}`}{m.cancellationId ? ` · Anulación ${m.cancellationId}` : ''}</small></td></tr>)}</tbody></table></div><Pager offset={movementOffset} count={ledger.data?.length ?? 0} onChange={setMovementOffset} />
    </Modal>}
  </>;
}

const ATTEMPT_KEY = 'tcg-pos.pending-checkout.v1';
interface CartEntry { product: api.Product; quantity: number }
interface SavedAttempt { input: api.Checkout; cart: CartEntry[] }
function storedAttempt(): SavedAttempt | null {
  const value = localStorage.getItem(ATTEMPT_KEY);
  if (!value) return null;
  try { const parsed = JSON.parse(value) as SavedAttempt; if (parsed.input?.requestId && Array.isArray(parsed.cart) && Array.isArray(parsed.input.lines)) return parsed; } catch { /* Se conserva el archivo original para diagnóstico. */ }
  throw new Error('No se pudo leer el intento de cobro pendiente. Conserva los datos del navegador y revisa el historial antes de continuar.');
}
function errorMessage(reason: unknown) { return typeof reason === 'object' && reason && 'message' in reason ? String(reason.message) : String(reason); }
function Receipt({ sale, status }: { sale: api.Sale; status: AppStatus }) {
  const digits = status.currencies.find((c) => c.code === sale.currencyCode)?.minorUnits ?? 2;
  const format = (amount: number) => api.displayMoney(amount, sale.currencyCode, digits);
  return <div className="receipt"><div className="receipt-title"><strong>{sale.storeName}</strong><span>{sale.folio}</span></div>
    <p className="receipt-meta"><span className={`tag ${sale.cancellation ? 'negative' : 'positive'}`}>{sale.cancellation ? 'Venta anulada' : 'Venta registrada'}</span>{api.dateTime(sale.createdAt, status.settings.timeZone)} · {api.paymentName(sale.method)} · impuestos incluidos</p>
    <div className="table-scroll"><table><thead><tr><th>Producto</th><th className="num">Cantidad</th><th className="num">Precio</th><th className="num">Subtotal</th></tr></thead><tbody>{sale.items.map((item) => <tr key={item.productId}><td>{item.name}<small>{productMeta(item)}</small><CardTags card={item.card} /></td><td className="num">{item.quantity}</td><td className="num">{format(item.price)}</td><td className="num">{format(item.price * item.quantity)}</td></tr>)}</tbody></table></div>
    <dl className="totals"><div className="grand"><dt>Total</dt><dd>{format(sale.total)}</dd></div>{sale.received !== null && <><div><dt>Recibido</dt><dd>{format(sale.received)}</dd></div><div><dt>Cambio</dt><dd>{format(sale.change ?? 0)}</dd></div></>}</dl>
    {sale.cancellation && <div className="notice"><div><strong>Anulación {sale.cancellation.id}</strong><br />{api.dateTime(sale.cancellation.createdAt, status.settings.timeZone)}<br />Motivo: {sale.cancellation.reason}<br />Devolución registrada: {format(sale.cancellation.refund)} · {api.paymentName(sale.cancellation.method)}<br />El operador confirmó la devolución del dinero y la disponibilidad de toda la mercancía.</div></div>}
    <p className="field-help">Comprobante informativo en pantalla, no es una factura fiscal</p>
  </div>;
}
export function Sales({ status, onChanged }: Props) {
  const [recoveryError] = useState(() => { try { storedAttempt(); return ''; } catch (e) { return errorMessage(e); } });
  const [pending, setPending] = useState<SavedAttempt | null>(() => { try { return storedAttempt(); } catch { return null; } });
  const [cart, setCart] = useState<CartEntry[]>(pending?.cart ?? []);
  const [search, setSearch] = useState(''); const [offset, setOffset] = useState(0);
  const list = useRemote(() => api.getProducts(search, false, offset), [search, offset]);
  const [method, setMethod] = useState(pending?.input.method ?? 'cash');
  const [received, setReceived] = useState(pending?.input.received ?? '');
  const [confirmed, setConfirmed] = useState(pending?.input.paymentConfirmed ?? false);
  const [receipt, setReceipt] = useState<api.Sale | null>(null); const action = useAction(); const { digits, format } = useMoney(status);
  const totalBig = cart.reduce((sum, entry) => sum + BigInt(entry.product.price) * BigInt(Number.isSafeInteger(entry.quantity) ? entry.quantity : 0), 0n);
  const validTotal = totalBig > 0n && totalBig <= 9_000_000_000_000n;
  const total = validTotal ? Number(totalBig) : 0;
  const cash = api.parseMoney(received, digits);
  const change = cash !== null && cash >= totalBig && validTotal ? Number(cash - totalBig) : null;
  function add(p: api.Product) {
    if (pending || action.busy || !p.stock) return;
    setCart((items) => { const found = items.find((entry) => entry.product.id === p.id); return found ? items.map((entry) => entry.product.id === p.id ? { ...entry, quantity: Math.min(entry.quantity + 1, p.stock, 1000000) } : entry) : [...items, { product: p, quantity: 1 }]; });
  }
  function submit(e: FormEvent) {
    e.preventDefault();
    void action.run(async () => {
      const attempt = pending ?? { input: { requestId: crypto.randomUUID(), currencyCode: status.settings.currencyCode, lines: cart.map((entry) => ({ productId: entry.product.id, quantity: entry.quantity, price: entry.product.price })), method, received: method === 'cash' ? received : '', paymentConfirmed: method !== 'cash' && confirmed }, cart };
      // Guardar antes de enviar: un reinicio conserva el mismo intento y su contenido.
      localStorage.setItem(ATTEMPT_KEY, JSON.stringify(attempt)); setPending(attempt);
      try { return await api.checkout(attempt.input); }
      catch (reason: unknown) {
        if (typeof reason === 'object' && reason && 'definite' in reason && reason.definite === true) {
          localStorage.removeItem(ATTEMPT_KEY); setPending(null);
        }
        throw new Error(errorMessage(reason));
      }
    }, (sale) => {
      localStorage.removeItem(ATTEMPT_KEY); setPending(null); setCart([]); setReceived(''); setConfirmed(false); setReceipt(sale); list.refresh(); onChanged();
    });
  }
  return <>
    <Notice error={recoveryError || action.error} />
    {pending && <div className="notice" role="status">Hay un cobro pendiente de respuesta. Reintenta con el mismo identificador para recuperar su resultado sin duplicar la venta. No vuelvas a cobrar al cliente. Referencia: {pending.input.requestId}</div>}
    <div className="sale-layout"><section className="workspace-card"><h2>Productos</h2><SearchField disabled={action.busy || !!pending || !!recoveryError} value={search} onChange={(value) => { setSearch(value); setOffset(0); }} /><Notice error={list.error} />{list.loading && <p role="status">Cargando productos…</p>}
      <div className="sale-products">{list.data?.map((p) => <button className="sale-product" disabled={!p.stock || !!pending || action.busy || !!recoveryError} key={p.id} onClick={() => add(p)}><span><strong>{p.name}</strong><small>{productMeta(p)}</small><CardTags card={p.card} /></span><span className="sale-price"><strong>{format(p.price)}</strong><small>{p.stock} disponibles</small></span></button>)}</div>
      {!list.loading && !list.data?.length && !list.error && <p>No hay productos activos para esta búsqueda.</p>}<Pager offset={offset} count={list.data?.length ?? 0} onChange={setOffset} />
    </section>
    <section className="workspace-card"><h2>Carrito</h2>{!cart.length && <p>Busca un producto y selecciónalo para agregarlo.</p>}
      <form onSubmit={submit}><fieldset disabled={action.busy || !!pending || !!recoveryError}>
        <div className="cart-items">{cart.map((entry) => <div className="cart-row" key={entry.product.id}><div><strong>{entry.product.name}</strong><small>{entry.product.sku} · {format(entry.product.price)} c/u</small><CardTags card={entry.product.card} /></div><Field label="Cantidad"><input type="number" min={1} max={1000000} step={1} required value={entry.quantity} onChange={(e) => setCart((items) => items.map((item) => item.product.id === entry.product.id ? { ...item, quantity: Number(e.target.value) } : item))} /></Field><button type="button" className="secondary-button" aria-label={`Quitar ${entry.product.name}`} onClick={() => setCart((items) => items.filter((item) => item.product.id !== entry.product.id))}>Quitar</button><span>{Number.isSafeInteger(entry.quantity) && entry.quantity > 0 && BigInt(entry.product.price) * BigInt(entry.quantity) <= 9_000_000_000_000n ? format(entry.quantity * entry.product.price) : 'Revisa la cantidad'}</span></div>)}</div>
        <div className="sale-total"><span id="cart-total">Total</span><output aria-labelledby="cart-total" className={validTotal || !cart.length ? '' : 'invalid'}>{validTotal ? format(total) : cart.length ? 'Revisa las cantidades y el límite de importe' : format(0)}</output></div><p className="field-help">Precios finales con impuestos incluidos</p>
        <Field label="Método de pago"><select value={method} onChange={(e) => { setMethod(e.target.value); setConfirmed(false); }}><option value="cash">Efectivo</option><option value="card">Tarjeta</option><option value="transfer">Transferencia</option></select></Field>
        {method === 'cash' ? <><Field label="Importe recibido"><input inputMode="decimal" required value={received} onChange={(e) => setReceived(e.target.value)} /></Field><div className="summary-line"><span id="cart-change">Cambio</span><output aria-labelledby="cart-change">{change !== null ? format(change) : 'Revisa el efectivo recibido'}</output></div></> : <label className="check-control"><input type="checkbox" checked={confirmed} required onChange={(e) => setConfirmed(e.target.checked)} />Confirmo que recibí el pago. La aplicación solo lo registra.</label>}
      </fieldset><button className="primary-button checkout-button" disabled={action.busy || !!recoveryError || (!pending && (!validTotal || cart.some((entry) => !Number.isSafeInteger(entry.quantity) || entry.quantity < 1) || (method === 'cash' ? change === null : !confirmed)))} type="submit">{action.busy ? 'Procesando…' : pending ? 'Reintentar mismo cobro' : 'Confirmar venta'}</button></form>
      {!pending && !!cart.length && <button className="secondary-button" disabled={action.busy} onClick={() => { void action.run(async () => {
        const refreshed = await Promise.all(cart.map(async (entry) => { const current = await api.getProduct(entry.product.id); if (!current.active) throw new Error(`${entry.product.name} ya no está disponible. Quítalo del carrito.`); return { ...entry, product: current }; })); return refreshed;
      }, (items) => { setCart(items); action.setMessage('Precios y existencias actualizados. Revisa el total antes de cobrar.'); }); }}>Actualizar precios y existencias</button>}
      <Notice message={action.message} />
    </section></div>
    {receipt && <Modal title={`Comprobante ${receipt.folio}`} onClose={() => setReceipt(null)}><Receipt sale={receipt} status={status} /></Modal>}
  </>;
}
function SaleDetail({ initialSale, status, onClose, onChanged }: { initialSale: api.Sale; status: AppStatus; onClose: () => void; onChanged: () => void }) {
  const [sale, setSale] = useState(initialSale); const [reason, setReason] = useState(''); const [restocked, setRestocked] = useState(false); const [refunded, setRefunded] = useState(false); const action = useAction();
  return <Modal title={sale.folio} onClose={onClose} busy={action.busy}><Receipt sale={sale} status={status} />
    {!sale.cancellation && <section className="cancellation-form"><h3>Anulación completa</h3><p>Solo procede si toda la mercancía está en la tienda o fue devuelta y está disponible para vender. La aplicación no ejecuta reembolsos bancarios: devuelve el dinero por el medio original antes de confirmarlo aquí.</p>
      <form onSubmit={(e) => { e.preventDefault(); void action.run(() => api.cancelSale(sale.id, reason, restocked, refunded), (saved) => { setSale(saved); onChanged(); }); }}><fieldset disabled={action.busy}><Field label="Motivo obligatorio"><input required maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} /></Field><label className="check-control"><input type="checkbox" required checked={restocked} onChange={(e) => setRestocked(e.target.checked)} />Toda la mercancía está disponible para vender.</label><label className="check-control"><input type="checkbox" required checked={refunded} onChange={(e) => setRefunded(e.target.checked)} />Devolví al cliente el importe original completo por el medio de pago original.</label><Notice error={action.error} /><button className="danger-button" disabled={!restocked || !refunded || !reason.trim()} type="submit">Confirmar anulación completa</button></fieldset></form>
    </section>}
  </Modal>;
}
export function History({ status, onChanged, reportOnly = false }: Props & { reportOnly?: boolean }) {
  const day = api.today(status.settings.timeZone);
  const [form, setForm] = useState<api.Period>({ from: day, to: day, folio: '', status: 'all', offset: 0 });
  const [period, setPeriod] = useState(form);
  const records = useRemote(() => reportOnly ? Promise.resolve([]) : api.getHistory(period), [period, reportOnly]);
  const report = useRemote(() => api.getReport(period), [period]);
  const [detail, setDetail] = useState<api.Sale | null>(null); const action = useAction(); const { format } = useMoney(status);
  return <>
    <section className="workspace-card"><form onSubmit={(e) => { e.preventDefault(); setPeriod({ ...form, offset: 0 }); }}><div className="toolbar"><Field label="Desde"><input required type="date" value={form.from} onChange={(e) => setForm((f) => ({ ...f, from: e.target.value }))} /></Field><Field label="Hasta"><input required type="date" value={form.to} onChange={(e) => setForm((f) => ({ ...f, to: e.target.value }))} /></Field>{!reportOnly && <><Field label="Folio"><input placeholder="V-00000001" value={form.folio} onChange={(e) => setForm((f) => ({ ...f, folio: e.target.value }))} /></Field><Field label="Estado"><select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}><option value="all">Todos</option><option value="active">Vigentes</option><option value="cancelled">Anuladas</option></select></Field></>}<button className="primary-button" type="submit">Consultar</button></div></form><p className="field-help">Zona {status.settings.timeZone} · incluye ventas realizadas o anuladas en el período</p></section>
    <Notice error={report.error || records.error || action.error} message={action.message} />
    {report.loading && <p role="status">Calculando reporte…</p>}
    {report.data && !report.loading && <><p>Totales del período {period.from} a {period.to}; incluyen todos los folios y estados.</p><section className="business-overview"><div className="summary-card"><span>Ventas realizadas</span><strong>{format(report.data.salesTotal)}</strong><small>{report.data.salesCount} ventas</small></div><div className="summary-card"><span>Anulaciones registradas</span><strong>{format(report.data.cancellationsTotal)}</strong><small>{report.data.cancellationsCount} anulaciones</small></div><div className="summary-card"><span>Neto del período</span><strong>{format(report.data.net)}</strong><small>Ventas menos anulaciones, no es utilidad ni cierre de caja</small></div></section></>}
    <section className="workspace-card"><div className="toolbar"><div><h2>{reportOnly ? 'Exportar operaciones del período' : 'Ventas y anulaciones'}</h2><p>El CSV incluye ventas por su fecha de venta y anulaciones por su fecha de anulación, con referencias e importes originales.</p></div><button className="secondary-button" disabled={action.busy || report.loading || !!report.error} onClick={() => { void action.run(() => api.exportReport(period), (path) => { if (path) action.setMessage(`CSV guardado en ${path}`); }); }}>Exportar CSV del período</button></div>
      {!reportOnly && <>{records.loading && <p role="status">Cargando historial…</p>}<div className="table-scroll"><table><thead><tr><th>Folio</th><th>Fecha de venta</th><th>Método</th><th className="num">Total</th><th>Estado / anulación</th><th>Detalle</th></tr></thead><tbody>{records.data?.map((s) => <tr key={s.id}><td className="meta">{s.folio}</td><td className="meta">{api.dateTime(s.createdAt, status.settings.timeZone)}</td><td>{api.paymentName(s.method)}</td><td className="num">{format(s.total)}</td><td><span className={`state${s.cancelledAt ? ' cancelled' : ''}`}>{s.cancelledAt ? 'Anulada' : 'Vigente'}</span><small>{s.cancelledAt ? api.dateTime(s.cancelledAt, status.settings.timeZone) : ''}</small></td><td><button className="secondary-button" disabled={action.busy} onClick={() => { void action.run(() => api.getSale(s.id), setDetail); }}>Ver venta</button></td></tr>)}</tbody></table></div>{!records.loading && !records.data?.length && !records.error && <p>No hay ventas ni anulaciones para estos filtros.</p>}<Pager offset={period.offset} count={records.data?.length ?? 0} onChange={(offset) => setPeriod((p) => ({ ...p, offset }))} /></>}
    </section>
    {detail && <SaleDetail initialSale={detail} status={status} onClose={() => setDetail(null)} onChanged={() => { records.refresh(); report.refresh(); onChanged(); }} />}
  </>;
}
// Carta enfundada dibujada en CSS: el único objeto con color en la pantalla de inicio.
function CardStack() {
  return <div className="card-stack" aria-hidden="true"><span className="tcg-card back" /><span className="tcg-card front"><span className="tcg-art" /><span className="tcg-name" /><span className="tcg-text" /><span className="tcg-text short" /></span></div>;
}
export function TodaySummary({ status }: { status: AppStatus }) {
  const day = api.today(status.settings.timeZone);
  const report = useRemote(() => api.getReport({ from: day, to: day, folio: '', status: 'all', offset: 0 }), [day]);
  const { format } = useMoney(status); const data = report.data;
  const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  return <><Notice error={report.error} /><section className="business-overview" aria-label="Resumen de hoy">
    <div className="summary-card featured"><div><span>Vendido hoy</span><strong>{data ? format(data.salesTotal) : '—'}</strong><small>{data ? count(data.salesCount, 'venta', 'ventas') : report.loading ? 'Calculando…' : 'Sin datos'}</small></div><CardStack /></div>
    <div className="summary-card"><span>Anulaciones</span><strong>{data ? format(data.cancellationsTotal) : '—'}</strong><small>{data ? count(data.cancellationsCount, 'anulación', 'anulaciones') : ''}</small></div>
    <div className="summary-card"><span>Neto de hoy</span><strong>{data ? format(data.net) : '—'}</strong><small>Ventas menos anulaciones</small></div>
  </section></>;
}
export function BackupPanel() {
  const action = useAction(); const [source, setSource] = useState<string | null>(null); const [confirmation, setConfirmation] = useState('');
  return <><Notice error={action.error} message={action.message} /><section className="workspace-card"><h2>Crear respaldo</h2><p>Guarda una copia completa de productos, movimientos, ventas y configuración. Elige un archivo nuevo, preferentemente en otra unidad. Los respaldos contienen información del negocio.</p><button className="primary-button" disabled={action.busy} onClick={() => { void action.run(api.createBackup, (path) => { if (path) action.setMessage(`Respaldo guardado en ${path}`); }); }}>{action.busy ? 'Procesando…' : 'Crear respaldo'}</button></section>
    <section className="workspace-card"><h2>Restaurar respaldo</h2><p>Reemplaza todos los datos actuales por los del respaldo. Se comprobarán la aplicación, la versión y la integridad antes del reemplazo. Se creará una copia de recuperación de los datos actuales.</p><button className="secondary-button" disabled={action.busy} onClick={() => { void action.run(api.chooseRestore, (path) => { if (path) { setSource(path); setConfirmation(''); } }); }}>Seleccionar respaldo</button></section>
    {source && <Modal title="Confirmar reemplazo de datos" busy={action.busy} onClose={() => setSource(null)}><p>Archivo verificado: {source}</p><div className="notice">Se perderán de la base activa las operaciones posteriores a este respaldo. No realices cobros durante la restauración.</div><form onSubmit={(e) => { e.preventDefault(); void action.run(() => api.restoreBackup(source, confirmation === 'REEMPLAZAR'), (recovery) => { localStorage.removeItem(ATTEMPT_KEY); setSource(null); action.setMessage(`Restauración completada. Copia anterior: ${recovery}. La aplicación volverá a cargar los datos.`); window.location.reload(); }); }}><fieldset disabled={action.busy}><Field label="Escribe REEMPLAZAR para confirmar"><input required value={confirmation} onChange={(e) => setConfirmation(e.target.value)} /></Field><Notice error={action.error} /><button className="danger-button" type="submit" disabled={confirmation !== 'REEMPLAZAR'}>{action.busy ? 'Restaurando…' : 'Reemplazar datos y recargar'}</button></fieldset></form></Modal>}
  </>;
}
