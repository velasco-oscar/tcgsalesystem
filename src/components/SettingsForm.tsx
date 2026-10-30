import { useState, type FormEvent } from "react";
import { saveStoreSettings, type AppStatus, type StoreSettings } from "../lib/api";
import { Icon } from "./Icon";

interface Props {
  status: AppStatus | null;
  initial: boolean;
  onSaved: (settings: StoreSettings) => void;
}

export function SettingsForm({ status, initial, onSaved }: Props) {
  const [settings, setSettings] = useState<StoreSettings>(status?.settings ?? {
    storeName: "", businessSector: "", currencyCode: "", timeZone: "America/Tijuana",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  function updateField(field: keyof StoreSettings, value: string) {
    setSettings((current) => ({ ...current, [field]: value }));
    setMessage("");
    setError("");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!status || saving) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const saved = await saveStoreSettings(settings);
      setSettings(saved);
      onSaved(saved);
      setMessage("Configuración guardada en este equipo.");
    } catch (reason: unknown) {
      setError(String(reason));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="setup-card" aria-labelledby="setup-title">
      <div className="section-topline"><Icon name="settings" /><span>{initial ? "PRIMEROS PASOS" : "PREFERENCIAS DEL NEGOCIO"}</span></div>
      <h2 id="setup-title">{initial ? "Configura tu negocio" : "Datos del negocio"}</h2>
      <p>{initial ? "Guarda tus preferencias para entrar al panel principal." : "Actualiza el nombre, giro y moneda de tu negocio."}</p>
      <form onSubmit={handleSubmit}>
        <fieldset disabled={!status || saving}>
          <div className="settings-fields">
            <div className="form-field full-width">
              <label htmlFor="store-name">Nombre del negocio</label>
              <input id="store-name" autoComplete="organization" placeholder="Escribe el nombre de tu negocio"
                value={settings.storeName} maxLength={120} required
                onChange={(event) => updateField("storeName", event.target.value)} />
            </div>
            <div className="form-field">
              <label htmlFor="business-sector">Giro del negocio</label>
              <input id="business-sector" placeholder="Por ejemplo: papelería y regalos"
                value={settings.businessSector} maxLength={80} required aria-describedby="sector-help"
                onChange={(event) => updateField("businessSector", event.target.value)} />
              <p id="sector-help" className="field-help">Escribe tu propio giro.</p>
            </div>
            <div className="form-field">
              <label htmlFor="currency-code">Moneda del negocio</label>
              <select id="currency-code" value={settings.currencyCode} required disabled={status?.currencyLocked} aria-describedby="currency-help"
                onChange={(event) => updateField("currencyCode", event.target.value)}>
                <option value="">Selecciona una moneda</option>
                {status?.currencies.map((currency) => (
                  <option key={currency.code} value={currency.code}>{currency.code} · {currency.name}</option>
                ))}
              </select>
              <p id="currency-help" className="field-help">{status?.currencyLocked ? "Bloqueada: ya existen productos u operaciones monetarias." : "Una moneda, sin conversiones. Se bloqueará al registrar el primer producto."}</p>
            </div>
            <div className="form-field full-width">
              <label htmlFor="time-zone">Zona horaria del negocio</label>
              <input id="time-zone" value={settings.timeZone} list="time-zones" required disabled={status?.timeZoneLocked}
                onChange={(event) => updateField("timeZone", event.target.value)} />
              <datalist id="time-zones"><option value="America/Tijuana" /><option value="America/Mexico_City" /><option value="America/Hermosillo" /><option value="America/Cancun" /><option value="UTC" /></datalist>
              <p className="field-help">{status?.timeZoneLocked ? "Bloqueada para mantener los períodos históricos." : "Zona IANA. Se bloqueará al registrar la primera venta."}</p>
            </div>
          </div>
          <div className="price-policy">
            <Icon name="check" />
            <div><strong>Precios finales con impuestos incluidos</strong>
              <p>El precio registrado será el importe a cobrar. No se añadirán impuestos al total.</p>
            </div>
          </div>
          {error && <div className="notice error" role="alert">{error}</div>}
          <div className="form-actions">
            <p className="save-status" role="status" aria-live="polite">{message}</p>
            <button className="primary-button" type="submit" disabled={!settings.storeName.trim() || !settings.businessSector.trim() || !settings.currencyCode}>
              {saving ? "Guardando…" : initial ? "Guardar y entrar" : "Guardar cambios"}<Icon name={initial ? "arrow" : "check"} />
            </button>
          </div>
        </fieldset>
      </form>
    </section>
  );
}
