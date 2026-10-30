import { useEffect, useRef, useState } from "react";
import { desktopAvailable, getAppStatus, type AppStatus, type StoreSettings } from "./lib/api";
import { Icon } from "./components/Icon";
import { SettingsForm } from "./components/SettingsForm";
import { BackupPanel, Catalog, History, Inventory, Sales, TodaySummary } from "./features/Operations";
import { useTheme, type ThemeChoice } from "./lib/theme";
import "./App.css";

type Page = "home" | "settings" | "sale" | "catalog" | "inventory" | "history" | "report" | "backup";

const modules: { label: string; icon: Exclude<Page, "home" | "settings">; group: "operation" | "consultation" }[] = [
  { label: "Punto de venta", icon: "sale", group: "operation" },
  { label: "Catálogo", icon: "catalog", group: "operation" },
  { label: "Inventario", icon: "inventory", group: "operation" },
  { label: "Historial", icon: "history", group: "consultation" },
  { label: "Reportes", icon: "report", group: "consultation" },
  { label: "Respaldos", icon: "backup", group: "consultation" },
];

function hasConfiguration(status: AppStatus | null): boolean {
  return !!status && !!status.settings.storeName.trim() && !!status.settings.businessSector.trim()
    && status.currencies.some((currency) => currency.code === status.settings.currencyCode);
}

// Marca: dos cartas abiertas en abanico, en un solo color.
function Brand() {
  return <><svg className="brand-icon" viewBox="0 0 24 24" aria-hidden="true">
    <rect x="3.5" y="5" width="10" height="14" rx="2" transform="rotate(-10 8.5 12)" fill="currentColor" opacity=".45" />
    <rect x="10" y="4" width="10" height="14" rx="2" transform="rotate(8 15 11)" fill="currentColor" />
  </svg><span className="brand-text">POS WIP</span></>;
}

const themeOptions: { value: ThemeChoice; label: string; icon: "monitor" | "sun" | "moon" }[] = [
  { value: "system", label: "Sistema", icon: "monitor" },
  { value: "light", label: "Claro", icon: "sun" },
  { value: "dark", label: "Oscuro", icon: "moon" },
];

function ThemeToggle({ resolved, onChange }: { resolved: "light" | "dark"; onChange: (choice: ThemeChoice) => void }) {
  const next = resolved === "dark" ? "light" : "dark";
  const label = next === "light" ? "Cambiar a modo claro" : "Cambiar a modo oscuro";
  return <button className="icon-button" aria-label={label} title={label} onClick={() => onChange(next)}><Icon name={next === "light" ? "sun" : "moon"} /></button>;
}

function longDate(timeZone: string) {
  return new Intl.DateTimeFormat("es-MX", { timeZone, day: "numeric", month: "long" }).format(new Date());
}

