use crate::{
    errors::{Result, sql},
    models::*,
    settings,
};
use chrono::DateTime;
use chrono_tz::Tz;
use rusqlite::{Connection, OptionalExtension, params};

const SELECT_PRODUCT: &str = "SELECT p.id,p.sku,p.name,p.category_id,c.name,p.variant,p.card_json,p.price,p.cost,p.stock,p.active FROM products p LEFT JOIN categories c ON c.id=p.category_id";

pub fn categories(c: &Connection) -> Result<Vec<Category>> {
    c.prepare("SELECT id,name FROM categories ORDER BY name")
        .map_err(sql)?
        .query_map([], |r| {
            Ok(Category {
                id: r.get(0)?,
                name: r.get(1)?,
            })
        })
        .map_err(sql)?
        .collect::<rusqlite::Result<_>>()
        .map_err(sql)
}

fn product_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<Product> {
    let card: String = r.get(6)?;
    Ok(Product {
        id: r.get(0)?,
        sku: r.get(1)?,
        name: r.get(2)?,
        category_id: r.get(3)?,
        category: r.get(4)?,
        variant: r.get(5)?,
        card: serde_json::from_str(&card).unwrap_or(None),
        price: r.get(7)?,
        cost: r.get(8)?,
        stock: r.get(9)?,
        active: r.get(10)?,
    })
}

pub fn products(
    c: &Connection,
    search: &str,
    include_inactive: bool,
    offset: i64,
) -> Result<Vec<Product>> {
    let search = search.trim();
    c.prepare(&format!("{SELECT_PRODUCT} WHERE (?2 OR p.active=1) AND (instr(unicode_lower(p.name),unicode_lower(?1))>0 OR instr(lower(p.sku),lower(?1))>0) ORDER BY p.name,p.id LIMIT 100 OFFSET ?3")).map_err(sql)?
      .query_map(params![search,include_inactive,offset.max(0)],product_row).map_err(sql)?.collect::<rusqlite::Result<_>>().map_err(sql)
}

pub fn product(c: &Connection, id: i64) -> Result<Product> {
    c.query_row(
        &format!("{SELECT_PRODUCT} WHERE p.id=?1"),
        params![id],
        product_row,
    )
    .optional()
    .map_err(sql)?
    .ok_or("El producto no existe.".into())
}

pub fn movements(c: &Connection, id: i64, offset: i64) -> Result<Vec<Movement>> {
    c.prepare("SELECT id,created_at,quantity,kind,reason,sale_id,cancellation_id FROM stock_movements WHERE product_id=?1 ORDER BY id DESC LIMIT 100 OFFSET ?2").map_err(sql)?.query_map(params![id,offset.max(0)],|r|Ok(Movement{id:r.get(0)?,created_at:r.get(1)?,quantity:r.get(2)?,kind:r.get(3)?,reason:r.get(4)?,sale_id:r.get(5)?,cancellation_id:r.get(6)?})).map_err(sql)?.collect::<rusqlite::Result<_>>().map_err(sql)
}

pub fn sale(c: &Connection, id: i64) -> Result<Sale> {
    let mut sale = c.query_row("SELECT id,created_at,currency_code,store_name,method,total,received,change FROM sales WHERE id=?1",params![id],|r|Ok(Sale{id:r.get(0)?,folio:format!("V-{id:08}"),created_at:r.get(1)?,currency_code:r.get(2)?,store_name:r.get(3)?,method:r.get(4)?,total:r.get(5)?,received:r.get(6)?,change:r.get(7)?,items:vec![],cancellation:None})).optional().map_err(sql)?.ok_or("Venta inexistente.")?;
    sale.items = c.prepare("SELECT product_id,sku,name,variant,card_json,quantity,price FROM sale_items WHERE sale_id=?1 ORDER BY id").map_err(sql)?.query_map(params![id],|r|{let card:String=r.get(4)?; Ok(SaleItem{product_id:r.get(0)?,sku:r.get(1)?,name:r.get(2)?,variant:r.get(3)?,card:serde_json::from_str(&card).unwrap_or(None),quantity:r.get(5)?,price:r.get(6)?})}).map_err(sql)?.collect::<rusqlite::Result<_>>().map_err(sql)?;
    sale.cancellation = c
        .query_row(
            "SELECT id,created_at,reason,refund,method FROM cancellations WHERE sale_id=?1",
            params![id],
            |r| {
                Ok(Cancellation {
                    id: r.get(0)?,
                    created_at: r.get(1)?,
                    reason: r.get(2)?,
                    refund: r.get(3)?,
                    method: r.get(4)?,
                })
            },
        )
        .optional()
        .map_err(sql)?;
    Ok(sale)
}

