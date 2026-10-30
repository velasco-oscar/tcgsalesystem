use crate::{db, pos::*, settings};
use rusqlite::{Connection, params};

fn setup() -> (tempfile::TempDir, Connection) {
    let d = tempfile::tempdir().unwrap();
    let c = db::open(&d.path().join("pos.sqlite3")).unwrap();
    db::update_store_settings(
        &c,
        &settings::StoreSettings {
            store_name: "Tienda".into(),
            business_sector: "Cartas".into(),
            currency_code: "MXN".into(),
            time_zone: "America/Tijuana".into(),
        },
    )
    .unwrap();
    (d, c)
}
fn attribute(name: &str, kind: &str, options: &[&str], required: bool) -> AttributeInput {
    AttributeInput {
        id: None,
        name: name.into(),
        kind: kind.into(),
        options: options.iter().map(|o| o.to_string()).collect(),
        required,
    }
}
fn category(name: &str, parent_id: Option<i64>, attributes: Vec<AttributeInput>) -> CategoryInput {
    CategoryInput {
        id: None,
        name: name.into(),
        parent_id,
        attributes,
    }
}
fn product_in(sku: &str, category_id: Option<i64>, values: Vec<(i64, &str)>) -> ProductInput {
    ProductInput {
        id: None,
        sku: sku.into(),
        name: format!("Producto {sku}"),
        category_id,
        variant: "".into(),
        attributes: values
            .into_iter()
            .map(|(attribute_id, value)| AttributeValueInput {
                attribute_id,
                value: value.into(),
            })
            .collect(),
        tags: vec![],
        price: "10.00".into(),
        cost: "0".into(),
        initial_stock: 5,
        active: true,
    }
}
fn ids(c: &Connection, category_id: i64) -> Vec<i64> {
    categories(c)
        .unwrap()
        .into_iter()
        .find(|x| x.id == category_id)
        .unwrap()
        .attributes
        .into_iter()
        .map(|a| a.id)
        .collect()
}

#[test]
fn subcategory_inherits_attributes_and_values_are_validated() {
    let (_d, mut c) = setup();
    let cards = save_category(
        &mut c,
        category(
            "Cartas",
            None,
            vec![attribute("Condición", "list", &["NM", "LP"], true)],
        ),
    )
    .unwrap();
    let pokemon = save_category(
        &mut c,
        category(
            "Pokémon",
            Some(cards),
            vec![attribute("Número", "number", &[], false)],
        ),
    )
    .unwrap();
    let condition = ids(&c, cards)[0];
    let number = ids(&c, pokemon)[0];
    // Falta un atributo obligatorio heredado.
    assert!(save_product(&mut c, product_in("A", Some(pokemon), vec![])).is_err());
    // Opción fuera de la lista y número inválido.
    assert!(
        save_product(
            &mut c,
            product_in("A", Some(pokemon), vec![(condition, "MP")])
        )
        .is_err()
    );
    assert!(
        save_product(
            &mut c,
            product_in("A", Some(pokemon), vec![(condition, "NM"), (number, "12a")])
        )
        .is_err()
    );
    let id = save_product(
        &mut c,
        product_in("A", Some(pokemon), vec![(number, "125"), (condition, "NM")]),
    )
    .unwrap();
    let saved = product(&c, id).unwrap();
    assert_eq!(saved.category.as_deref(), Some("Cartas › Pokémon"));
    let values: Vec<_> = saved.attributes.iter().map(|a| a.value.as_str()).collect();
    assert_eq!(values, ["NM", "125"]);
    // Un nivel de subcategorías como máximo.
    assert!(save_category(&mut c, category("Base", Some(pokemon), vec![])).is_err());
    // Los nombres de atributos no pueden repetirse con la categoría superior.
    assert!(
        save_category(
            &mut c,
            category(
                "Magic",
                Some(cards),
                vec![attribute("condición", "text", &[], false)]
            )
        )
        .is_err()
    );
}

#[test]
fn search_and_category_filter_include_tags_attributes_and_subcategories() {
    let (_d, mut c) = setup();
    let cards = save_category(&mut c, category("Cartas", None, vec![])).unwrap();
    let pokemon = save_category(
        &mut c,
        category(
            "Pokémon",
            Some(cards),
            vec![attribute("Expansión", "text", &[], false)],
        ),
    )
    .unwrap();
    let expansion = ids(&c, pokemon)[0];
    let mut card = product_in("A", Some(pokemon), vec![(expansion, "Obsidian Flames")]);
    card.tags = vec!["Preventa".into(), "preventa".into(), " ".into()];
    let id = save_product(&mut c, card).unwrap();
    save_product(&mut c, product_in("B", None, vec![])).unwrap();
    assert_eq!(product(&c, id).unwrap().tags, ["Preventa"]);
    assert_eq!(products(&c, "obsidian", true, None, 0).unwrap().len(), 1);
    assert_eq!(products(&c, "preven", true, None, 0).unwrap().len(), 1);
    assert_eq!(products(&c, "", true, Some(cards), 0).unwrap().len(), 1);
    assert_eq!(products(&c, "", true, None, 0).unwrap().len(), 2);
    let mut commas = product_in("C", None, vec![]);
    commas.tags = vec!["a,b".into()];
    assert!(save_product(&mut c, commas).is_err());
}

