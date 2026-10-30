import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import App from '../src/App';
import type { AppStatus } from '../src/lib/api';
import type { Category, Checkout, Product, Sale } from '../src/lib/pos';
import { decimal, parseMoney, today } from '../src/lib/pos';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: () => true }));
let status: AppStatus;
let categories: Category[];
const p: Product = { id: 1, sku: 'A', name: 'Producto A', categoryId: null, category: null, variant: 'Azul', attributes: [], tags: [], price: 1235, cost: 400, stock: 5, active: true };
const receipt: Sale = { id: 1, folio: 'V-00000001', createdAt: '2026-10-15T18:00:00.000Z', currencyCode: 'MXN', storeName: 'Mi negocio', method: 'cash', total: 1235, received: 2000, change: 765, items: [{ productId: 1, sku: 'A', name: 'Producto A', variant: 'Azul', attributes: [], quantity: 1, price: 1235 }], cancellation: null };
async function navigate(name: string) {
  fireEvent.click(within(await screen.findByRole('navigation', { name: 'Navegación principal' })).getByRole('button', { name }));
}
async function startSale() {
  render(<App />); await navigate('Punto de venta');
  fireEvent.click(await screen.findByRole('button', { name: /Producto A/ }));
  fireEvent.change(screen.getByLabelText('Importe recibido'), { target: { value: '20.00' } });
}
beforeEach(() => {
  localStorage.clear(); vi.clearAllMocks();
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.setAttribute('open', ''); } });
  categories = [];
  status = { version: '0.1.0', schemaVersion: 3, settings: { storeName: 'Mi negocio', businessSector: 'Papelería', currencyCode: 'MXN', timeZone: 'America/Tijuana' }, currencies: [{ code: 'MXN', name: 'Peso mexicano', minorUnits: 2 }, { code: 'JPY', name: 'Yen', minorUnits: 0 }], currencyLocked: false, timeZoneLocked: false };
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    const a = args as Record<string, unknown> | undefined;
    switch (command) {
      case 'get_app_status': return structuredClone(status);
      case 'save_store_settings': status.settings = a?.settings as typeof status.settings; return status.settings;
      case 'get_products': return [p];
      case 'get_product': return p;
      case 'get_categories': return structuredClone(categories);
      case 'save_category': return 7;
      case 'get_movements': return [];
      case 'save_product': status.currencyLocked = true; return 1;
      case 'checkout': return receipt;
      case 'get_history': return [{ ...receipt, cancelledAt: null }];
      case 'get_report': return { salesCount: 1, salesTotal: 1235, cancellationsCount: 0, cancellationsTotal: 0, net: 1235, timeZone: 'America/Tijuana' };
      case 'get_sale': return receipt;
      case 'cancel_sale': return { ...receipt, cancellation: { id: 1, createdAt: receipt.createdAt, reason: a?.reason, refund: 1235, method: 'cash' } };
      case 'choose_restore': return 'C:\\respaldo.sqlite3';
      default: return null;
    }
  });
});
afterEach(cleanup);

