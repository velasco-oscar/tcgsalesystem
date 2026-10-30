use crate::{backups, db, pos::*, settings};
use rusqlite::{Connection, params};
fn setup() -> (tempfile::TempDir, Connection) {
    let d = tempfile::tempdir().unwrap();
    let c = db::open(&d.path().join("pos.sqlite3")).unwrap();
    db::update_store_settings(
        &c,
        &settings::StoreSettings {
            store_name: "Negocio de prueba".into(),
            business_sector: "General".into(),
            currency_code: "MXN".into(),
            time_zone: "America/Tijuana".into(),
        },
    )
    .unwrap();
    (d, c)
}
fn input(sku: &str, stock: i64) -> ProductInput {
    ProductInput {
        id: None,
        sku: sku.into(),
        name: format!("Producto {sku}"),
        category_id: None,
        variant: "Azul".into(),
        card: None,
        price: "12.35".into(),
        cost: "4.00".into(),
        initial_stock: stock,
        active: true,
    }
}
fn request(id: i64, qty: i64) -> Checkout {
    Checkout {
        request_id: "test-request-00000001".into(),
        currency_code: "MXN".into(),
        lines: vec![CartLine {
            product_id: id,
            quantity: qty,
            price: 1235,
        }],
        method: "cash".into(),
        received: "100.00".into(),
        payment_confirmed: false,
    }
}
fn count(c: &Connection, table: &str) -> i64 {
    c.query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r.get(0))
        .unwrap()
}
fn day_period(day: &str) -> Period {
    Period {
        from: day.into(),
        to: day.into(),
        folio: "".into(),
        status: "all".into(),
        offset: 0,
    }
}
#[test]
fn monetary_precision_limits_and_no_rounding() {
    assert_eq!(money("0.10", 2).unwrap(), 10);
    assert_eq!(money("12.3", 2).unwrap(), 1230);
    assert_eq!(money("23", 0).unwrap(), 23);
    assert_eq!(money("90000000000.00", 2).unwrap(), MAX_MONEY);
    for s in [
        "-1",
        "NaN",
        "1e3",
        "1,25",
        "1.001",
        "90000000000.01",
        "9999999999999999999999999",
    ] {
        assert!(money(s, 2).is_err(), "{s}");
    }
    assert!(money("1.0", 0).is_err());
}
#[test]
fn initial_stock_sku_and_negative_adjustment_are_guarded() {
    let (_d, mut c) = setup();
    let id = save_product(&mut c, input("abc", 3)).unwrap();
    assert_eq!(product(&c, id).unwrap().stock, 3);
    assert_eq!(movements(&c, id, 0).unwrap()[0].kind, "initial");
    assert!(save_product(&mut c, input("ABC", 1)).is_err());
    assert!(record_stock(&mut c, id, -4, "adjustment", "Error de conteo").is_err());
    assert!(record_stock(&mut c, id, i64::MIN, "adjustment", "Inválido").is_err());
    assert_eq!(product(&c, id).unwrap().stock, 3);
    record_stock(&mut c, id, -2, "adjustment", "Conteo físico").unwrap();
    assert_eq!(product(&c, id).unwrap().stock, 1);
    assert!(c.execute("DELETE FROM stock_movements", []).is_err());
    assert!(
        c.execute("DELETE FROM products WHERE id=?1", params![id])
            .is_err()
    );
}
#[test]
fn overselling_price_changes_and_inactive_products_are_rejected() {
    let (_d, mut c) = setup();
    let id = save_product(&mut c, input("A", 3)).unwrap();
    assert!(checkout(&mut c, request(id, 4)).is_err());
    let mut wrong = request(id, 1);
    wrong.lines[0].price = 1200;
    assert!(checkout(&mut c, wrong).is_err());
    let mut changed = input("A", 0);
    changed.id = Some(id);
    changed.active = false;
    save_product(&mut c, changed).unwrap();
    assert!(checkout(&mut c, request(id, 1)).is_err());
    assert_eq!(count(&c, "sales"), 0);
    assert_eq!(count(&c, "sale_items"), 0);
    assert_eq!(count(&c, "stock_movements"), 1);
}
#[test]
fn sale_error_rolls_back_sale_items_and_movements() {
    let (_d, mut c) = setup();
    let a = save_product(&mut c, input("A", 5)).unwrap();
    let b = save_product(&mut c, input("B", 5)).unwrap();
    c.execute_batch(&format!("CREATE TRIGGER fail_second_item BEFORE INSERT ON sale_items WHEN NEW.product_id={b} BEGIN SELECT RAISE(ABORT,'Fallo simulado'); END;")).unwrap();
    let mut req = request(a, 1);
    req.lines.push(CartLine {
        product_id: b,
        quantity: 1,
        price: 1235,
    });
    assert!(checkout(&mut c, req).is_err());
    assert_eq!(count(&c, "sales"), 0);
    assert_eq!(count(&c, "sale_items"), 0);
    assert_eq!(count(&c, "stock_movements"), 2);
    assert_eq!(product(&c, a).unwrap().stock, 5);
}
#[test]
fn retry_is_idempotent_but_changed_payload_is_rejected() {
    let (_d, mut c) = setup();
    let id = save_product(&mut c, input("A", 10)).unwrap();
    let req = request(id, 2);
    let sold = checkout(&mut c, req.clone()).unwrap();
    let retried = checkout(&mut c, req.clone()).unwrap();
    assert_eq!(sold.id, retried.id);
    assert_eq!(sold.total, 2470);
    assert_eq!(sold.change, Some(7530));
    assert_eq!(product(&c, id).unwrap().stock, 8);
    let mut other = req.clone();
    other.lines[0].quantity = 1;
    assert!(checkout(&mut c, other).is_err());
    assert_eq!(count(&c, "sales"), 1);
    assert_eq!(count(&c, "stock_movements"), 2);
    cancel(&mut c, sold.id, "Devolución completa", true, true).unwrap();
    let repeat = checkout(&mut c, req).unwrap();
    assert!(repeat.cancellation.is_some());
    assert_eq!(product(&c, id).unwrap().stock, 10);
}
#[test]
fn duplicate_cart_lines_are_combined_and_payments_revalidated() {
    let (_d, mut c) = setup();
    let id = save_product(&mut c, input("A", 3)).unwrap();
    let mut req = request(id, 2);
    req.lines.push(req.lines[0].clone());
    assert!(checkout(&mut c, req).is_err());
    let mut req = request(id, 1);
    req.received = "12.34".into();
    assert!(checkout(&mut c, req).is_err());
    for method in ["card", "transfer"] {
        let mut req = request(id, 1);
        req.request_id = format!("payment-test-{method}-0001");
        req.method = method.into();
        req.received = "".into();
        assert!(checkout(&mut c, req.clone()).is_err());
        req.payment_confirmed = true;
        assert_eq!(checkout(&mut c, req).unwrap().received, None);
    }
}
#[test]
fn product_edits_do_not_change_receipt() {
    let (_d, mut c) = setup();
    let id = save_product(&mut c, input("A", 2)).unwrap();
    let sold = checkout(&mut c, request(id, 1)).unwrap();
    let mut changed = input("NEW", 0);
    changed.id = Some(id);
    changed.name = "Nombre nuevo".into();
    changed.variant = "Rojo".into();
    changed.price = "99.99".into();
    save_product(&mut c, changed).unwrap();
    let saved = sale(&c, sold.id).unwrap();
    assert_eq!(saved.items[0].sku, "A");
    assert_eq!(saved.items[0].variant, "Azul");
    assert_eq!(saved.items[0].price, 1235);
}
#[test]
fn cancellation_is_atomic_and_restocked_once() {
    let (_d, mut c) = setup();
    let a = save_product(&mut c, input("A", 5)).unwrap();
    let b = save_product(&mut c, input("B", 5)).unwrap();
    let mut req = request(a, 1);
    req.lines.push(CartLine {
        product_id: b,
        quantity: 1,
        price: 1235,
    });
    let sold = checkout(&mut c, req).unwrap();
    assert!(cancel(&mut c, sold.id, "", true, true).is_err());
    assert!(cancel(&mut c, sold.id, "Motivo", false, true).is_err());
    c.execute_batch(&format!("CREATE TRIGGER fail_restock BEFORE INSERT ON stock_movements WHEN NEW.kind='cancellation' AND NEW.product_id={b} BEGIN SELECT RAISE(ABORT,'Fallo simulado'); END;")).unwrap();
    assert!(cancel(&mut c, sold.id, "Motivo", true, true).is_err());
    assert_eq!(count(&c, "cancellations"), 0);
    assert_eq!(product(&c, a).unwrap().stock, 4);
    c.execute_batch("DROP TRIGGER fail_restock").unwrap();
    let cancelled = cancel(&mut c, sold.id, "Devolución completa", true, true).unwrap();
    assert_eq!(cancelled.cancellation.unwrap().refund, 2470);
    cancel(&mut c, sold.id, "Reintento", true, true).unwrap();
    assert_eq!(count(&c, "cancellations"), 1);
    assert_eq!(product(&c, a).unwrap().stock, 5);
    assert_eq!(product(&c, b).unwrap().stock, 5);
}
#[test]
fn reports_use_sale_and_cancellation_dates_independently() {
    let (_d, mut c) = setup();
    let id = save_product(&mut c, input("A", 2)).unwrap();
    let sold = checkout(&mut c, request(id, 1)).unwrap();
    cancel(&mut c, sold.id, "=Motivo, con comillas \"", true, true).unwrap();
    // Fechas de fixture; los triggers de producción hacen inmutables estas filas.
    c.execute_batch("DROP TRIGGER immutable_sale; DROP TRIGGER immutable_cancel; UPDATE sales SET created_at='2026-10-01T18:00:00.000Z'; UPDATE cancellations SET created_at='2026-10-02T18:00:00.000Z';").unwrap();
    let first = report(&c, &day_period("2026-10-01")).unwrap();
    assert_eq!(first.sales_total, 1235);
    assert_eq!(first.cancellations_total, 0);
    let second = report(&c, &day_period("2026-10-02")).unwrap();
    assert_eq!(second.sales_total, 0);
    assert_eq!(second.net, -1235);
    assert_eq!(second.cancellations_count, 1);
    let csv = report_csv(&c, &day_period("2026-10-02")).unwrap();
    assert!(csv.contains("anulacion"));
    assert!(csv.contains("12.35"));
    assert!(csv.contains("'=Motivo"));
    assert!(csv.contains("\"\""));
    assert_eq!(history(&c, &day_period("2026-10-02")).unwrap().len(), 1);
}
#[test]
fn business_day_accounts_for_dst() {
    let (_d, c) = setup();
    let (a, b, _) = period_bounds(&c, &day_period("2026-03-08")).unwrap();
    let elapsed = chrono::DateTime::parse_from_rfc3339(&b).unwrap()
        - chrono::DateTime::parse_from_rfc3339(&a).unwrap();
    assert_eq!(elapsed.num_hours(), 23);
    let (a, b, _) = period_bounds(&c, &day_period("2026-11-01")).unwrap();
    let elapsed = chrono::DateTime::parse_from_rfc3339(&b).unwrap()
        - chrono::DateTime::parse_from_rfc3339(&a).unwrap();
    assert_eq!(elapsed.num_hours(), 25);
}
#[test]
fn currency_and_time_zone_locks_prevent_reinterpretation() {
    let (_d, mut c) = setup();
    let id = save_product(&mut c, input("A", 1)).unwrap();
    let mut s = db::store_settings(&c).unwrap();
    s.currency_code = "USD".into();
    assert!(db::update_store_settings(&c, &s).is_err());
    checkout(&mut c, request(id, 1)).unwrap();
    s.currency_code = "MXN".into();
    s.time_zone = "UTC".into();
    assert!(db::update_store_settings(&c, &s).is_err());
}
#[test]
fn backup_restore_cycle_and_invalid_files_preserve_current_data() {
    let (d, mut c) = setup();
    let id = save_product(&mut c, input("A", 5)).unwrap();
    let original = d.path().join("snapshot.sqlite3");
    backups::snapshot(&c, &original).unwrap();
    checkout(&mut c, request(id, 2)).unwrap();
    assert_eq!(product(&c, id).unwrap().stock, 3);
    let recovery = backups::restore(&mut c, &original, d.path()).unwrap();
    assert!(recovery.exists());
    assert_eq!(product(&c, id).unwrap().stock, 5);
    assert_eq!(count(&c, "sales"), 0);
    let bad = d.path().join("bad.sqlite3");
    std::fs::write(&bad, "No es SQLite").unwrap();
    assert!(backups::restore(&mut c, &bad, d.path()).is_err());
    assert_eq!(product(&c, id).unwrap().stock, 5);
    let future = d.path().join("future.sqlite3");
    backups::snapshot(&c, &future).unwrap();
    let x = Connection::open(&future).unwrap();
    x.pragma_update(None, "user_version", 999).unwrap();
    drop(x);
    assert!(backups::restore(&mut c, &future, d.path()).is_err());
    assert_eq!(count(&c, "products"), 1);
    let foreign = d.path().join("foreign.sqlite3");
    let x = Connection::open(&foreign).unwrap();
    x.execute_batch("CREATE TABLE unrelated(id INTEGER)")
        .unwrap();
    drop(x);
    assert!(backups::restore(&mut c, &foreign, d.path()).is_err());
    checkout(&mut c, request(id, 1)).unwrap();
    assert_eq!(product(&c, id).unwrap().stock, 4);
}
#[test]
fn altered_backup_schema_and_inconsistent_stock_are_rejected() {
    let (d, mut c) = setup();
    let id = save_product(&mut c, input("A", 5)).unwrap();
    let bad = d.path().join("altered.sqlite3");
    backups::snapshot(&c, &bad).unwrap();
    let x = Connection::open(&bad).unwrap();
    x.execute_batch("CREATE TABLE extra(id INTEGER)").unwrap();
    drop(x);
    assert!(backups::restore(&mut c, &bad, d.path()).is_err());
    let bad = d.path().join("inconsistent.sqlite3");
    backups::snapshot(&c, &bad).unwrap();
    let x = Connection::open(&bad).unwrap();
    x.execute("UPDATE products SET stock=9 WHERE id=?1", params![id])
        .unwrap();
    drop(x);
    assert!(backups::restore(&mut c, &bad, d.path()).is_err());
    assert_eq!(product(&c, id).unwrap().stock, 5);
}
#[test]
fn crash_worker() {
    let Ok(path) = std::env::var("TCG_POS_CRASH_TEST_DB") else {
        return;
    };
    let c = db::open(std::path::Path::new(&path)).unwrap();
    c.execute_batch("BEGIN IMMEDIATE; INSERT INTO products(sku,name,price,cost) VALUES('CRASH','Interrumpido',100,0); INSERT INTO stock_movements(product_id,quantity,kind,reason) VALUES(last_insert_rowid(),3,'initial','Interrumpido');").unwrap();
    std::process::exit(91);
}
#[test]
fn unexpected_process_exit_recovers_without_partial_operation() {
    let (d, c) = setup();
    drop(c);
    let path = d.path().join("pos.sqlite3");
    let status = std::process::Command::new(std::env::current_exe().unwrap())
        .args(["--exact", "pos_tests::crash_worker", "--nocapture"])
        .env("TCG_POS_CRASH_TEST_DB", &path)
        .status()
        .unwrap();
    assert_eq!(status.code(), Some(91));
    let c = db::open(&path).unwrap();
    assert_eq!(count(&c, "products"), 0);
    assert_eq!(count(&c, "stock_movements"), 0);
    let integrity: String = c
        .query_row("PRAGMA integrity_check", [], |r| r.get(0))
        .unwrap();
    assert_eq!(integrity, "ok");
}

