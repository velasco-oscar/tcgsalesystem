use crate::{
    errors::{Result, sql},
    models::*,
    pos::text,
};
use rusqlite::{Connection, OptionalExtension, TransactionBehavior, params};
use std::collections::{BTreeMap, HashSet};

pub const MAX_ATTRIBUTES: usize = 20;
pub const MAX_OPTIONS: usize = 50;
pub const MAX_TAGS: usize = 20;
const KINDS: [&str; 3] = ["text", "number", "list"];

// Valores de la plantilla de cartas TCG; los mismos que ofrece la interfaz.
pub const LANGUAGES: [(&str, &str); 9] = [
    ("es", "Español"),
    ("en", "Inglés"),
    ("ja", "Japonés"),
    ("fr", "Francés"),
    ("de", "Alemán"),
    ("it", "Italiano"),
    ("pt", "Portugués"),
    ("ko", "Coreano"),
    ("zh", "Chino"),
];
pub const CONDITIONS: [&str; 5] = ["NM", "LP", "MP", "HP", "DMG"];
pub const FINISHES: [(&str, &str); 5] = [
    ("normal", "Normal"),
    ("foil", "Foil"),
    ("reverse", "Reverse"),
    ("etched", "Etched"),
    ("other", "Otro"),
];

fn label(pairs: &[(&str, &'static str)], code: &str) -> String {
    pairs
        .iter()
        .find(|(key, _)| *key == code)
        .map_or(code.to_string(), |(_, name)| name.to_string())
}

fn attribute_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<Attribute> {
    let options: String = r.get(3)?;
    Ok(Attribute {
        id: r.get(0)?,
        name: r.get(1)?,
        kind: r.get(2)?,
        options: serde_json::from_str(&options).unwrap_or_default(),
        required: r.get(4)?,
    })
}

fn own_attributes(c: &Connection, category_id: i64) -> Result<Vec<Attribute>> {
    c.prepare("SELECT id,name,kind,options_json,required FROM category_attributes WHERE category_id=?1 ORDER BY position,id")
        .map_err(sql)?
        .query_map(params![category_id], attribute_row)
        .map_err(sql)?
        .collect::<rusqlite::Result<_>>()
        .map_err(sql)
}

fn parent_of(c: &Connection, id: i64) -> Result<Option<Option<i64>>> {
    c.query_row(
        "SELECT parent_id FROM categories WHERE id=?1",
        params![id],
        |r| r.get(0),
    )
    .optional()
    .map_err(sql)
}

/// Atributos que aplican a un producto de la categoría: primero los de la categoría padre.
pub fn effective_attributes(c: &Connection, category_id: Option<i64>) -> Result<Vec<Attribute>> {
    let Some(id) = category_id else {
        return Ok(vec![]);
    };
    let parent = parent_of(c, id)?.ok_or("La categoría no existe.")?;
    let mut attributes = match parent {
        Some(parent) => own_attributes(c, parent)?,
        None => vec![],
    };
    attributes.extend(own_attributes(c, id)?);
    Ok(attributes)
}

pub fn categories(c: &Connection) -> Result<Vec<Category>> {
    let rows: Vec<(i64, String, Option<i64>, i64)> = c
        .prepare("SELECT c.id,c.name,c.parent_id,(SELECT count(*) FROM products p WHERE p.category_id=c.id) FROM categories c ORDER BY c.name")
        .map_err(sql)?
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
        .map_err(sql)?
        .collect::<rusqlite::Result<_>>()
        .map_err(sql)?;
    rows.into_iter()
        .map(|(id, name, parent_id, product_count)| {
            Ok(Category {
                id,
                name,
                parent_id,
                attributes: own_attributes(c, id)?,
                product_count,
            })
        })
        .collect()
}

fn clean_attributes(input: &[AttributeInput]) -> Result<Vec<AttributeInput>> {
    if input.len() > MAX_ATTRIBUTES {
        return Err(format!("Máximo {MAX_ATTRIBUTES} atributos por categoría."));
    }
    let mut names = HashSet::new();
    input
        .iter()
        .map(|attribute| {
            let name = text(&attribute.name, 40, true, "el nombre del atributo")?;
            if !names.insert(name.to_lowercase()) {
                return Err(format!("El atributo «{name}» está repetido."));
            }
            if !KINDS.contains(&attribute.kind.as_str()) {
                return Err(format!("Elige el tipo de «{name}»."));
            }
            let mut options = Vec::new();
            if attribute.kind == "list" {
                let mut seen = HashSet::new();
                for option in &attribute.options {
                    let option = text(option, 40, false, &format!("las opciones de «{name}»"))?;
                    if !option.is_empty() && seen.insert(option.to_lowercase()) {
                        options.push(option);
                    }
                }
                if options.is_empty() || options.len() > MAX_OPTIONS {
                    return Err(format!(
                        "«{name}» necesita entre 1 y {MAX_OPTIONS} opciones."
                    ));
                }
            }
            Ok(AttributeInput {
                id: attribute.id,
                name,
                kind: attribute.kind.clone(),
                options,
                required: attribute.required,
            })
        })
        .collect()
}

fn in_use(c: &Connection, attribute_id: i64, value: Option<&str>) -> Result<bool> {
    c.query_row(
        "SELECT EXISTS(SELECT 1 FROM product_attributes WHERE attribute_id=?1 AND (?2 IS NULL OR value=?2))",
        params![attribute_id, value],
        |r| r.get(0),
    )
    .map_err(sql)
}

pub fn save_category(c: &mut Connection, input: CategoryInput) -> Result<i64> {
    let name = text(&input.name, 80, true, "el nombre de la categoría")?;
    let attributes = clean_attributes(&input.attributes)?;
    let tx = c
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(sql)?;
    if let Some(id) = input.id {
        parent_of(&tx, id)?.ok_or("La categoría no existe.")?;
    }
    let has_children = match input.id {
        Some(id) => tx
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM categories WHERE parent_id=?1)",
                params![id],
                |r| r.get(0),
            )
            .map_err(sql)?,
        None => false,
    };
    if let Some(parent) = input.parent_id {
        if Some(parent) == input.id {
            return Err("Una categoría no puede estar dentro de sí misma.".into());
        }
        let grandparent = parent_of(&tx, parent)?.ok_or("La categoría superior no existe.")?;
        if grandparent.is_some() {
            return Err("Solo se permite un nivel de subcategorías.".into());
        }
        if has_children {
            return Err("Tiene subcategorías, así que no puede ir dentro de otra.".into());
        }
    }
    // Los nombres no pueden repetirse entre una categoría y su categoría superior o sus subcategorías.
    let mut related: Vec<String> = Vec::new();
    if let Some(parent) = input.parent_id {
        related.extend(own_attributes(&tx, parent)?.into_iter().map(|a| a.name));
    }
    if let Some(id) = input.id.filter(|_| has_children) {
        let mut stmt = tx
            .prepare("SELECT a.name FROM category_attributes a JOIN categories c ON c.id=a.category_id WHERE c.parent_id=?1")
            .map_err(sql)?;
        let names = stmt
            .query_map(params![id], |r| r.get::<_, String>(0))
            .map_err(sql)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(sql)?;
        related.extend(names);
    }
    if let Some(clash) = attributes.iter().find(|a| {
        related
            .iter()
            .any(|other| other.to_lowercase() == a.name.to_lowercase())
    }) {
        return Err(format!(
            "«{}» ya existe en una categoría relacionada.",
            clash.name
        ));
    }

    let id = match input.id {
        Some(id) => {
            tx.execute(
                "UPDATE categories SET name=?1,parent_id=?2 WHERE id=?3",
                params![name, input.parent_id, id],
            )
            .map_err(sql)?;
            id
        }
        None => {
            tx.execute(
                "INSERT INTO categories(name,parent_id) VALUES(?1,?2)",
                params![name, input.parent_id],
            )
            .map_err(sql)?;
            tx.last_insert_rowid()
        }
    };

    let existing: BTreeMap<i64, Attribute> = own_attributes(&tx, id)?
        .into_iter()
        .map(|a| (a.id, a))
        .collect();
    let kept: HashSet<i64> = attributes.iter().filter_map(|a| a.id).collect();
    for attribute in &attributes {
        let Some(attribute_id) = attribute.id else {
            continue;
        };
        let previous = existing
            .get(&attribute_id)
            .ok_or("Un atributo ya no existe. Vuelve a abrir la categoría.")?;
        if previous.kind != attribute.kind && in_use(&tx, attribute_id, None)? {
            return Err(format!(
                "«{}» ya tiene valores en productos; no se puede cambiar su tipo.",
                attribute.name
            ));
        }
        if attribute.kind == "list" {
            for option in previous
                .options
                .iter()
                .filter(|o| !attribute.options.contains(o))
            {
                if in_use(&tx, attribute_id, Some(option))? {
                    return Err(format!(
                        "«{option}» de {} está en uso en productos.",
                        attribute.name
                    ));
                }
            }
        }
    }
    for removed in existing.keys().filter(|id| !kept.contains(id)) {
        tx.execute(
            "DELETE FROM product_attributes WHERE attribute_id=?1",
            params![removed],
        )
        .map_err(sql)?;
        tx.execute(
            "DELETE FROM category_attributes WHERE id=?1",
            params![removed],
        )
        .map_err(sql)?;
    }
    // Nombre temporal para permitir intercambiar nombres sin chocar con la restricción única.
    for attribute_id in &kept {
        tx.execute(
            "UPDATE category_attributes SET name='~'||id WHERE id=?1",
            params![attribute_id],
        )
        .map_err(sql)?;
    }
    for (position, attribute) in attributes.iter().enumerate() {
        let options = serde_json::to_string(&attribute.options).map_err(|e| e.to_string())?;
        match attribute.id {
            Some(attribute_id) => tx.execute(
                "UPDATE category_attributes SET name=?1,kind=?2,options_json=?3,required=?4,position=?5 WHERE id=?6",
                params![attribute.name, attribute.kind, options, attribute.required, position as i64, attribute_id],
            ),
            None => tx.execute(
                "INSERT INTO category_attributes(category_id,name,kind,options_json,required,position) VALUES(?1,?2,?3,?4,?5,?6)",
                params![id, attribute.name, attribute.kind, options, attribute.required, position as i64],
            ),
        }
        .map_err(sql)?;
    }
    // Quitar valores que dejaron de aplicar, por ejemplo al mover la categoría a otra superior.
    tx.execute(
        "DELETE FROM product_attributes WHERE product_id IN (SELECT id FROM products WHERE category_id=?1)
         AND attribute_id NOT IN (SELECT id FROM category_attributes WHERE category_id=?1 OR category_id=?2)",
        params![id, input.parent_id],
    )
    .map_err(sql)?;
    tx.commit().map_err(sql)?;
    Ok(id)
}

