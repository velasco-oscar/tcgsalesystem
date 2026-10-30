use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StoreSettings {
    pub store_name: String,
    pub business_sector: String,
    pub currency_code: String,
    #[serde(default = "default_time_zone")]
    pub time_zone: String,
}

pub fn default_time_zone() -> String {
    "America/Tijuana".into()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CurrencyOption {
    pub code: &'static str,
    pub name: &'static str,
    pub minor_units: u8,
}

// Opciones iniciales explícitas: no asumir dos decimales para toda moneda.
pub const CURRENCIES: &[CurrencyOption] = &[
    CurrencyOption {
        code: "MXN",
        name: "Peso mexicano",
        minor_units: 2,
    },
    CurrencyOption {
        code: "USD",
        name: "Dólar estadounidense",
        minor_units: 2,
    },
    CurrencyOption {
        code: "EUR",
        name: "Euro",
        minor_units: 2,
    },
    CurrencyOption {
        code: "CAD",
        name: "Dólar canadiense",
        minor_units: 2,
    },
    CurrencyOption {
        code: "GBP",
        name: "Libra esterlina",
        minor_units: 2,
    },
    CurrencyOption {
        code: "JPY",
        name: "Yen japonés",
        minor_units: 0,
    },
];

pub fn validate(value: StoreSettings) -> Result<StoreSettings, String> {
    let store_name = validate_store_name(&value.store_name)?;
    let business_sector = value.business_sector.trim();
    if business_sector.is_empty() {
        return Err("Escribe el giro del negocio.".into());
    }
    if business_sector.chars().count() > 80 || business_sector.chars().any(char::is_control) {
        return Err(
            "El giro debe tener hasta 80 caracteres y no contener caracteres de control.".into(),
        );
    }
    let currency_code = value.currency_code.trim().to_ascii_uppercase();
    let time_zone = value.time_zone.trim().to_owned();
    if time_zone.parse::<chrono_tz::Tz>().is_err() {
        return Err("Escribe una zona horaria IANA válida, por ejemplo America/Tijuana.".into());
    }
    if !CURRENCIES
        .iter()
        .any(|currency| currency.code == currency_code)
    {
        return Err("Selecciona una moneda de la lista disponible.".into());
    }
    Ok(StoreSettings {
        store_name,
        business_sector: business_sector.to_owned(),
        currency_code,
        time_zone,
    })
}

pub fn validate_store_name(value: &str) -> Result<String, String> {
    let name = value.trim();
    if name.is_empty() {
        return Err("Escribe el nombre del negocio.".into());
    }
    if name.chars().count() > 120 {
        return Err("El nombre no puede superar 120 caracteres.".into());
    }
    if name.chars().any(char::is_control) {
        return Err("El nombre no puede contener caracteres de control.".into());
    }
    Ok(name.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_and_normalizes_names() {
        assert_eq!(
            validate_store_name("  Cartas del Norte  ").unwrap(),
            "Cartas del Norte"
        );
        assert!(validate_store_name("   ").is_err());
        assert!(validate_store_name(&"a".repeat(121)).is_err());
        assert!(validate_store_name("Tienda\nNueva").is_err());
        assert!(validate_store_name(&"á".repeat(120)).is_ok());
    }

    #[test]
    fn accepts_any_business_sector_and_normalizes_currency() {
        let saved = validate(StoreSettings {
            store_name: "  Mi negocio  ".into(),
            business_sector: "  Ferretería y hogar  ".into(),
            currency_code: " usd ".into(),
            time_zone: default_time_zone(),
        })
        .unwrap();
        assert_eq!(saved.store_name, "Mi negocio");
        assert_eq!(saved.business_sector, "Ferretería y hogar");
        assert_eq!(saved.currency_code, "USD");
    }

    #[test]
    fn rejects_invalid_configuration() {
        let valid = StoreSettings {
            store_name: "Mi negocio".into(),
            business_sector: "Papelería".into(),
            currency_code: "MXN".into(),
            time_zone: default_time_zone(),
        };
        for sector in [
            "".to_owned(),
            "  ".to_owned(),
            "a".repeat(81),
            "Tienda\nNueva".to_owned(),
        ] {
            assert!(
                validate(StoreSettings {
                    business_sector: sector,
                    ..valid.clone()
                })
                .is_err()
            );
        }
        for code in ["", "XYZ", "MX", "USDD"] {
            assert!(
                validate(StoreSettings {
                    currency_code: code.into(),
                    ..valid.clone()
                })
                .is_err()
            );
        }
    }
}