function App() {
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [loading, setLoading] = useState(desktopAvailable);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [page, setPage] = useState<Page>("home");
  const [collapsed, setCollapsed] = useState(false);
  const [welcome, setWelcome] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const theme = useTheme();
  const configured = hasConfiguration(status);

  useEffect(() => {
    if (!desktopAvailable) return;
    let active = true;
    setError("");
    getAppStatus()
      .then((result) => { if (active) setStatus(result); })
      .catch((reason: unknown) => { if (active) setError(String(reason)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [reload]);

  useEffect(() => {
    if (configured) heading.current?.focus();
  }, [page, configured]);

  function handleSaved(settings: StoreSettings) {
    setStatus((current) => current ? { ...current, settings } : current);
    if (!configured) {
      setPage("home");
      setWelcome(true);
    }
  }

  if (!configured || !status) {
    return <div className="onboarding-shell">
      <header className="onboarding-header"><div className="brand"><Brand /></div>
        <div className="header-actions"><span className="version-label">Configuración inicial</span><ThemeToggle resolved={theme.resolved} onChange={theme.setChoice} /></div></header>
      <main id="main-content" className="onboarding-content">
        <div className="intro">
          <h1>Prepara tu tienda <span>en este equipo</span></h1>
          <p>Nombre, giro, moneda y zona horaria de tu tienda. Se guardan en este equipo y solo se piden una vez.</p>
        </div>
        {!desktopAvailable && <div className="notice" role="status">Vista previa en navegador. Abre la aplicación de escritorio para guardar datos</div>}
        {loading ? <div className="loading-card" role="status">Abriendo tu espacio de trabajo…</div>
          : error ? <div className="notice error" role="alert"><p>{error}</p>
            <button className="secondary-button" onClick={() => { setError(""); setLoading(true); setReload((current) => current + 1); }}>Reintentar</button></div>
          : <SettingsForm status={status} initial onSaved={handleSaved} />}
      </main>
      <footer className="onboarding-footer">Versión {status?.version ?? "0.1.0"} · Desarrollado por Oscar Velasco</footer>
    </div>;
  }

  const title = page === "home" ? "Inicio" : page === "settings" ? "Configuración" : modules.find((item) => item.icon === page)?.label ?? "Inicio";
  const currency = status.currencies.find((item) => item.code === status.settings.currencyCode);
  const refreshStatus = () => setReload((current) => current + 1);

  return <div className={`workspace${collapsed ? " sidebar-collapsed" : ""}`}>
    <a className="skip-link" href="#main-content">Ir al contenido</a>
    <aside id="app-sidebar" className="sidebar" aria-label="Menú de la aplicación">
      <div className="sidebar-brand brand"><Brand /></div>
      <div className="sidebar-business"><strong title={status.settings.storeName}>{status.settings.storeName}</strong>
        <span title={status.settings.businessSector}>{status.settings.businessSector}</span></div>
      <nav className="sidebar-nav" aria-label="Navegación principal">
        <span className="nav-group-label">Operación</span>
        <button className={`nav-item${page === "home" ? " active" : ""}`} aria-label="Inicio" title="Inicio" aria-current={page === "home" ? "page" : undefined} onClick={() => setPage("home")}>
          <Icon name="home" /><span className="nav-label">Inicio</span>
        </button>
        {modules.filter((item) => item.group === "operation").map((item) => <button key={item.label} className={`nav-item${page === item.icon ? " active" : ""}`} aria-label={item.label} title={item.label} aria-current={page === item.icon ? "page" : undefined} onClick={() => setPage(item.icon)}>
          <Icon name={item.icon} /><span className="nav-label">{item.label}</span>
        </button>)}
        <span className="nav-group-label">Consultas y datos</span>
        {modules.filter((item) => item.group === "consultation").map((item) => <button key={item.label} className={`nav-item${page === item.icon ? " active" : ""}`} aria-label={item.label} title={item.label} aria-current={page === item.icon ? "page" : undefined} onClick={() => setPage(item.icon)}>
          <Icon name={item.icon} /><span className="nav-label">{item.label}</span>
        </button>)}
      </nav>
      <div className="sidebar-bottom">
        <button className={`nav-item${page === "settings" ? " active" : ""}`} aria-label="Configuración" title="Configuración" aria-current={page === "settings" ? "page" : undefined} onClick={() => setPage("settings")}>
          <Icon name="settings" /><span className="nav-label">Configuración</span>
        </button>
      </div>
    </aside>

    <div className="workspace-body">
      <header className="workspace-header">
        <button className="icon-button sidebar-toggle" aria-label={collapsed ? "Expandir menú lateral" : "Contraer menú lateral"} aria-expanded={!collapsed} aria-controls="app-sidebar" onClick={() => setCollapsed((current) => !current)}><Icon name="panel" /></button>
        <nav className="breadcrumb" aria-label="Ubicación">
          <Icon name={page} />
          {page !== "home" && <><button onClick={() => setPage("home")}>Inicio</button><span aria-hidden="true">/</span></>}
          <span aria-current="page">{title}</span>
        </nav>
        <div className="header-actions"><ThemeToggle resolved={theme.resolved} onChange={theme.setChoice} /></div>
      </header>

      <main id="main-content" className="workspace-content">
        <div className="page-heading">
          <h1 ref={heading} tabIndex={-1}>{page === "home" ? <>Hoy <span>{longDate(status.settings.timeZone)}</span></> : title}</h1>
          <p>{page === "settings" ? "Preferencias del punto de venta" : `${status.settings.storeName} · ${status.settings.timeZone}`}</p>
        </div>
        {error && <div className="notice error" role="alert">{error}</div>}
        {page === "settings" && <>
          <SettingsForm status={status} initial={false} onSaved={handleSaved} />
          <section className="workspace-card" aria-labelledby="appearance-title">
            <h2 id="appearance-title">Apariencia</h2>
            <p>Se guarda solo en este equipo. Sistema sigue el tema de Windows.</p>
            <div className="segmented" role="radiogroup" aria-labelledby="appearance-title">
              {themeOptions.map((option) => <button key={option.value} role="radio" aria-checked={theme.choice === option.value} onClick={() => theme.setChoice(option.value)}><Icon name={option.icon} />{option.label}</button>)}
            </div>
          </section>
        </>}
        {page === "catalog" && <Catalog status={status} onChanged={refreshStatus} />}
        {page === "inventory" && <Inventory status={status} onChanged={refreshStatus} />}
        {page === "sale" && <Sales status={status} onChanged={refreshStatus} />}
        {page === "history" && <History status={status} onChanged={refreshStatus} />}
        {page === "report" && <History status={status} onChanged={refreshStatus} reportOnly />}
        {page === "backup" && <BackupPanel />}
        {page === "home" && <>
          {welcome && <div className="notice success" role="status"><Icon name="check" />Configuración guardada. Empieza registrando productos en Catálogo</div>}
          <TodaySummary status={status} />
          <section className="workspace-card" aria-labelledby="business-title">
            <div className="card-heading"><h2 id="business-title">{status.settings.storeName}</h2>
              <button className="secondary-button" onClick={() => setPage("settings")}>Revisar configuración<Icon name="arrow" /></button></div>
            <dl className="store-facts">
              <div><dt>Giro</dt><dd>{status.settings.businessSector}</dd></div>
              <div><dt>Moneda</dt><dd>{status.settings.currencyCode} · {currency?.name}</dd></div>
              <div><dt>Precios</dt><dd>Impuestos incluidos</dd></div>
              <div><dt>Zona horaria</dt><dd>{status.settings.timeZone}</dd></div>
            </dl>
            <p>Las preferencias se guardan en este equipo. Puedes actualizarlas desde Configuración, al pie del menú lateral.</p>
          </section>
          <section className="workspace-card" aria-labelledby="quick-title">
            <h2 id="quick-title">Operación del negocio</h2>
            <p>Empieza registrando tus productos y existencias. Desde aquí puedes cobrar, consultar resultados y proteger tus datos.</p>
            <div className="quick-actions">{modules.map((item) => <button key={item.icon} className="secondary-button" onClick={() => setPage(item.icon)}><Icon name={item.icon} />{item.label}</button>)}</div>
          </section>
        </>}
      </main>
    </div>
  </div>;
}

export default App;