pub fn delete_category(c: &mut Connection, id: i64) -> Result<()> {
    let tx = c
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(sql)?;
    parent_of(&tx, id)?.ok_or("La categoría no existe.")?;
    let (products, children): (bool, bool) = tx
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM products WHERE category_id=?1),EXISTS(SELECT 1 FROM categories WHERE parent_id=?1)",
            params![id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(sql)?;
    if products {
        return Err("Tiene productos. Muévelos a otra categoría antes de eliminarla.".into());
    }
    if children {
        return Err("Tiene subcategorías. Elimínalas o muévelas primero.".into());
    }
    tx.execute(
        "DELETE FROM product_attributes WHERE attribute_id IN (SELECT id FROM category_attributes WHERE category_id=?1)",
        params![id],
    )
    .map_err(sql)?;
    tx.execute(
        "DELETE FROM category_attributes WHERE category_id=?1",
        params![id],
    )
    .map_err(sql)?;
    tx.execute("DELETE FROM categories WHERE id=?1", params![id])
        .map_err(sql)?;
    tx.commit().map_err(sql)
}

fn is_number(value: &str) -> bool {
    let digits = value.strip_prefix('-').unwrap_or(value);
    let mut parts = digits.split('.');
    let whole = parts.next().unwrap_or("");
    let fraction = parts.next();
    parts.next().is_none()
        && !whole.is_empty()
        && whole.bytes().all(|b| b.is_ascii_digit())
        && fraction.is_none_or(|f| !f.is_empty() && f.bytes().all(|b| b.is_ascii_digit()))
}

