pub use crate::models::*;
pub use crate::repository::{categories, movements, product, sale};
use crate::{db, repository, settings};
use chrono::{Duration, NaiveDate, SecondsFormat, TimeZone, Utc};
use chrono_tz::Tz;
use rusqlite::{Connection, TransactionBehavior};

use std::collections::BTreeMap;

pub use crate::errors::{Result, sql};
pub const MAX_MONEY: i64 = 9_000_000_000_000;
pub const MAX_QTY: i64 = 1_000_000;

pub fn now() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}
pub fn text(value: &str, max: usize, required: bool, field: &str) -> Result<String> {
    let clean = value.trim();
    if (required && clean.is_empty())
        || clean.chars().count() > max
        || clean.chars().any(char::is_control)
    {
        return Err(format!(
            "Revisa {field}: {}hasta {max} caracteres, sin saltos de línea.",
            if required { "obligatorio, " } else { "" }
        ));
    }
    Ok(clean.into())
}
pub fn money(value: &str, decimals: u8) -> Result<i64> {
    let value = value.trim();
    let pieces: Vec<_> = value.split('.').collect();
    if pieces.len() > 2 || pieces[0].is_empty() || !pieces[0].bytes().all(|c| c.is_ascii_digit()) {
        return Err(
            "Escribe un importe positivo con punto decimal, sin símbolos ni separadores de miles."
                .into(),
        );
    }
    let fraction = pieces.get(1).copied().unwrap_or("");
    if fraction.len() > decimals as usize
        || !fraction.bytes().all(|c| c.is_ascii_digit())
        || (decimals == 0 && pieces.len() > 1)
    {
        return Err(format!(
            "La moneda admite {decimals} decimales. No se redondean importes automáticamente."
        ));
    }
    let scale = 10_i64.pow(decimals as u32);
    let whole = pieces[0]
        .parse::<i64>()
        .map_err(|_| "Importe fuera de límite.")?;
    let fraction = if fraction.is_empty() {
        0
    } else {
        fraction.parse::<i64>().map_err(|_| "Importe inválido.")?
            * 10_i64.pow(decimals as u32 - fraction.len() as u32)
    };
    whole
        .checked_mul(scale)
        .and_then(|n| n.checked_add(fraction))
        .filter(|n| *n <= MAX_MONEY)
        .ok_or("Importe fuera de límite.".into())
}
pub fn configuration(c: &Connection) -> Result<(settings::StoreSettings, u8)> {
    let value = db::store_settings(c).map_err(sql)?;
    let value = settings::validate(value)?;
    let decimals = settings::CURRENCIES
        .iter()
        .find(|item| item.code == value.currency_code)
        .ok_or("Configura la moneda del negocio.")?
        .minor_units;
    Ok((value, decimals))
}

pub fn save_category(c: &Connection, id: Option<i64>, name: &str) -> Result<()> {
    let name = text(name, 80, true, "el nombre de categoría")?;
    repository::put_category(c, id, &name)
}

pub fn products(
    c: &Connection,
    search: &str,
    include_inactive: bool,
    offset: i64,
) -> Result<Vec<Product>> {
    let search = text(search, 160, false, "la búsqueda")?;
    repository::products(c, &search, include_inactive, offset)
}

pub fn save_product(c: &mut Connection, input: ProductInput) -> Result<i64> {
    let tx = c
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(sql)?;
    let (_, decimals) = configuration(&tx)?;
    let sku = text(&input.sku, 60, true, "el SKU")?.to_ascii_uppercase();
    if !sku
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || b"-_.".contains(&b))
    {
        return Err(
            "El SKU solo admite letras sin acentos, números, guion, punto y guion bajo.".into(),
        );
    }
    let name = text(&input.name, 160, true, "el nombre")?;
    let variant = text(&input.variant, 120, false, "la variante")?;
    let price = money(&input.price, decimals)?;
    let cost = money(&input.cost, decimals)?;
    if price == 0 {
        return Err("El precio de venta debe ser mayor que cero.".into());
    }
    if !(0..=MAX_QTY).contains(&input.initial_stock)
        || (input.id.is_some() && input.initial_stock != 0)
    {
        return Err("Las existencias iniciales solo se registran al crear un producto, hasta un millón de unidades.".into());
    }
    let card = if let Some(card) = input.card {
        let card = CardDetails {
            game: text(&card.game, 80, true, "el juego")?,
            expansion: text(&card.expansion, 100, true, "la expansión")?,
            number: text(&card.number, 40, true, "el número")?,
            ..card
        };
        if !["es", "en", "ja", "fr", "de", "it", "pt", "ko", "zh"].contains(&card.language.as_str())
            || !["NM", "LP", "MP", "HP", "DMG"].contains(&card.condition.as_str())
            || !["normal", "foil", "reverse", "etched", "other"].contains(&card.finish.as_str())
        {
            return Err("Selecciona idioma, condición y acabado válidos para la carta.".into());
        }
        Some(card)
    } else {
        None
    };
    let card_json = serde_json::to_string(&card).map_err(|e| e.to_string())?;
    let id = repository::put_product(
        &tx,
        repository::ProductValues {
            id: input.id,
            sku: &sku,
            name: &name,
            category_id: input.category_id,
            variant: &variant,
            card_json: &card_json,
            price,
            cost,
            active: input.active,
        },
    )?;
    if input.id.is_none() && input.initial_stock > 0 {
        repository::insert_movement(
            &tx,
            repository::NewMovement {
                product_id: id,
                quantity: input.initial_stock,
                kind: "initial",
                reason: "Existencias iniciales",
                sale_id: None,
                cancellation_id: None,
            },
        )?;
    }
    tx.commit().map_err(sql)?;
    Ok(id)
}

