$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$rustBin = Join-Path $env:USERPROFILE '.cargo\bin'
$nodeBin = 'C:\laragon\bin\nodejs\node-v24.14.0'
if (Test-Path -LiteralPath $rustBin) { $env:PATH = "$rustBin;$env:PATH" }
if (Test-Path -LiteralPath $nodeBin) { $env:PATH = "$nodeBin;$env:PATH" }

# Liberar el puerto 1420 si lo ocupa un Vite huérfano de este proyecto.
$devPort = 1420
Get-NetTCPConnection -LocalPort $devPort -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique |
    ForEach-Object {
        $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$_" -ErrorAction SilentlyContinue
        if ($proc -and $proc.CommandLine -like "*$projectRoot*vite*") {
            Write-Host "Deteniendo Vite huérfano (PID $_) en el puerto $devPort..."
            Stop-Process -Id $_ -Force
            Start-Sleep -Milliseconds 500
        } elseif ($proc) {
            throw "El puerto $devPort está ocupado por otro proceso (PID $_): $($proc.CommandLine)"
        }
    }

Push-Location -LiteralPath $projectRoot
try {
    if (-not (Get-Command cargo.exe -ErrorAction SilentlyContinue)) { throw 'Instala Rust MSVC y agrega .cargo\bin al PATH.' }
    if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) { throw 'Instala Node.js LTS compatible con Vite y agrega su carpeta al PATH.' }
    & npm.cmd run desktop:dev
    if ($LASTEXITCODE -ne 0) { throw "El desarrollo terminó con código $LASTEXITCODE." }
} finally {
    Pop-Location
}