/// Valida los valores contra los atributos de la categoría y devuelve los que se guardan.
pub fn validate_values(
    attributes: &[Attribute],
    input: &[AttributeValueInput],
) -> Result<Vec<(i64, String)>> {
    let mut given: BTreeMap<i64, &str> = BTreeMap::new();
    for value in input {
        if !attributes.iter().any(|a| a.id == value.attribute_id) {
            return Err(
                "Un atributo ya no pertenece a la categoría. Vuelve a abrir el producto.".into(),
            );
        }
        if given.insert(value.attribute_id, &value.value).is_some() {
            return Err("Hay un atributo repetido.".into());
        }
    }
    let mut values = Vec::new();
    for attribute in attributes {
        let value = text(
            given.get(&attribute.id).copied().unwrap_or(""),
            120,
            false,
            &attribute.name,
        )?;
        if value.is_empty() {
            if attribute.required {
                return Err(format!("Completa {}.", attribute.name));
            }
            continue;
        }
        match attribute.kind.as_str() {
            "number" if !is_number(&value) => {
                return Err(format!("{} debe ser un número.", attribute.name));
            }
            "list" if !attribute.options.contains(&value) => {
                return Err(format!("Elige una opción de {}.", attribute.name));
            }
            _ => {}
        }
        values.push((attribute.id, value));
    }
    Ok(values)
}