fn csv_cell(value: &str) -> String {
    let safe = if value.starts_with(['=', '+', '-', '@', '\t', '\r']) {
        format!("'{value}")
    } else {
        value.into()
    };
    format!("\"{}\"", safe.replace('"', "\"\""))
}

pub fn report_csv(c: &Connection, start: &str, end: &str, tz: Tz) -> Result<String> {
    let mut stmt=c.prepare("SELECT 'venta',s.id,s.created_at,s.created_at,s.currency_code,s.method,s.total,CASE WHEN x.id IS NULL THEN 'vigente' ELSE 'anulada' END,'',printf('V-%08d',s.id) FROM sales s LEFT JOIN cancellations x ON x.sale_id=s.id WHERE s.created_at>=?1 AND s.created_at<?2 UNION ALL SELECT 'anulacion',s.id,x.created_at,s.created_at,s.currency_code,x.method,x.refund,'anulada',x.reason,printf('A-%08d',x.id) FROM cancellations x JOIN sales s ON s.id=x.sale_id WHERE x.created_at>=?1 AND x.created_at<?2 ORDER BY 3,2").map_err(sql)?;
    let mut out = String::from(
        "\u{feff}tipo,referencia,folio_venta,fecha_evento_utc,fecha_evento_negocio,zona_horaria,fecha_venta_utc,moneda,metodo,importe,estado_actual,motivo\r\n",
    );
    let rows = stmt
        .query_map(params![start, end], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, i64>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, String>(4)?,
                r.get::<_, String>(5)?,
                r.get::<_, i64>(6)?,
                r.get::<_, String>(7)?,
                r.get::<_, String>(8)?,
                r.get::<_, String>(9)?,
            ))
        })
        .map_err(sql)?;
    for row in rows {
        let (kind, id, date, sold, currency, method, amount, status, reason, reference) =
            row.map_err(sql)?;
        let local = DateTime::parse_from_rfc3339(&date)
            .map_err(|_| "Fecha almacenada inválida.")?
            .with_timezone(&tz)
            .to_rfc3339();
        let decimals = settings::CURRENCIES
            .iter()
            .find(|v| v.code == currency)
            .ok_or("Moneda histórica inválida.")?
            .minor_units;
        let scale = 10_i64.pow(decimals as u32);
        let formatted = if decimals == 0 {
            amount.to_string()
        } else {
            format!(
                "{}.{:0width$}",
                amount / scale,
                amount % scale,
                width = decimals as usize
            )
        };
        let fields = [
            kind,
            reference,
            format!("V-{id:08}"),
            date,
            local,
            tz.to_string(),
            sold,
            currency,
            method,
            formatted,
            status,
            reason,
        ];
        out.push_str(
            &fields
                .iter()
                .map(|s| csv_cell(s))
                .collect::<Vec<_>>()
                .join(","),
        );
        out.push_str("\r\n");
    }
    Ok(out)
}

