ALTER TABLE categories ADD COLUMN parent_id INTEGER REFERENCES categories(id);
CREATE INDEX categories_parent ON categories(parent_id);
CREATE TABLE category_attributes (
 id INTEGER PRIMARY KEY, category_id INTEGER NOT NULL REFERENCES categories(id),
 name TEXT NOT NULL COLLATE NOCASE CHECK(length(trim(name)) BETWEEN 1 AND 40),
 kind TEXT NOT NULL CHECK(kind IN('text','number','list')),
 options_json TEXT NOT NULL DEFAULT '[]',
 required INTEGER NOT NULL DEFAULT 0 CHECK(required IN(0,1)),
 position INTEGER NOT NULL DEFAULT 0,
 UNIQUE(category_id,name)
) STRICT;
CREATE TABLE product_attributes (
 product_id INTEGER NOT NULL REFERENCES products(id),
 attribute_id INTEGER NOT NULL REFERENCES category_attributes(id),
 value TEXT NOT NULL CHECK(length(trim(value)) BETWEEN 1 AND 120),
 PRIMARY KEY(product_id,attribute_id)
) STRICT;
CREATE INDEX product_attributes_attribute ON product_attributes(attribute_id);
CREATE TABLE product_tags (
 product_id INTEGER NOT NULL REFERENCES products(id),
 tag TEXT NOT NULL COLLATE NOCASE CHECK(length(trim(tag)) BETWEEN 1 AND 30),
 PRIMARY KEY(product_id,tag)
) STRICT;
ALTER TABLE sale_items ADD COLUMN attributes_json TEXT NOT NULL DEFAULT '[]';