#[test]
fn attributes_in_use_are_protected_and_receipts_keep_their_values() {
    let (_d, mut c) = setup();
    let id = save_category(
        &mut c,
        category(
            "Ropa",
            None,
            vec![
                attribute("Talla", "list", &["CH", "M"], true),
                attribute("Color", "text", &[], false),
            ],
        ),
    )
    .unwrap();
    let [size, color] = ids(&c, id)[..] else {
        panic!()
    };
    let product_id = save_product(
        &mut c,
        product_in("R1", Some(id), vec![(size, "M"), (color, "Azul")]),
    )
    .unwrap();
    let sale = checkout(
        &mut c,
        Checkout {
            request_id: "catalog-request-0001".into(),
            currency_code: "MXN".into(),
            lines: vec![CartLine {
                product_id,
                quantity: 1,
                price: 1000,
            }],
            method: "cash".into(),
            received: "10.00".into(),
            payment_confirmed: false,
        },
    )
    .unwrap();
    let edit = |options: &[&str], kind: &str| CategoryInput {
        id: Some(id),
        name: "Ropa".into(),
        parent_id: None,
        attributes: vec![
            AttributeInput {
                id: Some(size),
                ..attribute("Talla", kind, options, true)
            },
            AttributeInput {
                id: Some(color),
                ..attribute("Color", "text", &[], false)
            },
        ],
    };
    // Quitar una opción en uso o cambiar el tipo con valores guardados.
    assert!(save_category(&mut c, edit(&["CH"], "list")).is_err());
    assert!(save_category(&mut c, edit(&[], "text")).is_err());
    // Intercambiar nombres no choca con la restricción única.
    let mut swapped = edit(&["CH", "M", "G"], "list");
    swapped.attributes[0].name = "Color".into();
    swapped.attributes[1].name = "Talla".into();
    save_category(&mut c, swapped).unwrap();
    // Eliminar un atributo borra sus valores, pero el comprobante conserva lo vendido.
    let mut removed = edit(&["CH", "M", "G"], "list");
    removed.attributes.truncate(1);
    save_category(&mut c, removed).unwrap();
    assert_eq!(product(&c, product_id).unwrap().attributes.len(), 1);
    let receipt = sale_detail(&c, sale.id);
    assert_eq!(receipt, ["Talla: M", "Color: Azul"]);
    // No se elimina una categoría con productos.
    assert!(delete_category(&mut c, id).is_err());
    let empty = save_category(&mut c, category("Vacía", None, vec![])).unwrap();
    delete_category(&mut c, empty).unwrap();
}

fn sale_detail(c: &Connection, id: i64) -> Vec<String> {
    sale(c, id).unwrap().items[0]
        .attributes
        .iter()
        .map(|a| format!("{}: {}", a.name, a.value))
        .collect()
}

#[test]
fn version_three_cards_become_category_attributes() {
    let d = tempfile::tempdir().unwrap();
    let path = d.path().join("v3.sqlite3");
    let c = Connection::open(&path).unwrap();
    for script in [
        include_str!("../migrations/001_initial.sql"),
        include_str!("../migrations/002_business_settings.sql"),
        include_str!("../migrations/003_pos.sql"),
    ] {
        c.execute_batch(script).unwrap();
    }
    c.execute_batch("UPDATE app_settings SET store_name='Tienda',business_sector='TCG',currency_code='MXN'; PRAGMA user_version=3;").unwrap();
    let card = r#"{"game":"Pokémon","expansion":"151","number":"25","language":"en","condition":"NM","finish":"reverse"}"#;
    c.execute(
        "INSERT INTO products(sku,name,price,cost,card_json) VALUES('P1','Pikachu',4500,0,?1)",
        params![card],
    )
    .unwrap();
    c.execute(
        "INSERT INTO products(sku,name,price,cost) VALUES('F1','Fundas',3200,0)",
        [],
    )
    .unwrap();
    c.execute("INSERT INTO sales(request_id,request_payload,created_at,currency_code,store_name,method,total,received,change) VALUES('legacy-request-000001','{}','2026-10-01T00:00:00.000Z','MXN','Tienda','cash',4500,4500,0)", []).unwrap();
    c.execute("INSERT INTO sale_items(sale_id,product_id,sku,name,variant,card_json,quantity,price) VALUES(1,1,'P1','Pikachu','',?1,1,4500)", params![card]).unwrap();
    drop(c);

    let c = db::open(&path).unwrap();
    let migrated = product(&c, 1).unwrap();
    assert_eq!(migrated.category.as_deref(), Some("Cartas TCG"));
    let values: Vec<_> = migrated
        .attributes
        .iter()
        .map(|a| a.value.as_str())
        .collect();
    assert_eq!(values, ["Pokémon", "151", "25", "Inglés", "NM", "Reverse"]);
    assert!(product(&c, 2).unwrap().attributes.is_empty());
    let template = &categories(&c).unwrap()[0];
    assert!(template.attributes.iter().all(|a| a.required));
    assert_eq!(
        sale_detail(&c, 1)[3..],
        ["Idioma: Inglés", "Condición: NM", "Acabado: Reverse"]
    );
}