pub fn record_stock(
    c: &mut Connection,
    id: i64,
    quantity: i64,
    kind: &str,
    reason: &str,
) -> Result<()> {
    if quantity == 0
        || !(-MAX_QTY..=MAX_QTY).contains(&quantity)
        || !["entry", "adjustment"].contains(&kind)
        || (kind == "entry" && quantity < 0)
    {
        return Err("Entrada: cantidad positiva. Ajuste: cantidad entera distinta de cero, hasta un millón de unidades.".into());
    }
    let reason = text(reason, 500, true, "el motivo")?;
    let tx = c
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(sql)?;
    product(&tx, id)?;
    repository::insert_movement(
        &tx,
        repository::NewMovement {
            product_id: id,
            quantity,
            kind,
            reason: &reason,
            sale_id: None,
            cancellation_id: None,
        },
    )?;
    tx.commit().map_err(sql)
}

pub fn checkout(c: &mut Connection, input: Checkout) -> Result<Sale> {
    if !(16..=80).contains(&input.request_id.len())
        || !input
            .request_id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"-_".contains(&b))
    {
        return Err("Identificador de cobro inválido.".into());
    }
    if input.lines.is_empty()
        || input.lines.len() > 200
        || !["cash", "card", "transfer"].contains(&input.method.as_str())
    {
        return Err("Revisa el carrito y el método de pago (hasta 200 partidas).".into());
    }
    if input.method != "cash" && (!input.payment_confirmed || !input.received.is_empty()) {
        return Err("Confirma que recibiste el pago por tarjeta o transferencia.".into());
    }
    let tx = c
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(sql)?;
    let (settings, decimals) = configuration(&tx)?;
    let received = if input.method == "cash" {
        Some(money(&input.received, decimals)?)
    } else {
        None
    };
    let mut lines: BTreeMap<i64, (i64, i64)> = BTreeMap::new();
    for line in &input.lines {
        if !(1..=MAX_QTY).contains(&line.quantity) || !(1..=MAX_MONEY).contains(&line.price) {
            return Err("Cantidad o precio fuera de límite.".into());
        }
        let current = lines.entry(line.product_id).or_insert((0, line.price));
        if current.1 != line.price {
            return Err("Precios incompatibles para el mismo producto.".into());
        }
        current.0 += line.quantity;
        if current.0 > MAX_QTY {
            return Err("Cantidad fuera de límite.".into());
        }
    }
    let payload = serde_json::to_string(&serde_json::json!({"currency":input.currency_code,"lines":lines,"method":input.method,"received":received,"confirmed":input.payment_confirmed})).map_err(|e|e.to_string())?;
    if let Some((id, saved)) = repository::find_attempt(&tx, &input.request_id)? {
        if saved != payload {
            return Err("Este identificador de cobro ya se usó con contenido diferente.".into());
        }
        return sale(&tx, id);
    }
    if input.currency_code != settings.currency_code {
        return Err("La moneda del carrito cambió. Revisa el cobro.".into());
    }
    let mut validated = Vec::new();
    let mut total = 0_i64;
    for (id, (quantity, price)) in &lines {
        let p = product(&tx, *id)?;
        if !p.active {
            return Err(format!("{} está desactivado.", p.name));
        }
        if p.stock < *quantity {
            return Err(format!(
                "Existencias insuficientes de {} (disponibles: {}).",
                p.name, p.stock
            ));
        }
        if p.price != *price {
            return Err(format!(
                "Cambió el precio de {}. Actualiza el carrito.",
                p.name
            ));
        }
        total = total
            .checked_add(
                price
                    .checked_mul(*quantity)
                    .ok_or("Total fuera de límite.")?,
            )
            .filter(|n| *n <= MAX_MONEY)
            .ok_or("Total fuera de límite.")?;
        validated.push((p, *quantity));
    }
    if received.is_some_and(|amount| amount < total) {
        return Err("El efectivo recibido no cubre el total.".into());
    }
    let id = repository::insert_sale(
        &tx,
        repository::NewSale {
            request_id: &input.request_id,
            payload: &payload,
            created_at: &now(),
            currency_code: &settings.currency_code,
            store_name: &settings.store_name,
            method: &input.method,
            total,
            received,
        },
    )?;
    for (p, quantity) in validated {
        repository::insert_item(&tx, id, &p, quantity)?;
        repository::insert_movement(
            &tx,
            repository::NewMovement {
                product_id: p.id,
                quantity: -quantity,
                kind: "sale",
                reason: "Venta",
                sale_id: Some(id),
                cancellation_id: None,
            },
        )?;
    }
    tx.commit().map_err(sql)?;
    sale(c, id)
}
pub fn cancel(
    c: &mut Connection,
    id: i64,
    reason: &str,
    restocked: bool,
    refunded: bool,
) -> Result<Sale> {
    let reason = text(reason, 500, true, "el motivo de anulación")?;
    if !restocked || !refunded {
        return Err("Confirma que toda la mercancía está disponible para vender y que devolviste el importe original.".into());
    }
    let tx = c
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(sql)?;
    let original = sale(&tx, id)?;
    if original.cancellation.is_some() {
        return Ok(original);
    }
    let cancellation = repository::insert_cancellation(&tx, &original, &now(), &reason)?;
    for item in original.items {
        repository::insert_movement(
            &tx,
            repository::NewMovement {
                product_id: item.product_id,
                quantity: item.quantity,
                kind: "cancellation",
                reason: &reason,
                sale_id: Some(id),
                cancellation_id: Some(cancellation),
            },
        )?;
    }
    tx.commit().map_err(sql)?;
    sale(c, id)
}

