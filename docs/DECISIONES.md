# Decisiones y progreso

15 de octubre de 2026.

## Alcance acordado

- Windows 11 x64; una PC offline, laptop modesta como objetivo. No se han medido mínimos de RAM o CPU.
- Giro libre configurado desde el sistema. Productos generales, categorías editables y variante libre con SKU y saldo propios. Cartas TCG opcionales con juego, expansión, número, idioma, condición y acabado.
- Se conserva el identificador `com.tcgpos.desktop` y el nombre provisional TCG POS para mantener la continuidad de los datos.
- Precios finales con impuestos incluidos. Sin cálculo o desglose fiscal, conexión bancaria ni facturación.
- Moneda única seleccionada explícitamente entre MXN, USD, EUR, CAD, GBP y JPY. No hay conversiones.
- Zona IANA configurable; valor inicial America/Tijuana, confirmado por el usuario. Se bloquea tras la primera venta para mantener los límites históricos de cada día.
- La moneda se bloquea desde el primer producto, incluso antes de vender: cambiarla reinterpretaría precios y costos guardados. No se convierten importes silenciosamente.
- Captura manual. El usuario pidió **no implementar importación CSV**; esto no afecta la exportación de operaciones.
- Cantidades enteras. Venta por peso, servicios y reglas especiales de un giro requieren definir una ampliación.

## Reglas implementadas

- Dinero en enteros de unidades mínimas en Rust y SQLite. Entradas decimales como texto, sin flotantes ni redondeo implícito. Hasta 2 decimales para MXN/USD/EUR/CAD/GBP; 0 para JPY.
- Precio de venta mayor que cero; costo de referencia puede ser cero. Hasta 9,000,000,000,000 unidades mínimas por importe/venta. No se implementan utilidades ni costeo contable.
- Hasta 200 partidas por carrito y 1,000,000 de unidades por partida o movimiento. Saldo acumulado máximo de 1,000,000,000 unidades por producto. Los límites también se validan en Rust/SQLite.
- Cada saldo inicial positivo genera movimiento. Un saldo inicial cero no representa cambio y no genera movimiento. Después del alta, solo entradas/ajustes trazables cambian existencias.
- SKU único sin distinción ASCII de mayúsculas, normalizado a mayúsculas: letras sin acentos, números, guion, punto y guion bajo. No hay eliminación de productos; se desactivan y se conserva el historial.
- Idiomas TCG: es/en/ja/fr/de/it/pt/ko/zh; condición NM/LP/MP/HP/DMG; acabado normal/foil/reverse/etched/other. Los campos libres describen el resto de la variante.
- Ventas y anulaciones usan transacciones IMMEDIATE, claves foráneas, restricciones y movimientos inmutables. Ningún fallo parcial deja ventas, partidas o movimientos a medias.
- El cobro verifica actividad, precio esperado, stock, moneda, pago y límites en Rust. Un cambio de precio exige actualizar y revisar el carrito.
- Cada intento lleva identificador único y contenido normalizado. Repetirlo devuelve la venta existente; cambiar su contenido produce error. El frontend guarda el intento antes de enviarlo, incluso para recuperarlo tras recargar.
- Si Rust confirma que una solicitud falló sin registrar venta, permite corregir el carrito. Ante respuesta desconocida conserva y reintenta el mismo contenido; no debe cobrarse otra vez al cliente.
- Venta conserva moneda, nombre del negocio, SKU/nombre/variante/atributos y precios históricos. Editar el catálogo no modifica comprobantes.
- Tarjeta/transferencia requieren confirmar recepción manual. Un solo método por venta.
- Anulación completa: motivo, mercancía disponible y devolución del importe original confirmadas. Se guarda la devolución y se restituye inventario una sola vez. El operador ejecuta el reembolso; la aplicación no contacta al banco.
- Reportes: ventas por fecha de venta, anulaciones por fecha de anulación, neto = ventas menos anulaciones del período. Puede ser negativo; no representa utilidad ni caja.
- Historial incluye ventas realizadas o anuladas en el período; folio/estado filtran la lista. Los indicadores y CSV siempre abarcan todo el período consultado, como indica la pantalla.
- CSV UTF-8 con BOM, comillas escapadas y protección de celdas textuales que comiencen con caracteres de fórmula. Distingue referencia de evento, folio de venta, fechas UTC/local, zona, moneda, método, importe, estado actual y motivo.

## Datos y recuperación

- SQLite embebido, foreign_keys ON y synchronous FULL. Una conexión protegida por mutex; plugin de instancia única antes de abrir datos. Bases de desarrollo y producción separadas, sin ejemplos en producción.
- Migraciones 001–003 versionadas y transaccionales. Antes de transformar una base existente se crea un snapshot consistente con VACUUM INTO, se sincroniza y se verifica su integridad.
- Si la migración o apertura falla, la interfaz muestra error y no permite operar sobre el esquema incompleto. Los errores técnicos se escriben en `errors.log` junto a la base, con rotación.
- Respaldos manuales mediante la API online de SQLite. No se sobrescriben archivos existentes: seleccionar un nombre nuevo.
- Restauración: snapshot privado del archivo elegido, application_id, versión, esquema, integridad, claves foráneas y conciliación de saldos/importes. Admite respaldos del esquema actual (3); rechaza otros formatos/versiones con mensaje.
- Confirmación escrita REEMPLAZAR. Antes de reemplazar se crea copia de recuperación; sin ella se cancela. El mutex bloquea los demás casos de uso; todos los statements están cerrados antes de usar la API de restauración transaccional. No es necesario reemplazar el archivo abierto ni manipular manualmente sus journals.
- Si falla la aplicación del snapshot se revierte/recupera desde la copia previa. Tras restaurar se recarga la interfaz y se descarta el intento de cobro local que pertenecía a la base reemplazada.
- No hay actualizaciones automáticas. Conservar identificador y directorio de datos al instalar versiones nuevas.

## Estado

- A–E: implementación funcional en código, pruebas automatizadas y empaquetado NSIS con WebView2 offline.
- Pruebas Rust: reglas, atomicidad, concurrencia, fechas/DST, respaldo/restauración, migraciones y terminación abrupta de un proceso.
- Pruebas React: navegación, preferencias, productos, cobro, reintentos persistentes, pagos, anulación y confirmación de restauración; puente Tauri simulado.
- **Pendientes de aceptación:** ventana nativa y sus diálogos, instancia única en uso real, revisión visual, instalación offline en Windows 11 limpio, actualización conservando datos y medición en el hardware objetivo. Las pruebas de interfaz no sustituyen esas verificaciones.
- Fuera del MVP: activación/licencias, actualizaciones automáticas, servidor/sincronización, usuarios/roles, compras/proveedores, caja, devoluciones parciales, pagos mixtos, descuentos/crédito, periféricos, integraciones y utilidad contable.

## Referencias oficiales

- https://v2.tauri.app/distribute/windows-installer/
- https://v2.tauri.app/plugin/dialog/
- https://www.sqlite.org/backup.html
- https://www.sqlite.org/lang_vacuum.html
- https://docs.rs/rusqlite/0.40.2/rusqlite/backup/index.html
- https://docs.rs/chrono/latest/chrono/offset/enum.LocalResult.html
- https://www.six-group.com/en/products-services/financial-information/data-standards.html
- https://vitest.dev/guide/environment
- https://testing-library.com/docs/react-testing-library/setup/
