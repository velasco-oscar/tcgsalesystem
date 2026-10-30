# Manual de operación del MVP

## Primer inicio

1. Instala TCG POS en Windows 11 x64 usando el instalador proporcionado. El cliente no necesita herramientas de desarrollo ni servidor.
2. Abre la aplicación. Escribe el nombre, giro y moneda del negocio. La zona inicial es America/Tijuana y puede cambiarse antes de vender.
3. Pulsa **Guardar y entrar**. El menú lateral abre Inicio, Punto de venta, Catálogo, Inventario, Historial, Reportes y Respaldos. Configuración está al pie del menú.
4. Al volver a abrir, se cargan las preferencias guardadas. La moneda queda bloqueada al crear el primer producto; la zona, al registrar la primera venta. El nombre y el giro pueden editarse posteriormente.

Se admiten MXN, USD, EUR, CAD, GBP y JPY. Los importes se escriben sin símbolos ni separadores de miles, con punto decimal. JPY usa unidades enteras; las demás opciones admiten hasta dos decimales. Los precios finales incluyen impuestos y no se añade otro cargo fiscal al cobrar.

## Catálogo

- Crea tus categorías o renómbralas en **Catálogo → Categorías del negocio**.
- Pulsa **Nuevo producto**. Captura SKU, nombre, categoría opcional, variante, precio, costo informativo y existencias iniciales.
- Cada variante que se venda por separado necesita un SKU distinto: por ejemplo, una talla, color, presentación o edición.
- SKU: hasta 60 caracteres; letras sin acentos, números, guion, punto o guion bajo. Se normaliza a mayúsculas.
- Precio mayor que cero. El costo puede ser cero y no se usa para calcular utilidad.
- Para cartas individuales activa la opción TCG y completa juego, expansión, número, idioma, condición y acabado. Para productos generales, sellados o accesorios basta con categorías y variantes.
- **Editar** cambia los datos del producto. Desmarca **Producto activo** para impedir nuevas ventas. Incluye desactivados en la búsqueda si necesitas reactivarlo.
- Los productos se conservan; no hay eliminación. Editarlos no cambia comprobantes anteriores.

Las listas muestran 100 registros por página. Usa búsqueda por nombre/SKU y los botones de página. No hay importación CSV en esta versión.

## Inventario

1. Busca un producto en **Inventario** y abre **Movimientos**.
2. Elige **Entrada de mercancía** para sumar unidades o **Ajuste manual** para sumar/restar una diferencia de conteo.
3. Escribe una cantidad entera distinta de cero y un motivo. En ajustes, una cantidad negativa resta unidades.
4. Pulsa **Registrar movimiento**. El sistema rechaza cualquier operación que deje saldo negativo.
5. Consulta fechas, cantidades, motivos y referencias a ventas/anulaciones en el mismo historial.

No cambies el saldo desde el producto. Las existencias iniciales positivas también quedan registradas como movimiento. Cada partida o movimiento admite hasta un millón de unidades.

## Venta

1. Abre **Punto de venta**. Busca por nombre o SKU y selecciona productos para agregarlos al carrito.
2. Revisa cantidades, precios, subtotales y total. Puedes quitar productos. El sistema solo permite productos activos y revalida todo al confirmar.
3. Elige un único método:
   - **Efectivo:** escribe lo recibido y revisa el cambio.
   - **Tarjeta o transferencia:** realiza/verifica el pago por tu procedimiento habitual y marca que lo recibiste. La aplicación no se conecta al banco.
4. Pulsa **Confirmar venta** y espera el comprobante con folio.
5. Si cambió un precio o stock, corrige el carrito o usa **Actualizar precios y existencias** y vuelve a revisar el total antes de cobrar.

### Si no llegó la respuesta

Si aparece un cobro pendiente, **no vuelvas a cobrar al cliente**. Pulsa **Reintentar mismo cobro**: conservará el identificador y el contenido para devolver la venta ya registrada o completar el intento una sola vez. El intento se conserva al volver a abrir la interfaz.