fn boundary(day: NaiveDate, tz: Tz) -> Result<String> {
    tz.from_local_datetime(&day.and_hms_opt(0, 0, 0).ok_or("Fecha inválida.")?)
        .earliest()
        .map(|d| {
            d.with_timezone(&Utc)
                .to_rfc3339_opts(SecondsFormat::Millis, true)
        })
        .ok_or("El inicio de este día no existe en la zona horaria. Elige otro límite.".into())
}
pub fn period_bounds(c: &Connection, p: &Period) -> Result<(String, String, Tz)> {
    let (settings, _) = configuration(c)?;
    let tz = settings
        .time_zone
        .parse::<Tz>()
        .map_err(|_| "Zona horaria inválida.")?;
    let from =
        NaiveDate::parse_from_str(&p.from, "%Y-%m-%d").map_err(|_| "Fecha inicial inválida.")?;
    let to = NaiveDate::parse_from_str(&p.to, "%Y-%m-%d").map_err(|_| "Fecha final inválida.")?;
    if from > to {
        return Err("La fecha inicial debe ser anterior o igual a la final.".into());
    }
    let end = to
        .checked_add_signed(Duration::days(1))
        .ok_or("Fecha fuera de límite.")?;
    Ok((boundary(from, tz)?, boundary(end, tz)?, tz))
}

pub fn history(c: &Connection, p: &Period) -> Result<Vec<SaleSummary>> {
    let (start, end, _) = period_bounds(c, p)?;
    if !["all", "active", "cancelled"].contains(&p.status.as_str()) {
        return Err("Estado inválido.".into());
    }
    repository::history(c, &start, &end, p)
}

pub fn report(c: &Connection, p: &Period) -> Result<Report> {
    let (start, end, tz) = period_bounds(c, p)?;
    let (sales_count, sales_total, cancellations_count, cancellations_total) =
        repository::period_totals(c, &start, &end)?;
    if sales_total > 9_000_000_000_000_000 || cancellations_total > 9_000_000_000_000_000 {
        return Err("El período supera el límite de visualización exacta. Consulta un período más corto o exporta CSV.".into());
    }
    Ok(Report {
        sales_count,
        sales_total,
        cancellations_count,
        cancellations_total,
        net: sales_total - cancellations_total,
        time_zone: tz.to_string(),
    })
}

pub fn report_csv(c: &Connection, p: &Period) -> Result<String> {
    let (start, end, tz) = period_bounds(c, p)?;
    repository::report_csv(c, &start, &end, tz)
}