pub fn validate_tags(input: &[String]) -> Result<Vec<String>> {
    let mut seen = HashSet::new();
    let mut tags = Vec::new();
    for tag in input {
        let tag = text(tag, 30, false, "las etiquetas")?;
        if tag.contains(',') {
            return Err("Las etiquetas no pueden llevar comas.".into());
        }
        if !tag.is_empty() && seen.insert(tag.to_lowercase()) {
            tags.push(tag);
        }
    }
    if tags.len() > MAX_TAGS {
        return Err(format!("Máximo {MAX_TAGS} etiquetas por producto."));
    }
    Ok(tags)
}

pub fn put_details(
    c: &Connection,
    product_id: i64,
    values: &[(i64, String)],
    tags: &[String],
) -> Result<()> {
    c.execute(
        "DELETE FROM product_attributes WHERE product_id=?1",
        params![product_id],
    )
    .map_err(sql)?;
    for (attribute_id, value) in values {
        c.execute(
            "INSERT INTO product_attributes(product_id,attribute_id,value) VALUES(?1,?2,?3)",
            params![product_id, attribute_id, value],
        )
        .map_err(sql)?;
    }
    c.execute(
        "DELETE FROM product_tags WHERE product_id=?1",
        params![product_id],
    )
    .map_err(sql)?;
    for tag in tags {
        c.execute(
            "INSERT INTO product_tags(product_id,tag) VALUES(?1,?2)",
            params![product_id, tag],
        )
        .map_err(sql)?;
    }
    Ok(())
}

/// Atributos y etiquetas vigentes del producto, en el orden de la categoría.
pub fn details(c: &Connection, product_id: i64) -> Result<(Vec<AttributeValue>, Vec<String>)> {
    let attributes = c
        .prepare(
            "SELECT a.id,a.name,a.kind,v.value FROM product_attributes v
             JOIN category_attributes a ON a.id=v.attribute_id
             JOIN products p ON p.id=v.product_id LEFT JOIN categories c ON c.id=p.category_id
             WHERE v.product_id=?1 AND (a.category_id=p.category_id OR a.category_id=c.parent_id)
             ORDER BY a.category_id=p.category_id,a.position,a.id",
        )
        .map_err(sql)?
        .query_map(params![product_id], |r| {
            Ok(AttributeValue {
                attribute_id: r.get(0)?,
                name: r.get(1)?,
                kind: r.get(2)?,
                value: r.get(3)?,
            })
        })
        .map_err(sql)?
        .collect::<rusqlite::Result<_>>()
        .map_err(sql)?;
    let tags = c
        .prepare("SELECT tag FROM product_tags WHERE product_id=?1 ORDER BY tag")
        .map_err(sql)?
        .query_map(params![product_id], |r| r.get(0))
        .map_err(sql)?
        .collect::<rusqlite::Result<_>>()
        .map_err(sql)?;
    Ok((attributes, tags))
}