#[test]
fn concurrent_retries_commit_only_one_sale() {
    let (d, mut c) = setup();
    let id = save_product(&mut c, input("A", 5)).unwrap();
    drop(c);
    let path = d.path().join("pos.sqlite3");
    let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
    let workers: Vec<_> = (0..2)
        .map(|_| {
            let path = path.clone();
            let barrier = barrier.clone();
            std::thread::spawn(move || {
                let mut c = db::open(&path).unwrap();
                barrier.wait();
                checkout(&mut c, request(id, 2)).unwrap().id
            })
        })
        .collect();
    let ids: Vec<_> = workers.into_iter().map(|w| w.join().unwrap()).collect();
    assert_eq!(ids[0], ids[1]);
    let c = db::open(&path).unwrap();
    assert_eq!(count(&c, "sales"), 1);
    assert_eq!(product(&c, id).unwrap().stock, 3);
}
#[test]
fn concurrent_sales_cannot_oversell() {
    let (d, mut c) = setup();
    let id = save_product(&mut c, input("A", 5)).unwrap();
    drop(c);
    let path = d.path().join("pos.sqlite3");
    let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
    let workers: Vec<_> = (0..2)
        .map(|index| {
            let path = path.clone();
            let barrier = barrier.clone();
            std::thread::spawn(move || {
                let mut c = db::open(&path).unwrap();
                let mut req = request(id, 4);
                req.request_id = format!("concurrent-request-{index:05}");
                barrier.wait();
                checkout(&mut c, req).is_ok()
            })
        })
        .collect();
    let successes = workers
        .into_iter()
        .map(|w| usize::from(w.join().unwrap()))
        .sum::<usize>();
    assert_eq!(successes, 1);
    let c = db::open(&path).unwrap();
    assert_eq!(count(&c, "sales"), 1);
    assert_eq!(product(&c, id).unwrap().stock, 1);
}
#[test]
fn failed_migration_rolls_back_all_schema_changes() {
    let d = tempfile::tempdir().unwrap();
    let path = d.path().join("old.sqlite3");
    let c = Connection::open(&path).unwrap();
    c.execute_batch(include_str!("../migrations/001_initial.sql"))
        .unwrap();
    c.execute_batch(include_str!("../migrations/002_business_settings.sql"))
        .unwrap();
    c.execute_batch("PRAGMA user_version=2; CREATE TABLE categories(existing TEXT);")
        .unwrap();
    drop(c);
    assert!(db::open(&path).is_err());
    let c = Connection::open(&path).unwrap();
    let version: i64 = c
        .pragma_query_value(None, "user_version", |r| r.get(0))
        .unwrap();
    assert_eq!(version, 2);
    let added: bool = c
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM pragma_table_info('app_settings') WHERE name='time_zone')",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert!(!added);
    assert_eq!(
        std::fs::read_dir(d.path().join("backups")).unwrap().count(),
        1
    );
}
#[test]
fn restore_requires_a_recovery_backup_before_replacing_data() {
    let (d, mut c) = setup();
    let id = save_product(&mut c, input("A", 5)).unwrap();
    let path = d.path().join("saved.sqlite3");
    backups::snapshot(&c, &path).unwrap();
    checkout(&mut c, request(id, 1)).unwrap();
    std::fs::write(d.path().join("backups"), "No permite crear carpeta").unwrap();
    assert!(backups::restore(&mut c, &path, d.path()).is_err());
    assert_eq!(count(&c, "sales"), 1);
    assert_eq!(product(&c, id).unwrap().stock, 4);
}

#[test]
fn name_search_handles_spanish_uppercase_characters() {
    let (_d, mut c) = setup();
    let mut value = input("ES", 0);
    value.name = "ÚTILES DE PAPELERÍA".into();
    save_product(&mut c, value).unwrap();
    assert_eq!(products(&c, "papelería", true, 0).unwrap().len(), 1);
    assert_eq!(products(&c, "útiles", true, 0).unwrap().len(), 1);
}
