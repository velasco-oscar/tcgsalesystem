import { invoke } from '@tauri-apps/api/core';
export type AttributeKind = 'text' | 'number' | 'list';
export interface Attribute { id: number; name: string; kind: AttributeKind; options: string[]; required: boolean }
export interface AttributeInput { id: number | null; name: string; kind: AttributeKind; options: string[]; required: boolean }
export interface AttributeValue { attributeId: number; name: string; kind: AttributeKind; value: string }
export interface Category { id: number; name: string; parentId: number | null; attributes: Attribute[]; productCount: number }
export interface CategoryInput { id: number | null; name: string; parentId: number | null; attributes: AttributeInput[] }
export interface Product { id: number; sku: string; name: string; categoryId: number | null; category: string | null; variant: string; attributes: AttributeValue[]; tags: string[]; price: number; cost: number; stock: number; active: boolean }
export interface ProductInput { id: number | null; sku: string; name: string; categoryId: number | null; variant: string; attributes: { attributeId: number; value: string }[]; tags: string[]; price: string; cost: string; initialStock: number; active: boolean }
export interface Movement { id: number; createdAt: string; quantity: number; kind: string; reason: string; saleId: number | null; cancellationId: number | null }
export interface CartLine { productId: number; quantity: number; price: number }
export interface Checkout { requestId: string; currencyCode: string; lines: CartLine[]; method: string; received: string; paymentConfirmed: boolean }
export interface SaleItem { productId: number; sku: string; name: string; variant: string; attributes: AttributeValue[]; quantity: number; price: number }
export interface Cancellation { id: number; createdAt: string; reason: string; refund: number; method: string }
export interface Sale { id: number; folio: string; createdAt: string; currencyCode: string; storeName: string; method: string; total: number; received: number | null; change: number | null; items: SaleItem[]; cancellation: Cancellation | null }
export interface SaleSummary { id: number; folio: string; createdAt: string; currencyCode: string; method: string; total: number; cancelledAt: string | null }
export interface Period { from: string; to: string; folio: string; status: string; offset: number }
export interface Report { salesCount: number; salesTotal: number; cancellationsCount: number; cancellationsTotal: number; net: number; timeZone: string }
export const getProducts = (search = '', includeInactive = true, offset = 0, categoryId: number | null = null) => invoke<Product[]>('get_products', { search, includeInactive, categoryId, offset });
export const getCategories = () => invoke<Category[]>('get_categories');
export const getProduct = (id: number) => invoke<Product>('get_product', { id });
export const saveCategory = (input: CategoryInput) => invoke<number>('save_category', { input });
export const deleteCategory = (id: number) => invoke<void>('delete_category', { id });
export const saveProduct = (input: ProductInput) => invoke<number>('save_product', { input });
export const getMovements = (productId: number, offset = 0) => invoke<Movement[]>('get_movements', { productId, offset });
export const recordStock = (productId: number, quantity: number, kind: string, reason: string) => invoke<void>('record_stock', { productId, quantity, kind, reason });
export const checkout = (input: Checkout) => invoke<Sale>('checkout', { input });
export const getSale = (id: number) => invoke<Sale>('get_sale', { id });
export const cancelSale = (id: number, reason: string, restocked: boolean, refunded: boolean) => invoke<Sale>('cancel_sale', { id, reason, restocked, refunded });
export const getHistory = (period: Period) => invoke<SaleSummary[]>('get_history', { period });
export const getReport = (period: Period) => invoke<Report>('get_report', { period });
export const exportReport = (period: Period) => invoke<string | null>('export_report', { period });
export const createBackup = () => invoke<string | null>('create_backup');
export const chooseRestore = () => invoke<string | null>('choose_restore');
export const restoreBackup = (path: string, confirmed: boolean) => invoke<string>('restore_backup', { path, confirmed });
export const paymentName = (method: string) => ({ cash: 'Efectivo', card: 'Tarjeta', transfer: 'Transferencia' })[method] ?? method;
export const movementName = (kind: string) => ({ initial: 'Inicial', entry: 'Entrada', adjustment: 'Ajuste', sale: 'Venta', cancellation: 'Anulación' })[kind] ?? kind;
export function decimal(value: number, digits: number): string {
  const sign = value < 0 ? '-' : '';
  const absolute = Math.abs(value);
  const scale = 10 ** digits;
  return sign + Math.floor(absolute / scale) + (digits ? '.' + String(absolute % scale).padStart(digits, '0') : '');
}
export function parseMoney(value: string, digits: number): bigint | null {
  if (!/^\d+(\.\d*)?$/.test(value) || (digits === 0 && value.includes('.'))) return null;
  const [whole, fraction = ''] = value.split('.');
  if (fraction.length > digits) return null;
  const result = BigInt(whole) * 10n ** BigInt(digits) + BigInt(fraction.padEnd(digits, '0') || '0');
  return result <= 9_000_000_000_000n ? result : null;
}
// Solo para mostrar: agrupa miles con coma; los formularios siguen usando decimal() sin separadores.
export function displayMoney(value: number, code: string, digits: number) { return `${decimal(value, digits).replace(/\B(?=(\d{3})+(?!\d))(?=\d*(\.|$))/g, ',')} ${code}`; }
export function dateTime(value: string, timeZone: string) { return new Intl.DateTimeFormat('es-MX', { timeZone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)); }
export function today(timeZone: string) { const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()); return ['year', 'month', 'day'].map((type) => parts.find((p) => p.type === type)?.value).join('-'); }
// Atributos de una categoría y su superior, en el mismo orden que usa el backend.
export function categoryAttributes(categories: Category[], categoryId: number | null): Attribute[] {
  const category = categories.find((c) => c.id === categoryId);
  if (!category) return [];
  const parent = categories.find((c) => c.id === category.parentId);
  return [...(parent?.attributes ?? []), ...category.attributes];
}
export function categoryPath(categories: Category[], category: Category) {
  const parent = categories.find((c) => c.id === category.parentId);
  return parent ? `${parent.name} › ${category.name}` : category.name;
}
// Superiores ordenadas por nombre, cada una seguida de sus subcategorías.
export function sortedCategories(categories: Category[]) {
  return categories.filter((c) => c.parentId === null).flatMap((parent) => [parent, ...categories.filter((c) => c.parentId === parent.id)]);
}