/// Convierte una carta del formato anterior en atributos para mostrar ventas antiguas.
pub fn legacy_card(card: &CardDetails) -> Vec<AttributeValue> {
    let pairs = [
        ("Juego", "text", card.game.clone()),
        ("Expansión", "text", card.expansion.clone()),
        ("Número", "text", card.number.clone()),
        ("Idioma", "list", label(&LANGUAGES, &card.language)),
        ("Condición", "list", card.condition.clone()),
        ("Acabado", "list", label(&FINISHES, &card.finish)),
    ];
    pairs
        .into_iter()
        .filter(|(_, _, value)| !value.trim().is_empty())
        .map(|(name, kind, value)| AttributeValue {
            attribute_id: 0,
            name: name.into(),
            kind: kind.into(),
            value,
        })
        .collect()
}

/// Pasa las cartas guardadas con el formato anterior a atributos de su categoría.
/// Las cartas sin categoría se agrupan en «Cartas TCG».
pub fn migrate_cards(c: &Connection) -> Result<()> {
    let rows: Vec<(i64, Option<i64>, String)> = c
        .prepare(
            "SELECT id,category_id,card_json FROM products WHERE card_json NOT IN ('','{}','null')",
        )
        .map_err(sql)?
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
        .map_err(sql)?
        .collect::<rusqlite::Result<_>>()
        .map_err(sql)?;
    let cards: Vec<(i64, Option<i64>, CardDetails)> = rows
        .into_iter()
        .filter_map(|(id, category, json)| {
            serde_json::from_str::<Option<CardDetails>>(&json)
                .ok()
                .flatten()
                .map(|card| (id, category, card))
        })
        .collect();
    if cards.is_empty() {
        return Ok(());
    }
    let mut fallback = None;
    let mut by_category: BTreeMap<i64, Vec<(i64, CardDetails)>> = BTreeMap::new();
    for (product_id, category, card) in cards {
        let category = match category {
            Some(id) => id,
            None => {
                if fallback.is_none() {
                    let existing: Option<i64> = c
                        .query_row(
                            "SELECT id FROM categories WHERE name='Cartas TCG'",
                            [],
                            |r| r.get(0),
                        )
                        .optional()
                        .map_err(sql)?;
                    fallback = Some(match existing {
                        Some(id) => id,
                        None => {
                            c.execute("INSERT INTO categories(name) VALUES('Cartas TCG')", [])
                                .map_err(sql)?;
                            c.last_insert_rowid()
                        }
                    });
                }
                let id = fallback.unwrap_or_default();
                c.execute(
                    "UPDATE products SET category_id=?1 WHERE id=?2",
                    params![id, product_id],
                )
                .map_err(sql)?;
                id
            }
        };
        by_category
            .entry(category)
            .or_default()
            .push((product_id, card));
    }
    let languages: Vec<&str> = LANGUAGES.iter().map(|(_, name)| *name).collect();
    let finishes: Vec<&str> = FINISHES.iter().map(|(_, name)| *name).collect();
    let template: [(&str, &str, Vec<&str>); 6] = [
        ("Juego", "text", vec![]),
        ("Expansión", "text", vec![]),
        ("Número", "text", vec![]),
        ("Idioma", "list", languages),
        ("Condición", "list", CONDITIONS.to_vec()),
        ("Acabado", "list", finishes),
    ];
    for (category, products) in by_category {
        let total: i64 = c
            .query_row(
                "SELECT count(*) FROM products WHERE category_id=?1",
                params![category],
                |r| r.get(0),
            )
            .map_err(sql)?;
        // Obligatorios solo si la categoría contiene únicamente cartas.
        let required = total == products.len() as i64;
        let mut ids = BTreeMap::new();
        for (position, (name, kind, options)) in template.iter().enumerate() {
            let options = serde_json::to_string(options).map_err(|e| e.to_string())?;
            c.execute(
                "INSERT INTO category_attributes(category_id,name,kind,options_json,required,position) VALUES(?1,?2,?3,?4,?5,?6)",
                params![category, name, kind, options, required, position as i64],
            )
            .map_err(sql)?;
            ids.insert(*name, c.last_insert_rowid());
        }
        for (product_id, card) in products {
            for value in legacy_card(&card) {
                c.execute(
                    "INSERT INTO product_attributes(product_id,attribute_id,value) VALUES(?1,?2,?3)",
                    params![product_id, ids[value.name.as_str()], value.value],
                )
                .map_err(sql)?;
            }
        }
    }
    Ok(())
}