pub fn put_category(c: &Connection, id: Option<i64>, name: &str) -> Result<()> {
    if let Some(id) = id {
        if c.execute(
            "UPDATE categories SET name=?1 WHERE id=?2",
            params![name, id],
        )
        .map_err(sql)?
            != 1
        {
            return Err("Categoría inexistente.".into());
        }
    } else {
        c.execute("INSERT INTO categories(name) VALUES(?1)", params![name])
            .map_err(sql)?;
    }
    Ok(())
}
pub struct ProductValues<'a> {
    pub id: Option<i64>,
    pub sku: &'a str,
    pub name: &'a str,
    pub category_id: Option<i64>,
    pub variant: &'a str,
    pub card_json: &'a str,
    pub price: i64,
    pub cost: i64,
    pub active: bool,
}
pub fn put_product(c: &Connection, p: ProductValues<'_>) -> Result<i64> {
    if let Some(id) = p.id {
        let rows=c.execute("UPDATE products SET sku=?1,name=?2,category_id=?3,variant=?4,card_json=?5,price=?6,cost=?7,active=?8 WHERE id=?9",params![p.sku,p.name,p.category_id,p.variant,p.card_json,p.price,p.cost,p.active,id]).map_err(sql)?;
        if rows != 1 {
            return Err("Producto inexistente.".into());
        }
        Ok(id)
    } else {
        c.execute("INSERT INTO products(sku,name,category_id,variant,card_json,price,cost,active) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)",params![p.sku,p.name,p.category_id,p.variant,p.card_json,p.price,p.cost,p.active]).map_err(sql)?;
        Ok(c.last_insert_rowid())
    }
}
pub struct NewMovement<'a> {
    pub product_id: i64,
    pub quantity: i64,
    pub kind: &'a str,
    pub reason: &'a str,
    pub sale_id: Option<i64>,
    pub cancellation_id: Option<i64>,
}
pub fn insert_movement(c: &Connection, m: NewMovement<'_>) -> Result<()> {
    c.execute("INSERT INTO stock_movements(product_id,quantity,kind,reason,sale_id,cancellation_id) VALUES(?1,?2,?3,?4,?5,?6)",params![m.product_id,m.quantity,m.kind,m.reason,m.sale_id,m.cancellation_id]).map_err(sql)?;
    Ok(())
}
pub fn find_attempt(c: &Connection, request_id: &str) -> Result<Option<(i64, String)>> {
    c.query_row(
        "SELECT id,request_payload FROM sales WHERE request_id=?1",
        params![request_id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )
    .optional()
    .map_err(sql)
}
pub struct NewSale<'a> {
    pub request_id: &'a str,
    pub payload: &'a str,
    pub created_at: &'a str,
    pub currency_code: &'a str,
    pub store_name: &'a str,
    pub method: &'a str,
    pub total: i64,
    pub received: Option<i64>,
}
pub fn insert_sale(c: &Connection, s: NewSale<'_>) -> Result<i64> {
    c.execute("INSERT INTO sales(request_id,request_payload,created_at,currency_code,store_name,method,total,received,change) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)",params![s.request_id,s.payload,s.created_at,s.currency_code,s.store_name,s.method,s.total,s.received,s.received.map(|v|v-s.total)]).map_err(sql)?;
    Ok(c.last_insert_rowid())
}
pub fn insert_item(c: &Connection, sale_id: i64, p: &Product, quantity: i64) -> Result<()> {
    let card = serde_json::to_string(&p.card).map_err(|e| e.to_string())?;
    c.execute("INSERT INTO sale_items(sale_id,product_id,sku,name,variant,card_json,quantity,price) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)",params![sale_id,p.id,p.sku,p.name,p.variant,card,quantity,p.price]).map_err(sql)?;
    Ok(())
}
pub fn insert_cancellation(
    c: &Connection,
    sale: &Sale,
    created_at: &str,
    reason: &str,
) -> Result<i64> {
    c.execute(
        "INSERT INTO cancellations(sale_id,created_at,reason,refund,method) VALUES(?1,?2,?3,?4,?5)",
        params![sale.id, created_at, reason, sale.total, sale.method],
    )
    .map_err(sql)?;
    Ok(c.last_insert_rowid())
}
pub fn history(c: &Connection, start: &str, end: &str, p: &Period) -> Result<Vec<SaleSummary>> {
    c.prepare("SELECT s.id,s.created_at,s.total,s.currency_code,s.method,x.created_at FROM sales s LEFT JOIN cancellations x ON x.sale_id=s.id WHERE ((s.created_at>=?1 AND s.created_at<?2) OR (x.created_at>=?1 AND x.created_at<?2)) AND instr(printf('V-%08d',s.id),?3)>0 AND (?4='all' OR (?4='active' AND x.id IS NULL) OR (?4='cancelled' AND x.id IS NOT NULL)) ORDER BY s.id DESC LIMIT 100 OFFSET ?5").map_err(sql)?.query_map(params![start,end,p.folio.trim().to_ascii_uppercase(),p.status,p.offset.max(0)],|r|{let id=r.get(0)?;Ok(SaleSummary{id,folio:format!("V-{id:08}"),created_at:r.get(1)?,total:r.get(2)?,currency_code:r.get(3)?,method:r.get(4)?,cancelled_at:r.get(5)?})}).map_err(sql)?.collect::<rusqlite::Result<_>>().map_err(sql)
}
pub fn period_totals(c: &Connection, start: &str, end: &str) -> Result<(i64, i64, i64, i64)> {
    let(a,b)=c.query_row("SELECT count(*),coalesce(sum(total),0) FROM sales WHERE created_at>=?1 AND created_at<?2",params![start,end],|r|Ok((r.get(0)?,r.get(1)?))).map_err(sql)?;
    let(d,e)=c.query_row("SELECT count(*),coalesce(sum(refund),0) FROM cancellations WHERE created_at>=?1 AND created_at<?2",params![start,end],|r|Ok((r.get(0)?,r.get(1)?))).map_err(sql)?;
    Ok((a, b, d, e))
}
