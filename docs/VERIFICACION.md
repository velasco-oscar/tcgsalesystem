# Verificación del MVP — 15 de octubre de 2026

## Comprobado en este entorno

- `npm run build`: TypeScript y bundle Vite correctos.
- `npm test`: 15 pruebas de interfaz correctas con Vitest, jsdom y el puente Tauri simulado. No se utilizan datos simulados dentro de la aplicación de producción.
- `npm run test:rust`: 28 pruebas Rust correctas, incluyendo el auxiliar de terminación abrupta.
- `npm run check:rust`: Clippy correcto con advertencias como errores.
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`: correcto.
- `npm run desktop:build`: ejecutable release e instalador NSIS x64 generados con WebView2 offline. El primer intento de extraer NSIS falló por permisos; la compilación posterior con acceso a la caché de herramientas completó el empaquetado.
- No hay navegadores ni aplicaciones accesibles mediante la herramienta de revisión visual en esta sesión. No se ha dado por comprobada la distribución en una ventana nativa.

### Cobertura de comportamiento Rust

- Persistencia de preferencias, configuración inválida y rechazo de esquemas futuros.
- Migración de una base anterior conservando datos y creando respaldo previo.
- Fallo de respaldo o de migración sin dejar un esquema parcial.
- Dinero exacto, límites, decimales de moneda y rechazo de redondeos implícitos.
- SKU único, movimientos iniciales, saldos no negativos y conservación del historial.
- Búsqueda por nombres con mayúsculas acentuadas del español.
- Rechazo de sobreventa, productos desactivados, cambios de precio y pago insuficiente/no confirmado.
- Fallo inyectado a mitad de venta: no quedan venta, partidas ni movimientos parciales.
- Reintento del mismo cobro y rechazo de identificador reutilizado con otro contenido.
- Solicitudes concurrentes: una sola venta para el mismo intento y ninguna sobreventa entre intentos distintos.
- Edición de catálogo sin cambiar la copia histórica del comprobante.
- Anulación atómica, devolución original y restitución de existencias una sola vez, incluso con reintentos.
- Fechas independientes para ventas y anulaciones; neto negativo y días de 23/25 horas por cambio de horario.
- CSV escapado, importes exactos y texto que podría interpretarse como fórmula.
- Ciclo de respaldo/restauración, operación posterior y rechazo de archivos ajenos, inválidos, incompatibles, con esquema alterado o saldos inconsistentes.
- Restauración cancelada si no puede crear copia de recuperación.
- Cierre abrupto real de un proceso hijo con una transacción abierta: reapertura sin cambios parciales y base íntegra.

### Cobertura de interfaz

- Entrada al panel con preferencias completas y guardado inicial requerido.
- Error de guardado sin acceso al panel.
- Moneda/zona bloqueadas cuando corresponda.
- Alta/edición de producto con el contrato correcto, sin editar stock desde Catálogo.
- Cobro, cambio, comprobante y limpieza del intento confirmado.
- Actualización de precios/existencias del carrito por ID de producto, independiente de la paginación o coincidencias parciales del buscador.
- Respuesta desconocida conserva identificador/contenido, incluso tras desmontar y volver a abrir la interfaz.
- Error definitivo del backend permite corregir el carrito.
- Confirmación de tarjeta, de mercancía disponible/dinero devuelto y confirmación escrita para restaurar.

Estas pruebas no ejecutan el puente real de WebView2, los diálogos del sistema ni un instalador. Los límites de esa cobertura se mantienen explícitos.

## Aceptación manual pendiente en desarrollo

**No ejecutada ni aprobada todavía.** Usar la base de desarrollo aislada, sin datos reales del cliente.

1. Ejecutar `scripts/dev.ps1`; en una base nueva configurar nombre, giro, MXN y America/Tijuana. Guardar y verificar transición al menú.
2. Cerrar y abrir; verificar entrada directa a Inicio y persistencia. Abrir una segunda instancia: debe enfocar la primera.
3. Crear categoría General y un producto SKU TEST-01, precio 12.35, costo 4.00 y 5 unidades iniciales. Verificar movimiento inicial de +5.
4. Editar nombre/variante, desactivar, buscar incluyendo desactivados y reactivar. Verificar que moneda queda bloqueada desde el primer producto y que stock no puede editarse en Catálogo.
5. Registrar entrada +2 con motivo y ajuste -1; saldo esperado 6. Intentar ajustar -7; debe rechazarse sin nuevo movimiento ni cambio de saldo.
6. Vender 2 unidades en efectivo, recibido 30.00. Total esperado 24.70, cambio 5.30 y saldo 4. Consultar comprobante en Historial.
7. Editar nombre y precio del producto. Abrir el comprobante anterior: debe conservar nombre/variante/precio originales.
8. Hacer una venta por tarjeta y otra por transferencia; no debe permitirse confirmar sin marcar que se recibió el pago.
9. Intentar vender más de lo disponible o un producto desactivado; debe rechazarse sin registros parciales.
10. Anular la venta original con motivo y ambas confirmaciones. Debe devolver exactamente 24.70 y restituir 2 unidades una sola vez. Reabrir detalle y comprobar que no permite otra anulación.
11. Consultar Historial/Reportes por fecha, folio y estado. Verificar que indicadores y CSV incluyen todo el período aunque la lista tenga filtros de folio/estado.
12. Exportar CSV mediante el diálogo nativo, abrirlo y revisar referencias V-/A-, fechas, importes y motivos con acentos/comillas. Seleccionar archivo existente: debe pedir elegir nombre nuevo y no sobrescribirlo.
13. Crear respaldo en otra carpeta. Registrar un producto adicional y restaurar el respaldo, escribiendo REEMPLAZAR. Verificar desaparición de ese producto de la base activa, recuperación de saldos/historial y existencia de la copia previa.
14. Intentar restaurar un archivo de texto, otra SQLite y una versión incompatible; deben rechazarse conservando los datos actuales.
15. Probar menú, formularios y diálogos a 1120×760 y 760×620, teclado/Tab/Escape, textos largos, desplazamiento y Configuración al pie. Verificar que no hay desbordamiento horizontal del documento; las tablas pueden desplazarse dentro de su contenedor.
16. Abrir la vista web con `npm run dev`: debe advertir que es vista previa, sin habilitar guardado ni operaciones reales.

## Aceptación pendiente del instalador en Windows 11 limpio

**No se dispone de esa PC/VM en esta sesión. No se afirma que el MVP esté listo para ventas reales hasta completar esta aceptación.**

1. Crear una VM o PC Windows 11 x64 sin Node.js, Rust, Build Tools ni servidores. Preparar también una instantánea sin WebView2, cuando sea posible.
2. Copiar el instalador `src-tauri/target/release/bundle/nsis/TCG POS_0.1.0_x64-setup.exe` y desconectar internet **antes** de instalarlo.
3. Instalar como usuario normal, verificar instalación de WebView2 cuando falte, abrir y completar los pasos 1–14 anteriores. Probar también sin permisos administrativos para el uso diario.
4. Cerrar y reiniciar Windows; verificar que preferencias, catálogo, saldos, ventas y anulaciones se conservan.
5. Crear respaldo. Producir una siguiente versión de prueba cambiando coherentemente las versiones de package.json, Cargo.toml y tauri.conf.json (por ejemplo 0.1.1), sin cambiar `identifier`, rutas ni esquema. Instalarla encima y comprobar conservación de datos. Para probar una migración, usar además una base de desarrollo de esquema anterior y verificar la copia previa.
6. Medir arranque, consumo de memoria y tiempos de búsqueda/cobro con un catálogo representativo en la laptop modesta objetivo. Documentar CPU/RAM, resolución, escala de pantalla, número de productos y resultados; no se han fijado mínimos por falta de medición.
7. Registrar versión de Windows, WebView2, instalador, hash SHA-256 y resultado de cada paso. Conservar capturas y errores antes de autorizar uso con datos reales.

## Reproducir comprobaciones automatizadas

```powershell
$env:PATH = "C:\laragon\bin\nodejs\node-v24.14.0;$env:USERPROFILE\.cargo\bin;$env:PATH"
npm ci
npm run build
npm test
npm run test:rust
npm run check:rust
cargo fmt --manifest-path src-tauri/Cargo.toml --check
npm run desktop:build
Get-FileHash -Algorithm SHA256 -LiteralPath 'src-tauri/target/release/bundle/nsis/TCG POS_0.1.0_x64-setup.exe'
```

Las herramientas de desarrollo y acceso inicial a registros/cachés corresponden al desarrollador, no al cliente. No es necesario desactivar protecciones de Windows para ejecutar estas instrucciones.
