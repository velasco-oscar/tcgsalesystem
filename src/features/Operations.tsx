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
// Solo aparece cuando hay más de una página.
function Pager({ offset, count, onChange }: { offset: number; count: number; onChange: (offset: number) => void }) {
  if (!offset && count < 100) return null;
  return <div className="pager"><button className="secondary-button" disabled={!offset} onClick={() => onChange(Math.max(0, offset - 100))}>Anterior</button><span>Página {offset / 100 + 1}</span><button className="secondary-button" disabled={count < 100} onClick={() => onChange(offset + 100)}>Siguiente</button></div>;
}
function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="control-label">{label}{children}</label>; }
function SearchField({ value, disabled, onChange }: { value: string; disabled?: boolean; onChange: (value: string) => void }) {
  return <label className="search-input"><span className="visually-hidden">Buscar</span><Icon name="search" /><input placeholder="Buscar nombre, SKU o etiqueta" disabled={disabled} value={value} onChange={(e) => onChange(e.target.value)} /></label>;
}
function CategoryFilter({ categories, value, disabled, onChange }: { categories: api.Category[]; value: number | null; disabled?: boolean; onChange: (value: number | null) => void }) {
  return <label className="filter-select"><span className="visually-hidden">Categoría</span><select disabled={disabled} value={value ?? ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
    <option value="">Todas las categorías</option>{api.sortedCategories(categories).map((c) => <option key={c.id} value={c.id}>{api.categoryPath(categories, c)}</option>)}
  </select></label>;
}
// Texto y números en una línea; las opciones de lista como etiquetas.
function ProductMeta({ item }: { item: { sku?: string; variant: string; attributes: api.AttributeValue[] } }) {
  const parts = [item.sku && { name: 'SKU', value: item.sku }, item.variant && { name: 'Variante', value: item.variant }, ...item.attributes.filter((a) => a.kind !== 'list')].filter((v): v is { name: string; value: string } => !!v);
  return <small>{parts.map((part, index) => <span key={index} title={part.name}>{index > 0 && ' · '}{part.value}</span>)}</small>;
}
function AttributeTags({ attributes, tags = [] }: { attributes: api.AttributeValue[]; tags?: string[] }) {
  const options = attributes.filter((a) => a.kind === 'list');
  if (!options.length && !tags.length) return null;
  return <span className="card-tags">{options.map((a) => <span className="tag" key={a.name} title={a.name}>{a.value}</span>)}{tags.map((t) => <span className="tag label" key={t}>{t}</span>)}</span>;
}
function useMoney(status: AppStatus) {
  const digits = status.currencies.find((c) => c.code === status.settings.currencyCode)?.minorUnits ?? 2;
  return { digits, format: (amount: number) => api.displayMoney(amount, status.settings.currencyCode, digits) };
}
interface Props { status: AppStatus; onChanged: () => void }
function AttributeField({ attribute, value, onChange }: { attribute: api.Attribute; value: string; onChange: (value: string) => void }) {
  const label = attribute.required ? attribute.name : `${attribute.name} (opcional)`;
  if (attribute.kind === 'list') return <Field label={label}><select required={attribute.required} value={value} onChange={(e) => onChange(e.target.value)}>
    <option value="">{attribute.required ? 'Elige…' : '—'}</option>{attribute.options.map((o) => <option key={o}>{o}</option>)}</select></Field>;
  return <Field label={label}><input required={attribute.required} maxLength={120} inputMode={attribute.kind === 'number' ? 'decimal' : undefined} value={value} onChange={(e) => onChange(e.target.value)} /></Field>;
}
function ProductEditor({ product, categories, status, onSaved, onClose }: { product: api.Product | null; categories: api.Category[]; status: AppStatus; onSaved: () => void; onClose: () => void }) {
  const { digits } = useMoney(status);
  const [form, setForm] = useState<api.ProductInput>(product
    ? { id: product.id, sku: product.sku, name: product.name, categoryId: product.categoryId, variant: product.variant, attributes: product.attributes.map((a) => ({ attributeId: a.attributeId, value: a.value })), tags: product.tags, active: product.active, price: api.decimal(product.price, digits), cost: api.decimal(product.cost, digits), initialStock: 0 }
    : { id: null, sku: '', name: '', categoryId: null, variant: '', attributes: [], tags: [], price: '', cost: '', initialStock: 0, active: true });
  const [tags, setTags] = useState(form.tags.join(', '));
  const action = useAction();
  const attributes = api.categoryAttributes(categories, form.categoryId);
  const valueOf = (id: number) => form.attributes.find((a) => a.attributeId === id)?.value ?? '';
  function field<K extends keyof api.ProductInput>(key: K, value: api.ProductInput[K]) { setForm((f) => ({ ...f, [key]: value })); }
  function setValue(attributeId: number, value: string) { setForm((f) => ({ ...f, attributes: [...f.attributes.filter((a) => a.attributeId !== attributeId), { attributeId, value }] })); }
  function submit(event: FormEvent) {
    event.preventDefault();
    const input = { ...form, cost: form.cost.trim() || '0', tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
      attributes: attributes.map((a) => ({ attributeId: a.id, value: valueOf(a.id) })).filter((a) => a.value.trim()) };
    void action.run(() => api.saveProduct(input), onSaved);
  }
  return <Modal title={product ? 'Editar producto' : 'Nuevo producto'} onClose={onClose} busy={action.busy}>
    <form onSubmit={submit}><fieldset disabled={action.busy}><div className="form-grid">
      <Field label="Nombre"><input required maxLength={160} value={form.name} onChange={(e) => field('name', e.target.value)} /></Field>
      <Field label="SKU"><input required maxLength={60} pattern="[A-Za-z0-9_.\-]+" title="Letras sin acentos, números, guion, punto o guion bajo" value={form.sku} onChange={(e) => field('sku', e.target.value)} /></Field>
      <Field label="Categoría"><select value={form.categoryId ?? ''} onChange={(e) => field('categoryId', e.target.value ? Number(e.target.value) : null)}><option value="">Sin categoría</option>{api.sortedCategories(categories).map((c) => <option value={c.id} key={c.id}>{api.categoryPath(categories, c)}</option>)}</select></Field>
      <Field label="Variante (opcional)"><input maxLength={120} placeholder="Ej. Azul, 500 ml" value={form.variant} onChange={(e) => field('variant', e.target.value)} /></Field>
      <Field label={`Precio (${status.settings.currencyCode})`}><input required inputMode="decimal" placeholder="0.00" value={form.price} onChange={(e) => field('price', e.target.value)} /></Field>
      <Field label="Costo (opcional)"><input inputMode="decimal" placeholder="0.00" value={form.cost} onChange={(e) => field('cost', e.target.value)} /></Field>
      {!product && <Field label="Existencias iniciales"><input required type="number" min={0} max={1000000} step={1} value={form.initialStock} onChange={(e) => field('initialStock', Number(e.target.value))} /></Field>}
      <Field label="Etiquetas (opcional)"><input maxLength={400} placeholder="preventa, vitrina" value={tags} onChange={(e) => setTags(e.target.value)} /></Field>
    </div>
    {!!attributes.length && <div className="form-grid card-fields" role="group" aria-label="Atributos de la categoría">{attributes.map((a) => <AttributeField key={a.id} attribute={a} value={valueOf(a.id)} onChange={(value) => setValue(a.id, value)} />)}</div>}
    <label className="check-control"><input type="checkbox" checked={form.active} onChange={(e) => field('active', e.target.checked)} />Disponible para vender</label>
    <Notice error={action.error} /><div className="form-actions"><button className="primary-button" type="submit">{action.busy ? 'Guardando…' : 'Guardar producto'}</button></div>
    </fieldset></form>
  </Modal>;
}

// Plantillas para empezar una categoría; el usuario puede editarlas después.
const TEMPLATES: { name: string; attributes: Omit<api.AttributeInput, 'id'>[] }[] = [
  { name: 'Cartas TCG', attributes: [
    { name: 'Juego', kind: 'text', options: [], required: true },
    { name: 'Expansión', kind: 'text', options: [], required: true },
    { name: 'Número', kind: 'text', options: [], required: false },
    { name: 'Idioma', kind: 'list', options: ['Español', 'Inglés', 'Japonés', 'Francés', 'Alemán', 'Italiano', 'Portugués', 'Coreano', 'Chino'], required: true },
    { name: 'Condición', kind: 'list', options: ['NM', 'LP', 'MP', 'HP', 'DMG'], required: true },
    { name: 'Acabado', kind: 'list', options: ['Normal', 'Foil', 'Reverse', 'Etched', 'Otro'], required: false },
  ] },
  { name: 'Ropa', attributes: [
    { name: 'Talla', kind: 'list', options: ['CH', 'M', 'G', 'XG'], required: true },
    { name: 'Color', kind: 'text', options: [], required: false },
  ] },
];
const KIND_NAMES: Record<api.AttributeKind, string> = { text: 'Texto', number: 'Número', list: 'Lista' };
interface DraftAttribute extends api.AttributeInput { key: number; optionsText: string }
let draftKey = 0;
const draft = (a: Omit<api.AttributeInput, 'id'> & { id?: number | null }): DraftAttribute => ({ ...a, id: a.id ?? null, key: ++draftKey, optionsText: a.options.join(', ') });

function CategoryEditor({ category, categories, onSaved, onClose }: { category: api.Category | null; categories: api.Category[]; onSaved: () => void; onClose: () => void }) {
  const [name, setName] = useState(category?.name ?? '');
  const [parentId, setParentId] = useState<number | null>(category?.parentId ?? null);
  const [attributes, setAttributes] = useState<DraftAttribute[]>(() => (category?.attributes ?? []).map((a) => draft(a)));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const action = useAction();
  const hasChildren = !!category && categories.some((c) => c.parentId === category.id);
  const parents = categories.filter((c) => c.parentId === null && c.id !== category?.id);
  const inherited = categories.find((c) => c.id === parentId)?.attributes ?? [];
  const canDelete = !!category && !hasChildren && category.productCount === 0;
  function update(key: number, change: Partial<DraftAttribute>) { setAttributes((list) => list.map((a) => a.key === key ? { ...a, ...change } : a)); }
  function submit(event: FormEvent) {
    event.preventDefault();
    const input: api.CategoryInput = { id: category?.id ?? null, name, parentId, attributes: attributes.map((a) => ({ id: a.id, name: a.name, kind: a.kind, required: a.required, options: a.kind === 'list' ? a.optionsText.split(',').map((o) => o.trim()).filter(Boolean) : [] })) };
    void action.run(() => api.saveCategory(input), onSaved);
  }
  return <Modal title={category ? 'Editar categoría' : 'Nueva categoría'} onClose={onClose} busy={action.busy}>
    <form onSubmit={submit}><fieldset disabled={action.busy}>
      <div className="form-grid">
        <Field label="Nombre"><input required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Dentro de"><select disabled={hasChildren} value={parentId ?? ''} onChange={(e) => setParentId(e.target.value ? Number(e.target.value) : null)}><option value="">Ninguna (principal)</option>{parents.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
      </div>
      <div className="attribute-heading"><h3>Atributos</h3>
        {!category && !attributes.length && <span className="template-picker">Plantilla:{TEMPLATES.map((t) => <button type="button" key={t.name} className="secondary-button" onClick={() => { setAttributes(t.attributes.map((a) => draft(a))); if (!name.trim()) setName(t.name); }}>{t.name}</button>)}</span>}
      </div>
      {!!inherited.length && <p className="inherited">Incluye de la categoría superior: {inherited.map((a) => <span className="tag" key={a.id}>{a.name}</span>)}</p>}
      {!attributes.length && <p className="empty-line">Sin atributos. Agrega los datos que quieras pedir en cada producto, como talla o condición.</p>}
      {!!attributes.length && <div className="attribute-list">
        <div className="attribute-row attribute-head" aria-hidden="true"><span>Nombre</span><span>Tipo</span><span>Opciones</span><span>Obligatorio</span><span /></div>
        {attributes.map((a) => <div className="attribute-row" key={a.key}>
          <input aria-label="Nombre del atributo" required maxLength={40} placeholder="Ej. Talla" value={a.name} onChange={(e) => update(a.key, { name: e.target.value })} />
          <select aria-label={`Tipo de ${a.name || 'atributo'}`} value={a.kind} onChange={(e) => update(a.key, { kind: e.target.value as api.AttributeKind })}>{Object.entries(KIND_NAMES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
          {a.kind === 'list' ? <input aria-label={`Opciones de ${a.name || 'atributo'}`} required placeholder="CH, M, G" value={a.optionsText} onChange={(e) => update(a.key, { optionsText: e.target.value })} /> : <span className="muted-cell">—</span>}
          <label className="check-cell"><input type="checkbox" aria-label={`${a.name || 'Atributo'} obligatorio`} checked={a.required} onChange={(e) => update(a.key, { required: e.target.checked })} /></label>
          <button type="button" className="icon-button" aria-label={`Quitar ${a.name || 'atributo'}`} title="Quitar" onClick={() => setAttributes((list) => list.filter((x) => x.key !== a.key))}><Icon name="close" /></button>
        </div>)}
      </div>}
      <button type="button" className="secondary-button add-attribute" onClick={() => setAttributes((list) => [...list, draft({ name: '', kind: 'text', options: [], required: false })])}><Icon name="plus" />Agregar atributo</button>
      <Notice error={action.error} />
      <div className="form-actions">
        {canDelete && <button type="button" className="danger-button" onClick={() => confirmDelete ? void action.run(() => api.deleteCategory(category.id), onSaved) : setConfirmDelete(true)}>{confirmDelete ? 'Confirmar eliminación' : 'Eliminar'}</button>}
        <button className="primary-button" type="submit">{action.busy ? 'Guardando…' : 'Guardar categoría'}</button>
      </div>
    </fieldset></form>
  </Modal>;
}

function CategoryList({ categories, onEdit }: { categories: api.Category[]; onEdit: (category: api.Category | null) => void }) {
  if (!categories.length) return <div className="empty-state"><p>Aún no hay categorías</p><button className="primary-button" onClick={() => onEdit(null)}><Icon name="plus" />Nueva categoría</button></div>;
  return <ul className="category-list">{api.sortedCategories(categories).map((c) => <li key={c.id} className={c.parentId ? 'child' : ''}>
    <div><strong>{c.name}</strong><small>{c.productCount} {c.productCount === 1 ? 'producto' : 'productos'}</small></div>
    <span className="card-tags">{c.attributes.map((a) => <span className="tag" key={a.id} title={KIND_NAMES[a.kind]}>{a.name}</span>)}</span>
    <button className="secondary-button" onClick={() => onEdit(c)}>Editar</button>
  </li>)}</ul>;
}
export function Catalog({ status, onChanged }: Props) {
  const [tab, setTab] = useState<'products' | 'categories'>('products');
  const [search, setSearch] = useState(''); const [offset, setOffset] = useState(0); const [inactive, setInactive] = useState(false); const [filter, setFilter] = useState<number | null>(null);
  const list = useRemote(() => api.getProducts(search, inactive, offset, filter), [search, inactive, offset, filter]);
  const categories = useRemote(api.getCategories, []); const { format } = useMoney(status);
  const [editing, setEditing] = useState<api.Product | null | undefined>(undefined);
  const [editingCategory, setEditingCategory] = useState<api.Category | null | undefined>(undefined);
  return <>
    <div className="page-tabs"><div className="segmented" role="tablist" aria-label="Catálogo">
      <button role="tab" aria-selected={tab === 'products'} onClick={() => setTab('products')}>Productos</button>
      <button role="tab" aria-selected={tab === 'categories'} onClick={() => setTab('categories')}>Categorías</button>
    </div>{tab === 'products' ? <button className="primary-button" onClick={() => setEditing(null)}><Icon name="plus" />Nuevo producto</button> : <button className="primary-button" onClick={() => setEditingCategory(null)}><Icon name="plus" />Nueva categoría</button>}</div>
    <Notice error={categories.error} />
    {tab === 'products' ? <section className="workspace-card">
      <div className="toolbar"><SearchField value={search} onChange={(value) => { setSearch(value); setOffset(0); }} /><CategoryFilter categories={categories.data ?? []} value={filter} onChange={(value) => { setFilter(value); setOffset(0); }} />
        <label className="check-control inline"><input type="checkbox" checked={inactive} onChange={(e) => { setInactive(e.target.checked); setOffset(0); }} />Mostrar no disponibles</label></div>
      <Notice error={list.error} />{list.loading && <p role="status" className="empty-line">Cargando…</p>}
      {!!list.data?.length && <div className="table-scroll"><table><thead><tr><th>Producto</th><th>Categoría</th><th className="num">Precio</th><th className="num">Existencias</th><th><span className="visually-hidden">Acción</span></th></tr></thead><tbody>{list.data.map((p) => <tr key={p.id} className={p.active ? '' : 'inactive'}><td><strong>{p.name}</strong>{!p.active && <span className="state off"> · No disponible</span>}<ProductMeta item={p} /><AttributeTags attributes={p.attributes} tags={p.tags} /></td><td>{p.category ?? <span className="state off">—</span>}</td><td className="num">{format(p.price)}</td><td className="num">{p.stock}</td><td><button className="secondary-button" onClick={() => setEditing(p)}>Editar</button></td></tr>)}</tbody></table></div>}
      {!list.loading && !list.data?.length && !list.error && <div className="empty-state"><p>{search || filter ? 'Sin resultados' : 'Aún no hay productos'}</p>{!search && !filter && <button className="primary-button" onClick={() => setEditing(null)}><Icon name="plus" />Nuevo producto</button>}</div>}
      <Pager offset={offset} count={list.data?.length ?? 0} onChange={setOffset} />
    </section> : <section className="workspace-card">{categories.loading ? <p role="status" className="empty-line">Cargando…</p> : <CategoryList categories={categories.data ?? []} onEdit={setEditingCategory} />}</section>}
    {editing !== undefined && <ProductEditor product={editing} categories={categories.data ?? []} status={status} onClose={() => setEditing(undefined)} onSaved={() => { setEditing(undefined); list.refresh(); categories.refresh(); onChanged(); }} />}
    {editingCategory !== undefined && <CategoryEditor category={editingCategory} categories={categories.data ?? []} onClose={() => setEditingCategory(undefined)} onSaved={() => { setEditingCategory(undefined); categories.refresh(); list.refresh(); }} />}
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
    <section className="workspace-card"><div className="toolbar"><SearchField value={search} onChange={(value) => { setSearch(value); setOffset(0); }} /></div><Notice error={list.error} message={action.message} />{list.loading && <p role="status" className="empty-line">Cargando…</p>}
      {!!list.data?.length && <div className="table-scroll"><table><thead><tr><th>Producto</th><th className="num">Existencias</th><th><span className="visually-hidden">Acción</span></th></tr></thead><tbody>{list.data.map((p) => <tr key={p.id} className={p.active ? '' : 'inactive'}><td><strong>{p.name}</strong>{!p.active && <span className="state off"> · No disponible</span>}<ProductMeta item={p} /><AttributeTags attributes={p.attributes} /></td><td className="num">{p.stock}</td><td><button className="secondary-button" onClick={() => { setSelected(p); setMovementOffset(0); action.setError(''); action.setMessage(''); }}>Ajustar</button></td></tr>)}</tbody></table></div>}
      {!list.loading && !list.data?.length && !list.error && <div className="empty-state"><p>{search ? 'Sin resultados' : 'Aún no hay productos. Créalos en Catálogo'}</p></div>}<Pager offset={offset} count={list.data?.length ?? 0} onChange={setOffset} />
    </section>
    {selected && <Modal title={selected.name} onClose={() => setSelected(null)} busy={action.busy}>
      <dl className="totals compact"><div><dt>Existencias</dt><dd>{selected.stock}</dd></div></dl>
      <form onSubmit={submit}><fieldset disabled={action.busy}><div className="form-grid"><Field label="Tipo"><select value={kind} onChange={(e) => setKind(e.target.value)}><option value="entry">Entrada</option><option value="adjustment">Ajuste (+ o −)</option></select></Field><Field label="Cantidad"><input type="number" step={1} min={kind === 'entry' ? 1 : -1000000} max={1000000} required value={quantity} onChange={(e) => setQuantity(e.target.value)} /></Field><Field label="Motivo"><input required maxLength={500} placeholder={kind === 'entry' ? 'Ej. Compra a proveedor' : 'Ej. Conteo físico'} value={reason} onChange={(e) => setReason(e.target.value)} /></Field></div><Notice error={action.error} /><div className="form-actions"><button className="primary-button" type="submit">Registrar</button></div></fieldset></form>
      <h3>Movimientos</h3><Notice error={ledger.error} />{ledger.loading && <p role="status" className="empty-line">Cargando…</p>}<div className="table-scroll"><table><thead><tr><th>Fecha</th><th>Tipo</th><th className="num">Cantidad</th><th>Motivo</th></tr></thead><tbody>{ledger.data?.map((m) => <tr key={m.id}><td className="meta">{api.dateTime(m.createdAt, status.settings.timeZone)}</td><td>{api.movementName(m.kind)}</td><td className={`num ${m.quantity > 0 ? 'positive' : 'negative'}`}>{m.quantity > 0 ? '+' : ''}{m.quantity}</td><td>{m.reason}{!!m.saleId && <small>V-{String(m.saleId).padStart(8, '0')}</small>}</td></tr>)}</tbody></table></div><Pager offset={movementOffset} count={ledger.data?.length ?? 0} onChange={setMovementOffset} />
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
    <p className="receipt-meta"><span className={`tag ${sale.cancellation ? 'negative' : 'positive'}`}>{sale.cancellation ? 'Anulada' : 'Pagada'}</span>{api.dateTime(sale.createdAt, status.settings.timeZone)} · {api.paymentName(sale.method)}</p>
    <div className="table-scroll"><table><thead><tr><th>Producto</th><th className="num">Cant.</th><th className="num">Precio</th><th className="num">Subtotal</th></tr></thead><tbody>{sale.items.map((item) => <tr key={item.productId}><td>{item.name}<ProductMeta item={item} /><AttributeTags attributes={item.attributes} /></td><td className="num">{item.quantity}</td><td className="num">{format(item.price)}</td><td className="num">{format(item.price * item.quantity)}</td></tr>)}</tbody></table></div>
    <dl className="totals"><div className="grand"><dt>Total</dt><dd>{format(sale.total)}</dd></div>{sale.received !== null && <><div><dt>Recibido</dt><dd>{format(sale.received)}</dd></div><div><dt>Cambio</dt><dd>{format(sale.change ?? 0)}</dd></div></>}</dl>
    {sale.cancellation && <div className="notice"><div><strong>Anulada · {api.dateTime(sale.cancellation.createdAt, status.settings.timeZone)}</strong><br />{sale.cancellation.reason} · devuelto {format(sale.cancellation.refund)} en {api.paymentName(sale.cancellation.method).toLowerCase()}</div></div>}
    <p className="field-help">Impuestos incluidos · no es factura fiscal</p>
  </div>;
}
export function Sales({ status, onChanged }: Props) {
  const [recoveryError] = useState(() => { try { storedAttempt(); return ''; } catch (e) { return errorMessage(e); } });
  const [pending, setPending] = useState<SavedAttempt | null>(() => { try { return storedAttempt(); } catch { return null; } });
  const [cart, setCart] = useState<CartEntry[]>(pending?.cart ?? []);
  const [search, setSearch] = useState(''); const [offset, setOffset] = useState(0); const [filter, setFilter] = useState<number | null>(null);
  const list = useRemote(() => api.getProducts(search, false, offset, filter), [search, offset, filter]);
  const categories = useRemote(api.getCategories, []);
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
    {pending && <div className="notice" role="status" title={`Referencia ${pending.input.requestId}`}>Cobro sin confirmar. Pulsa «Reintentar mismo cobro» y no cobres de nuevo al cliente</div>}
    <div className="sale-layout"><section className="workspace-card">
      <div className="toolbar"><SearchField disabled={action.busy || !!pending || !!recoveryError} value={search} onChange={(value) => { setSearch(value); setOffset(0); }} /><CategoryFilter disabled={action.busy || !!pending || !!recoveryError} categories={categories.data ?? []} value={filter} onChange={(value) => { setFilter(value); setOffset(0); }} /></div>
      <Notice error={list.error} />{list.loading && <p role="status" className="empty-line">Cargando…</p>}
      <div className="sale-products">{list.data?.map((p) => <button className="sale-product" disabled={!p.stock || !!pending || action.busy || !!recoveryError} key={p.id} onClick={() => add(p)}><span><strong>{p.name}</strong><ProductMeta item={p} /><AttributeTags attributes={p.attributes} /></span><span className="sale-price"><strong>{format(p.price)}</strong><small>{p.stock ? `${p.stock} disp.` : 'Agotado'}</small></span></button>)}</div>
      {!list.loading && !list.data?.length && !list.error && <div className="empty-state"><p>Sin resultados</p></div>}<Pager offset={offset} count={list.data?.length ?? 0} onChange={setOffset} />
    </section>
    <section className="workspace-card"><h2>Carrito</h2>{!cart.length && <p className="empty-line">Toca un producto para agregarlo</p>}
      <form onSubmit={submit}><fieldset disabled={action.busy || !!pending || !!recoveryError}>
        <div className="cart-items">{cart.map((entry) => <div className="cart-row" key={entry.product.id}><div><strong>{entry.product.name}</strong><small>{format(entry.product.price)} c/u</small><AttributeTags attributes={entry.product.attributes} /></div><Field label="Cantidad"><input type="number" min={1} max={1000000} step={1} required value={entry.quantity} onChange={(e) => setCart((items) => items.map((item) => item.product.id === entry.product.id ? { ...item, quantity: Number(e.target.value) } : item))} /></Field><button type="button" className="secondary-button" aria-label={`Quitar ${entry.product.name}`} onClick={() => setCart((items) => items.filter((item) => item.product.id !== entry.product.id))}>Quitar</button><span>{Number.isSafeInteger(entry.quantity) && entry.quantity > 0 && BigInt(entry.product.price) * BigInt(entry.quantity) <= 9_000_000_000_000n ? format(entry.quantity * entry.product.price) : 'Revisa la cantidad'}</span></div>)}</div>
        <div className="sale-total"><span id="cart-total">Total</span><output aria-labelledby="cart-total" className={validTotal || !cart.length ? '' : 'invalid'}>{validTotal ? format(total) : cart.length ? 'Revisa las cantidades' : format(0)}</output></div>
        <Field label="Método de pago"><select value={method} onChange={(e) => { setMethod(e.target.value); setConfirmed(false); }}><option value="cash">Efectivo</option><option value="card">Tarjeta</option><option value="transfer">Transferencia</option></select></Field>
        {method === 'cash' ? <><Field label="Importe recibido"><input inputMode="decimal" required value={received} onChange={(e) => setReceived(e.target.value)} /></Field><div className="summary-line"><span id="cart-change">Cambio</span><output aria-labelledby="cart-change">{change !== null ? format(change) : '—'}</output></div></> : <label className="check-control"><input type="checkbox" checked={confirmed} required onChange={(e) => setConfirmed(e.target.checked)} />Pago recibido</label>}
      </fieldset><button className="primary-button checkout-button" disabled={action.busy || !!recoveryError || (!pending && (!validTotal || cart.some((entry) => !Number.isSafeInteger(entry.quantity) || entry.quantity < 1) || (method === 'cash' ? change === null : !confirmed)))} type="submit">{action.busy ? 'Procesando…' : pending ? 'Reintentar mismo cobro' : 'Confirmar venta'}</button></form>
      {!pending && !!cart.length && <button className="secondary-button" disabled={action.busy} onClick={() => { void action.run(async () => {
        const refreshed = await Promise.all(cart.map(async (entry) => { const current = await api.getProduct(entry.product.id); if (!current.active) throw new Error(`${entry.product.name} ya no está disponible. Quítalo del carrito.`); return { ...entry, product: current }; })); return refreshed;
      }, (items) => { setCart(items); action.setMessage('Carrito actualizado'); }); }}>Actualizar precios</button>}
      <Notice message={action.message} />
    </section></div>
    {receipt && <Modal title={`Comprobante ${receipt.folio}`} onClose={() => setReceipt(null)}><Receipt sale={receipt} status={status} /></Modal>}
  </>;
}
function SaleDetail({ initialSale, status, onClose, onChanged }: { initialSale: api.Sale; status: AppStatus; onClose: () => void; onChanged: () => void }) {
  const [sale, setSale] = useState(initialSale); const [reason, setReason] = useState(''); const [restocked, setRestocked] = useState(false); const [refunded, setRefunded] = useState(false); const action = useAction();
  return <Modal title={sale.folio} onClose={onClose} busy={action.busy}><Receipt sale={sale} status={status} />
    {!sale.cancellation && <section className="cancellation-form"><h3>Anular venta</h3>
      <form onSubmit={(e) => { e.preventDefault(); void action.run(() => api.cancelSale(sale.id, reason, restocked, refunded), (saved) => { setSale(saved); onChanged(); }); }}><fieldset disabled={action.busy}><Field label="Motivo"><input required maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} /></Field><label className="check-control"><input type="checkbox" required checked={restocked} onChange={(e) => setRestocked(e.target.checked)} />Toda la mercancía regresó a la tienda</label><label className="check-control"><input type="checkbox" required checked={refunded} onChange={(e) => setRefunded(e.target.checked)} />Devolví el dinero completo al cliente</label><Notice error={action.error} /><button className="danger-button" disabled={!restocked || !refunded || !reason.trim()} type="submit">Anular venta</button></fieldset></form>
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
    <section className="workspace-card"><form onSubmit={(e) => { e.preventDefault(); setPeriod({ ...form, offset: 0 }); }}><div className="toolbar"><Field label="Desde"><input required type="date" value={form.from} onChange={(e) => setForm((f) => ({ ...f, from: e.target.value }))} /></Field><Field label="Hasta"><input required type="date" value={form.to} onChange={(e) => setForm((f) => ({ ...f, to: e.target.value }))} /></Field>{!reportOnly && <><Field label="Folio"><input placeholder="V-00000001" value={form.folio} onChange={(e) => setForm((f) => ({ ...f, folio: e.target.value }))} /></Field><Field label="Estado"><select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}><option value="all">Todos</option><option value="active">Vigentes</option><option value="cancelled">Anuladas</option></select></Field></>}<button className="primary-button" type="submit">Consultar</button></div></form></section>
    <Notice error={report.error || records.error || action.error} message={action.message} />
    {report.loading && <p role="status" className="empty-line">Calculando…</p>}
    {report.data && !report.loading && <section className="business-overview"><div className="summary-card"><span>Ventas</span><strong>{format(report.data.salesTotal)}</strong><small>{report.data.salesCount} {report.data.salesCount === 1 ? 'venta' : 'ventas'}</small></div><div className="summary-card"><span>Anulaciones</span><strong>{format(report.data.cancellationsTotal)}</strong><small>{report.data.cancellationsCount} {report.data.cancellationsCount === 1 ? 'anulación' : 'anulaciones'}</small></div><div className="summary-card"><span>Neto</span><strong>{format(report.data.net)}</strong><small>Ventas menos anulaciones</small></div></section>}
    <section className="workspace-card"><div className="card-heading"><h2>{reportOnly ? 'Exportar período' : 'Ventas'}</h2><button className="secondary-button" disabled={action.busy || report.loading || !!report.error} onClick={() => { void action.run(() => api.exportReport(period), (path) => { if (path) action.setMessage(`CSV guardado en ${path}`); }); }}>Exportar CSV</button></div>
      {!reportOnly && <>{records.loading && <p role="status" className="empty-line">Cargando…</p>}<div className="table-scroll"><table><thead><tr><th>Folio</th><th>Fecha</th><th>Pago</th><th className="num">Total</th><th>Estado</th><th><span className="visually-hidden">Detalle</span></th></tr></thead><tbody>{records.data?.map((s) => <tr key={s.id}><td className="meta">{s.folio}</td><td className="meta">{api.dateTime(s.createdAt, status.settings.timeZone)}</td><td>{api.paymentName(s.method)}</td><td className="num">{format(s.total)}</td><td><span className={`state${s.cancelledAt ? ' cancelled' : ''}`}>{s.cancelledAt ? 'Anulada' : 'Pagada'}</span><small>{s.cancelledAt ? api.dateTime(s.cancelledAt, status.settings.timeZone) : ''}</small></td><td><button className="secondary-button" disabled={action.busy} onClick={() => { void action.run(() => api.getSale(s.id), setDetail); }}>Ver</button></td></tr>)}</tbody></table></div>{!records.loading && !records.data?.length && !records.error && <div className="empty-state"><p>Sin ventas en este período</p></div>}<Pager offset={period.offset} count={records.data?.length ?? 0} onChange={(offset) => setPeriod((p) => ({ ...p, offset }))} /></>}
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
  return <><Notice error={action.error} message={action.message} /><section className="workspace-card"><h2>Crear respaldo</h2><p>Copia de todos tus datos. Guárdala en otra unidad o USB.</p><button className="primary-button" disabled={action.busy} onClick={() => { void action.run(api.createBackup, (path) => { if (path) action.setMessage(`Respaldo guardado en ${path}`); }); }}>{action.busy ? 'Procesando…' : 'Crear respaldo'}</button></section>
    <section className="workspace-card"><h2>Restaurar respaldo</h2><p>Reemplaza los datos actuales. Antes se guarda una copia de seguridad.</p><button className="secondary-button" disabled={action.busy} onClick={() => { void action.run(api.chooseRestore, (path) => { if (path) { setSource(path); setConfirmation(''); } }); }}>Seleccionar respaldo</button></section>
    {source && <Modal title="Restaurar respaldo" busy={action.busy} onClose={() => setSource(null)}><p className="meta-line">{source}</p><div className="notice">Se perderán las ventas y cambios hechos después de este respaldo</div><form onSubmit={(e) => { e.preventDefault(); void action.run(() => api.restoreBackup(source, confirmation === 'REEMPLAZAR'), (recovery) => { localStorage.removeItem(ATTEMPT_KEY); setSource(null); action.setMessage(`Restaurado. Copia anterior en ${recovery}`); window.location.reload(); }); }}><fieldset disabled={action.busy}><Field label="Escribe REEMPLAZAR"><input required value={confirmation} onChange={(e) => setConfirmation(e.target.value)} /></Field><Notice error={action.error} /><button className="danger-button" type="submit" disabled={confirmation !== 'REEMPLAZAR'}>{action.busy ? 'Restaurando…' : 'Restaurar'}</button></fieldset></form></Modal>}
  </>;
}
