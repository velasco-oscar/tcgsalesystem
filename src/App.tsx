import { useEffect, useRef, useState } from "react";
import { desktopAvailable, getAppStatus, type AppStatus, type StoreSettings } from "./lib/api";
import { Icon, type IconName } from "./components/Icon";
import { SettingsForm } from "./components/SettingsForm";
import { BackupPanel, Catalog, History, Inventory, Sales } from "./features/Operations";
import "./App.css";

type Page = "home" | "settings" | "sale" | "catalog" | "inventory" | "history" | "report" | "backup";

const modules: { label: string; icon: Exclude<IconName, "home" | "settings" | "panel" | "arrow" | "check">; group: "operation" | "consultation" }[] = [
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

function Brand() {
  return <><span className="brand-icon" aria-hidden="true">T</span>
    <span className="brand-text">TCG<span className="brand-light"> POS</span><small>Punto de venta local</small></span></>;
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
        <span className="version-label">CONFIGURACIÓN INICIAL</span></header>
      <main id="main-content" className="onboarding-content">
        <div className="intro"><span className="eyebrow">BIENVENIDO A TU PUNTO DE VENTA</span>
          <h1>Tu negocio.<br /><span>A tu manera.</span></h1>
          <p>Prepara tu espacio de trabajo. Solo necesitas configurar las preferencias iniciales una vez.</p>
        </div>
        {!desktopAvailable && <div className="notice" role="status">Vista previa en navegador. Abre la aplicación de escritorio para guardar datos.</div>}
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
        <span className="nav-group-label">PRINCIPAL</span>
        <button className={`nav-item${page === "home" ? " active" : ""}`} aria-label="Inicio" title="Inicio" aria-current={page === "home" ? "page" : undefined} onClick={() => setPage("home")}>
          <Icon name="home" /><span className="nav-label">Inicio</span>
        </button>
        {modules.filter((item) => item.group === "operation").map((item) => <button key={item.label} className={`nav-item${page === item.icon ? " active" : ""}`} aria-label={item.label} title={item.label} aria-current={page === item.icon ? "page" : undefined} onClick={() => setPage(item.icon)}>
          <Icon name={item.icon} /><span className="nav-label">{item.label}</span>
        </button>)}
        <span className="nav-group-label consultation-label">CONSULTAS Y DATOS</span>
        {modules.filter((item) => item.group === "consultation").map((item) => <button key={item.label} className={`nav-item${page === item.icon ? " active" : ""}`} aria-label={item.label} title={item.label} aria-current={page === item.icon ? "page" : undefined} onClick={() => setPage(item.icon)}>
          <Icon name={item.icon} /><span className="nav-label">{item.label}</span>
        </button>)}
      </nav>
      <div className="sidebar-bottom">
        <button className={`nav-item${page === "settings" ? " active" : ""}`} aria-label="Configuración" title="Configuración" aria-current={page === "settings" ? "page" : undefined} onClick={() => setPage("settings")}>
          <Icon name="settings" /><span className="nav-label">Configuración</span>
        </button>
        <div className="sidebar-meta"><span className="status-dot" /><span className="nav-label">Datos en este equipo</span><small className="nav-label">v{status.version}</small></div>
      </div>
    </aside>

    <div className="workspace-body">
      <header className="workspace-header">
        <button className="icon-button sidebar-toggle" aria-label={collapsed ? "Expandir menú lateral" : "Contraer menú lateral"} aria-expanded={!collapsed} aria-controls="app-sidebar" onClick={() => setCollapsed((current) => !current)}><Icon name="panel" /></button>
        <nav className="breadcrumb" aria-label="Ubicación">
          {page !== "home" && <><button onClick={() => setPage("home")}>Inicio</button><span aria-hidden="true">/</span></>}
          <span aria-current="page">{title}</span>
        </nav>
        <span className="workspace-currency">{status.settings.currencyCode}<span> · Impuestos incluidos</span></span>
      </header>

      <main id="main-content" className="workspace-content">
        <div className="page-heading"><span className="page-icon"><Icon name={page} /></span>
          <div><h1 ref={heading} tabIndex={-1}>{title}</h1>
            <p>{page === "home" ? `Bienvenido a ${status.settings.storeName}. Este es tu espacio de trabajo.` : page === "settings" ? "Administra las preferencias de tu punto de venta." : `${status.settings.storeName} · ${status.settings.timeZone}`}</p></div>
        </div>
        {error && <div className="notice error" role="alert">{error}</div>}
        {page === "settings" && <SettingsForm status={status} initial={false} onSaved={handleSaved} />}
        {page === "catalog" && <Catalog status={status} onChanged={refreshStatus} />}
        {page === "inventory" && <Inventory status={status} onChanged={refreshStatus} />}
        {page === "sale" && <Sales status={status} onChanged={refreshStatus} />}
        {page === "history" && <History status={status} onChanged={refreshStatus} />}
        {page === "report" && <History status={status} onChanged={refreshStatus} reportOnly />}
        {page === "backup" && <BackupPanel />}
        {page === "home" && <>
          {welcome && <div className="notice success" role="status"><Icon name="check" />Configuración guardada. Tu espacio de trabajo está listo.</div>}
          <section className="business-overview" aria-label="Preferencias actuales">
            <div className="summary-card"><span>GIRO DEL NEGOCIO</span><strong>{status.settings.businessSector}</strong><small>Adaptado a tu actividad</small></div>
            <div className="summary-card"><span>MONEDA</span><strong>{status.settings.currencyCode}</strong><small>{currency?.name}</small></div>
            <div className="summary-card"><span>PRECIOS</span><strong>Impuestos incluidos</strong><small>El precio final es el importe a cobrar</small></div>
          </section>
          <section className="workspace-card" aria-labelledby="business-title">
            <div className="card-heading"><div><span className="eyebrow">TU ESPACIO DE TRABAJO</span><h2 id="business-title">{status.settings.storeName}</h2></div><span className="ready-badge"><Icon name="check" />Configurado</span></div>
            <p>Las preferencias se guardan en este equipo. Puedes actualizarlas desde Configuración, al pie del menú lateral.</p>
            <button className="secondary-button" onClick={() => setPage("settings")}>Revisar configuración<Icon name="arrow" /></button>
          </section>
          <section className="workspace-card" aria-labelledby="quick-title">
            <h2 id="quick-title">Operación del negocio</h2>
            <p>Empieza registrando tus productos y existencias. Desde aquí puedes cobrar, consultar resultados y proteger tus datos.</p>
            <div className="quick-actions">{modules.map((item) => <button key={item.icon} className="secondary-button" onClick={() => setPage(item.icon)}><Icon name={item.icon} />{item.label}</button>)}</div>
          </section>
        </>}
      </main>
      <footer className="workspace-footer">TCG POS · v{status.version}<span>Desarrollado por Oscar Velasco</span></footer>
    </div>
  </div>;
}

export default App;