Si Rust confirma que la operación falló sin registrar una venta, se libera el carrito para corregirlo. Ante una respuesta desconocida queda bloqueado para reintentar exactamente el mismo cobro. No borres manualmente los datos de la aplicación mientras haya un intento pendiente.

El comprobante también puede consultarse en **Historial → Ver venta**. Es informativo, sin impresión ni facturación fiscal.

## Anulación completa

1. Localiza la venta en **Historial** y abre su detalle.
2. Procede solo si **toda** la mercancía permanece en la tienda o fue devuelta y está disponible para vender.
3. Devuelve al cliente el importe original completo por el medio de pago original. La aplicación no ejecuta reembolsos bancarios.
4. Escribe el motivo y confirma ambas condiciones.
5. Pulsa **Confirmar anulación completa**.

Se conserva la venta original, se registra la devolución del importe y se restituyen existencias una sola vez. No se admiten devoluciones parciales ni mercancía dañada dentro de este flujo.

## Historial, reportes y CSV

- Elige fechas desde/hasta y pulsa **Consultar**. Los días se calculan usando la zona horaria del negocio.
- Historial incluye ventas hechas o anuladas en ese período. Folio y estado filtran la lista de ventas.
- Los indicadores muestran **todos los folios y estados del período**: ventas realizadas, anulaciones registradas y neto.
- Una anulación posterior no reduce retroactivamente el bruto vendido el día de la venta. El neto puede ser negativo si se anulan ventas de días anteriores.
- Neto significa ventas menos anulaciones del período; **no es utilidad ni cierre de caja**.
- **Exportar CSV del período** guarda todos los eventos de ese período, con referencia de venta/anulación, folio de venta, fechas, zona, moneda, método, importe, estado actual y motivo. Elige un nombre nuevo.
- En el CSV los importes de las anulaciones son positivos y se distinguen por el tipo de evento; deben restarse para obtener el neto.

## Respaldos

### Crear

En **Respaldos → Crear respaldo**, elige un archivo nuevo. Guarda copias periódicas en otra unidad o dispositivo. El archivo contiene todos los datos del negocio. La aplicación crea una copia consistente aunque la base esté abierta.

### Restaurar

1. Espera a que terminen los cobros. No restaures durante una venta pendiente de resolver.
2. Pulsa **Seleccionar respaldo** y elige un archivo de esta aplicación y de la versión compatible.
3. El sistema comprueba identidad, versión, esquema e integridad. Esta versión admite respaldos de esquema 3; archivos anteriores o ajenos se rechazan.
4. Revisa la ruta. Escribe **REEMPLAZAR** y confirma.
5. Antes de reemplazar se guarda una copia de recuperación en la carpeta `backups` junto a la base actual. Sin esa copia, la restauración se cancela.
6. La interfaz se recarga con los datos restaurados. Verifica catálogo, inventario e historial antes de operar.

Restaurar sustituye los datos activos: las operaciones posteriores al respaldo dejan de estar en esa base. La copia de recuperación conserva el estado previo. Si la aplicación muestra un fallo, conserva esa copia y el registro de errores para diagnóstico.

## Archivos y actualización

- Datos de producción: `%LOCALAPPDATA%\com.tcgpos.desktop\tcg-pos.sqlite3`.
- Datos de desarrollo: subcarpeta `development` dentro de esa ubicación.
- Respaldos automáticos de migración y recuperación: carpeta `backups` junto a la base.
- Registro técnico: `errors.log` y, cuando exista, `errors.previous.log` en la misma carpeta.
- No copies solamente el archivo de una base en uso como procedimiento de respaldo; utiliza la función de la aplicación.
- Antes de actualizar, crea un respaldo, cierra la aplicación y conserva la carpeta de datos. Instala la nueva versión con el mismo identificador y ruta de datos. No hay actualizaciones automáticas.

La entrega requiere completar las pruebas de aceptación descritas en VERIFICACION.md antes del uso con ventas reales.
