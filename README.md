# TCG POS

Punto de venta local de giro configurable para **Windows 11 x64**, una PC y operación offline. TCG POS es el nombre provisional; los productos pueden pertenecer a cualquier giro.

El código del MVP está implementado. La compilación, las pruebas automatizadas y la generación del instalador se verificaron; **la aceptación en Windows 11 limpio sin internet, la revisión visual de la ventana nativa y el rendimiento en una laptop modesta siguen pendientes**. Consultar [verificación](docs/VERIFICACION.md).

## Funciones

- Preferencias iniciales y edición desde el menú lateral: nombre, giro, moneda y zona horaria.
- Catálogo con SKU único, categorías editables, variantes, precio, costo informativo y activación/desactivación. Atributos de cartas TCG opcionales.
- Existencias iniciales, entradas y ajustes con motivo e historial. Sin existencias negativas ni edición directa del saldo.
- Carrito y venta en efectivo, tarjeta o transferencia. Cálculos y validación en Rust; comprobante en pantalla.
- Cobro idempotente, con intento persistido antes de enviarlo y reintento del mismo contenido ante respuesta desconocida.
- Anulación completa con mercancía disponible y devolución del importe confirmadas por el operador. Sin reembolso bancario automático.
- Historial, ventas y anulaciones por su propia fecha, neto por período y CSV.
- Respaldo manual, restauración validada con copia previa de recuperación y migraciones con respaldo automático.
- Registro local de errores, instancia única y datos separados de los archivos del programa.

Precios finales con impuestos incluidos. Cantidades enteras. Sin importación CSV por decisión del usuario, compras, cuentas, caja, pagos mixtos, descuentos, integración bancaria, impresoras ni facturación fiscal.

## Para operar

Instalar el archivo `src-tauri/target/release/bundle/nsis/TCG POS_0.1.0_x64-setup.exe`. El instalador incluye WebView2 offline. El cliente no necesita Node.js, Rust, Laragon ni un servidor. Leer el [manual de operación](docs/MANUAL.md).

La primera instalación no carga ejemplos. Los datos de producción se guardan en `%LOCALAPPDATA%\com.tcgpos.desktop\`; desarrollo utiliza la subcarpeta `development`. No seleccionar la opción de eliminar los datos de la aplicación al desinstalar si se desea conservarlos.

## Para desarrollar

Stack: Tauri 2, React 19, TypeScript, Vite, Rust y SQLite embebido mediante rusqlite. Se requieren Node.js compatible con Vite, Rust MSVC estable, Microsoft C++ Build Tools, Windows SDK y WebView2. [Requisitos oficiales](https://v2.tauri.app/start/prerequisites/).

En este equipo:

```powershell
cd C:\laragon\www\tcg-pos
.\scripts\dev.ps1
```

Comandos manuales:

```powershell
$env:PATH = "C:\laragon\bin\nodejs\node-v24.14.0;$env:USERPROFILE\.cargo\bin;$env:PATH"
npm ci
npm run desktop:dev
```

`npm run dev` abre solo una vista previa web; no simula datos ni habilita la operación del POS. Las pruebas de interfaz utilizan un puente simulado exclusivamente dentro del entorno de pruebas.

## Pruebas y compilación

```powershell
npm run build
npm test
npm run test:rust
npm run check:rust
cargo fmt --manifest-path src-tauri/Cargo.toml --check
npm run desktop:build
```

La compilación inicial necesita internet para descargar dependencias y herramientas de empaquetado. El instalador resultante está configurado para ejecución offline, sin firma comercial de código. No entregar a clientes sin completar la [aceptación reproducible](docs/VERIFICACION.md).

## Estructura

```text
src/components/            Configuración e iconos
src/features/Operations.tsx Catálogo, inventario, ventas, historial y respaldos
src/lib/                  Contratos Tauri y utilidades de presentación
src-tauri/src/commands.rs  Entrada a los casos de uso y diálogos locales
src-tauri/src/pos.rs       Validación, reglas y transacciones de negocio
src-tauri/src/models.rs    Contratos de datos
src-tauri/src/repository.rs Consultas y escrituras parametrizadas
src-tauri/src/db.rs        Conexión, configuración persistida y migraciones
src-tauri/src/backups.rs   Respaldo, validación y recuperación
src-tauri/src/logging.rs   Registro local de errores
src-tauri/migrations/      Esquema versionado
src-tauri/src/pos_tests.rs Pruebas de comportamiento y fallos
tests/pos.test.tsx         Pruebas de interfaz con puente simulado
```

Las decisiones y límites se documentan en [DECISIONES.md](docs/DECISIONES.md).