describe('flujo del POS (puente Tauri simulado)', () => {
  it('entra directamente al menú con preferencias guardadas y edita configuración desde abajo', async () => {
    render(<App />); const mainNav = await screen.findByRole('navigation', { name: 'Navegación principal' });
    expect(within(mainNav).getByRole('button', { name: 'Catálogo' }).hasAttribute('disabled')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Configuración', exact: true }));
    expect(await screen.findByLabelText('Giro del negocio')).toHaveProperty('value', 'Papelería');
    fireEvent.change(screen.getByLabelText('Giro del negocio'), { target: { value: 'Ferretería' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(await screen.findByText('Configuración guardada en este equipo')).toBeTruthy();
    expect(status.settings.businessSector).toBe('Ferretería');
  });
  it('solo abre el panel después de guardar preferencias incompletas', async () => {
    status.settings = { storeName: '', businessSector: '', currencyCode: '', timeZone: 'America/Tijuana' };
    render(<App />); await screen.findByRole('button', { name: 'Guardar y entrar' });
    expect(screen.queryByRole('navigation', { name: 'Navegación principal' })).toBeNull();
    fireEvent.change(screen.getByLabelText('Nombre del negocio'), { target: { value: 'Nueva tienda' } });
    fireEvent.change(screen.getByLabelText('Giro del negocio'), { target: { value: 'Regalos' } });
    fireEvent.change(screen.getByLabelText('Moneda del negocio'), { target: { value: 'MXN' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar y entrar' }));
    expect(await screen.findByRole('navigation', { name: 'Navegación principal' })).toBeTruthy();
  });
  it('no entra al panel si falla el guardado inicial', async () => {
    status.settings.businessSector = '';
    const implementation = vi.mocked(invoke).getMockImplementation()!;
    vi.mocked(invoke).mockImplementation((command, args) => command === 'save_store_settings' ? Promise.reject('No se pudo guardar') : implementation(command, args));
    render(<App />); fireEvent.change(await screen.findByLabelText('Giro del negocio'), { target: { value: 'Regalos' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar y entrar' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'No se pudo guardar');
    expect(screen.queryByRole('navigation', { name: 'Navegación principal' })).toBeNull();
  });
  it('mantiene moneda y zona bloqueadas cuando ya hay operaciones', async () => {
    status.currencyLocked = true; status.timeZoneLocked = true;
    render(<App />); await screen.findByRole('navigation', { name: 'Navegación principal' });
    fireEvent.click(screen.getByRole('button', { name: 'Configuración', exact: true }));
    expect(screen.getByLabelText('Moneda del negocio')).toHaveProperty('disabled', true);
    expect(screen.getByLabelText('Zona horaria del negocio')).toHaveProperty('disabled', true);
  });
  it('envía precio y costo como texto y no permite editar existencias desde producto', async () => {
    render(<App />); await navigate('Catálogo');
    fireEvent.click(await screen.findByRole('button', { name: 'Nuevo producto' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('SKU'), { target: { value: 'NEW' } });
    fireEvent.change(within(dialog).getByLabelText('Nombre'), { target: { value: 'Nuevo' } });
    fireEvent.change(within(dialog).getByLabelText(/Precio/), { target: { value: '0.10' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar producto' }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('save_product', expect.objectContaining({ input: expect.objectContaining({ price: '0.10', cost: '0', initialStock: 0 }) })));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(await screen.findByRole('button', { name: 'Editar', exact: true }));
    expect(screen.queryByLabelText('Existencias iniciales')).toBeNull();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Guardar producto' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const lastInput = vi.mocked(invoke).mock.calls.filter(([command]) => command === 'save_product').at(-1)?.[1] as { input: Record<string, unknown> };
    expect(lastInput.input).not.toHaveProperty('stock'); expect(lastInput.input).not.toHaveProperty('category');
    expect(lastInput.input).toMatchObject({ id: 1, price: '12.35', initialStock: 0 });
  });
  it('cobra, muestra el cambio y limpia el intento pendiente al recibir comprobante', async () => {
    await startSale(); expect(screen.getByRole('status', { name: 'Cambio' }).textContent).toBe('7.65 MXN');
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar venta' }));
    expect(await screen.findByRole('dialog', { name: 'Comprobante V-00000001' })).toBeTruthy();
    expect(localStorage.getItem('tcg-pos.pending-checkout.v1')).toBeNull();
    expect(invoke).toHaveBeenCalledWith('checkout', expect.objectContaining({ input: expect.objectContaining({ lines: [{ productId: 1, quantity: 1, price: 1235 }], received: '20.00' }) }));
  });
  it('conserva el mismo identificador y contenido ante una respuesta desconocida', async () => {
    const implementation = vi.mocked(invoke).getMockImplementation()!;
    const attempts: Checkout[] = [];
    vi.mocked(invoke).mockImplementation((command, args) => { if (command !== 'checkout') return implementation(command, args); attempts.push((args as { input: Checkout }).input); return attempts.length === 1 ? Promise.reject(new Error('Respuesta perdida')) : Promise.resolve(receipt); });
    await startSale(); fireEvent.click(screen.getByRole('button', { name: 'Confirmar venta' }));
    await screen.findByRole('alert');
    expect(screen.getByLabelText('Importe recibido').matches(':disabled')).toBe(true);
    expect(localStorage.getItem('tcg-pos.pending-checkout.v1')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar mismo cobro' }));
    await screen.findByRole('dialog', { name: 'Comprobante V-00000001' });
    expect(attempts).toHaveLength(2); expect(attempts[0]).toEqual(attempts[1]);
  });
  it('permite corregir el carrito si Rust confirma que no se registró la venta', async () => {
    const implementation = vi.mocked(invoke).getMockImplementation()!;
    vi.mocked(invoke).mockImplementation((command, args) => command === 'checkout' ? Promise.reject({ message: 'Existencias insuficientes', definite: true }) : implementation(command, args));
    await startSale(); fireEvent.click(screen.getByRole('button', { name: 'Confirmar venta' }));
    await screen.findByRole('alert');
    expect(screen.getByLabelText('Importe recibido')).toHaveProperty('disabled', false);
    expect(localStorage.getItem('tcg-pos.pending-checkout.v1')).toBeNull();
  });
  it('recupera el intento pendiente después de desmontar y volver a abrir la interfaz', async () => {
    const implementation = vi.mocked(invoke).getMockImplementation()!;
    const attempts: Checkout[] = [];
    vi.mocked(invoke).mockImplementation((command, args) => { if (command !== 'checkout') return implementation(command, args); attempts.push((args as { input: Checkout }).input); return attempts.length === 1 ? Promise.reject(new Error('Respuesta perdida')) : Promise.resolve(receipt); });
    await startSale(); fireEvent.click(screen.getByRole('button', { name: 'Confirmar venta' })); await screen.findByRole('alert');
    cleanup(); render(<App />); await navigate('Punto de venta');
    fireEvent.click(await screen.findByRole('button', { name: 'Reintentar mismo cobro' }));
    await screen.findByRole('dialog', { name: 'Comprobante V-00000001' });
    expect(attempts[0]).toEqual(attempts[1]);
  });
  it('no registra tarjeta sin confirmar el pago recibido', async () => {
    await startSale(); fireEvent.change(screen.getByLabelText('Método de pago'), { target: { value: 'card' } });
    expect(screen.getByRole('button', { name: 'Confirmar venta' })).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByRole('checkbox', { name: /Pago recibido/ }));
    expect(screen.getByRole('button', { name: 'Confirmar venta' })).toHaveProperty('disabled', false);
  });
  it('actualiza el carrito por identificador aunque el SKU coincida con muchos resultados de búsqueda', async () => {
    const implementation = vi.mocked(invoke).getMockImplementation()!;
    vi.mocked(invoke).mockImplementation((command, args) => command === 'get_product' ? Promise.resolve({ ...p, price: 2345 }) : implementation(command, args));
    await startSale(); fireEvent.click(screen.getByRole('button', { name: 'Actualizar precios' }));
    expect(await screen.findByText('Carrito actualizado')).toBeTruthy();
    expect(screen.getByRole('status', { name: 'Total' }).textContent).toBe('23.45 MXN');
    expect(invoke).toHaveBeenCalledWith('get_product', { id: 1 });
  });
  it('exige mercancía disponible y dinero devuelto antes de anular', async () => {
    render(<App />); await navigate('Historial');
    fireEvent.click(await screen.findByRole('button', { name: 'Ver' }));
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Anular venta' }); expect(confirm).toHaveProperty('disabled', true);
    fireEvent.change(within(dialog).getByLabelText('Motivo'), { target: { value: 'Devolución completa' } });
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Toda la mercancía/ })); expect(confirm).toHaveProperty('disabled', true);
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Devolví el dinero/ })); fireEvent.click(confirm);
    expect(await within(dialog).findByText('Anulada')).toBeTruthy();
    expect(invoke).toHaveBeenCalledWith('cancel_sale', { id: 1, reason: 'Devolución completa', restocked: true, refunded: true });
  });
  it('cambia entre modo claro y oscuro y recuerda la elección en este equipo', async () => {
    render(<App />);
    const sidebar = (await screen.findByRole('navigation', { name: 'Navegación principal' })).parentElement!;
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar a modo claro' }));
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(localStorage.getItem('tcg-pos.theme.v1')).toBe('light');
    fireEvent.click(within(sidebar).getByRole('button', { name: 'Configuración' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Sistema' }));
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    expect(localStorage.getItem('tcg-pos.theme.v1')).toBeNull();
  });
  it('crea una categoría desde la plantilla de cartas', async () => {
    render(<App />); await navigate('Catálogo');
    fireEvent.click(await screen.findByRole('tab', { name: 'Categorías' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Nueva categoría' })[0]);
    const dialog = await screen.findByRole('dialog', { name: 'Nueva categoría' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cartas TCG' }));
    expect(within(dialog).getByLabelText('Nombre')).toHaveProperty('value', 'Cartas TCG');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Quitar Acabado' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar categoría' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const { input } = vi.mocked(invoke).mock.calls.find(([command]) => command === 'save_category')?.[1] as { input: { name: string; parentId: number | null; attributes: { name: string; kind: string; options: string[] }[] } };
    expect(input.name).toBe('Cartas TCG'); expect(input.parentId).toBeNull();
    expect(input.attributes.map((a) => a.name)).toEqual(['Juego', 'Expansión', 'Número', 'Idioma', 'Condición']);
    expect(input.attributes[4]).toMatchObject({ kind: 'list', options: ['NM', 'LP', 'MP', 'HP', 'DMG'] });
  });
  it('pide los atributos de la categoría y la superior al guardar un producto', async () => {
    categories = [
      { id: 7, name: 'Cartas', parentId: null, productCount: 0, attributes: [{ id: 1, name: 'Condición', kind: 'list', options: ['NM', 'LP'], required: true }] },
      { id: 8, name: 'Pokémon', parentId: 7, productCount: 0, attributes: [{ id: 2, name: 'Número', kind: 'text', options: [], required: false }] },
    ];
    render(<App />); await navigate('Catálogo');
    fireEvent.click(await screen.findByRole('button', { name: 'Nuevo producto' }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByRole('option', { name: 'Cartas › Pokémon' });
    fireEvent.change(within(dialog).getByLabelText('Categoría'), { target: { value: '8' } });
    fireEvent.change(within(dialog).getByLabelText('Condición'), { target: { value: 'LP' } });
    fireEvent.change(within(dialog).getByLabelText('Número (opcional)'), { target: { value: '25' } });
    fireEvent.change(within(dialog).getByLabelText('SKU'), { target: { value: 'PIKA' } });
    fireEvent.change(within(dialog).getByLabelText('Nombre'), { target: { value: 'Pikachu' } });
    fireEvent.change(within(dialog).getByLabelText(/Precio/), { target: { value: '45' } });
    fireEvent.change(within(dialog).getByLabelText('Etiquetas (opcional)'), { target: { value: 'vitrina, , preventa' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar producto' }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('save_product', expect.objectContaining({ input: expect.objectContaining({
      categoryId: 8, tags: ['vitrina', 'preventa'], attributes: [{ attributeId: 1, value: 'LP' }, { attributeId: 2, value: '25' }],
    }) })));
  });
  it('exige confirmación escrita antes de restaurar', async () => {
    render(<App />); await navigate('Respaldos'); fireEvent.click(screen.getByRole('button', { name: 'Seleccionar respaldo' }));
    const dialog = await screen.findByRole('dialog', { name: 'Restaurar respaldo' });
    const button = within(dialog).getByRole('button', { name: 'Restaurar' }); expect(button).toHaveProperty('disabled', true);
    fireEvent.change(within(dialog).getByLabelText('Escribe REEMPLAZAR'), { target: { value: 'REEMPLAZAR' } }); expect(button).toHaveProperty('disabled', false);
    expect(vi.mocked(invoke).mock.calls.some(([command]) => command === 'restore_backup')).toBe(false);
  });
});

describe('importes y fecha del negocio en interfaz', () => {
  it('no usa flotantes para interpretar dinero ni redondea fracciones extra', () => {
    expect(parseMoney('0.10', 2)).toBe(10n); expect(parseMoney('1.001', 2)).toBeNull(); expect(parseMoney('1.0', 0)).toBeNull(); expect(parseMoney('-1', 2)).toBeNull(); expect(decimal(-1235, 2)).toBe('-12.35');
  });
  it('genera fechas ISO usando la zona del negocio', () => { expect(today('America/Tijuana')).toMatch(/^\d{4}-\d{2}-\d{2}$/); });
});
