PRAGMA application_id = 1413695312;
ALTER TABLE app_settings ADD COLUMN time_zone TEXT NOT NULL DEFAULT 'America/Tijuana';
CREATE TABLE categories (
 id INTEGER PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK(length(trim(name)) BETWEEN 1 AND 80)
) STRICT;
CREATE TABLE products (
 id INTEGER PRIMARY KEY, sku TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK(length(sku) BETWEEN 1 AND 60),
 name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 160), category_id INTEGER REFERENCES categories(id),
 variant TEXT NOT NULL DEFAULT '' CHECK(length(variant)<=120), card_json TEXT NOT NULL DEFAULT '{}',
 price INTEGER NOT NULL CHECK(price BETWEEN 1 AND 9000000000000),
 cost INTEGER NOT NULL CHECK(cost BETWEEN 0 AND 9000000000000),
 stock INTEGER NOT NULL DEFAULT 0 CHECK(stock BETWEEN 0 AND 1000000000),
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1)),
 created_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;
CREATE TABLE sales (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 request_id TEXT NOT NULL UNIQUE, request_payload TEXT NOT NULL,
 created_at TEXT NOT NULL, currency_code TEXT NOT NULL, store_name TEXT NOT NULL,
 method TEXT NOT NULL CHECK(method IN('cash','card','transfer')),
 total INTEGER NOT NULL CHECK(total BETWEEN 1 AND 9000000000000),
 received INTEGER, change INTEGER,
 CHECK((method='cash' AND received>=total AND change=received-total) OR
       (method IN('card','transfer') AND received IS NULL AND change IS NULL))
) STRICT;
CREATE TABLE sale_items (
 id INTEGER PRIMARY KEY, sale_id INTEGER NOT NULL REFERENCES sales(id), product_id INTEGER NOT NULL REFERENCES products(id),
 sku TEXT NOT NULL, name TEXT NOT NULL, variant TEXT NOT NULL, card_json TEXT NOT NULL,
 quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 1000000),
 price INTEGER NOT NULL CHECK(price BETWEEN 1 AND 9000000000000), UNIQUE(sale_id,product_id)
) STRICT;
CREATE TABLE cancellations (
 id INTEGER PRIMARY KEY, sale_id INTEGER NOT NULL UNIQUE REFERENCES sales(id),
 created_at TEXT NOT NULL, reason TEXT NOT NULL CHECK(length(trim(reason)) BETWEEN 1 AND 500),
 refund INTEGER NOT NULL CHECK(refund>0), method TEXT NOT NULL CHECK(method IN('cash','card','transfer'))
) STRICT;
CREATE TABLE stock_movements (
 id INTEGER PRIMARY KEY, product_id INTEGER NOT NULL REFERENCES products(id),
 created_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 quantity INTEGER NOT NULL CHECK(quantity != 0 AND quantity BETWEEN -1000000 AND 1000000),
 kind TEXT NOT NULL CHECK(kind IN('initial','entry','adjustment','sale','cancellation')),
 reason TEXT NOT NULL CHECK(length(trim(reason)) BETWEEN 1 AND 500),
 sale_id INTEGER REFERENCES sales(id), cancellation_id INTEGER REFERENCES cancellations(id),
 CHECK((kind='sale' AND sale_id IS NOT NULL AND cancellation_id IS NULL AND quantity<0) OR
 (kind='cancellation' AND cancellation_id IS NOT NULL AND sale_id IS NOT NULL AND quantity>0) OR
 (kind IN('initial','entry','adjustment') AND sale_id IS NULL AND cancellation_id IS NULL)),
 CHECK(kind NOT IN('initial','entry') OR quantity>0)
) STRICT;
CREATE UNIQUE INDEX unique_sale_movement ON stock_movements(sale_id,product_id) WHERE kind='sale';
CREATE UNIQUE INDEX unique_cancellation_movement ON stock_movements(cancellation_id,product_id) WHERE kind='cancellation';
CREATE UNIQUE INDEX unique_initial_movement ON stock_movements(product_id) WHERE kind='initial';
CREATE INDEX movements_product_date ON stock_movements(product_id,id);
CREATE INDEX sales_date ON sales(created_at);
CREATE INDEX cancellation_date ON cancellations(created_at);
CREATE TRIGGER stock_bounds BEFORE INSERT ON stock_movements BEGIN
 SELECT CASE WHEN (SELECT stock+NEW.quantity FROM products WHERE id=NEW.product_id) NOT BETWEEN 0 AND 1000000000
 THEN RAISE(ABORT,'Existencias insuficientes o fuera de límite') END;
END;
CREATE TRIGGER apply_stock AFTER INSERT ON stock_movements BEGIN
 UPDATE products SET stock=stock+NEW.quantity WHERE id=NEW.product_id;
END;
CREATE TRIGGER immutable_movement_update BEFORE UPDATE ON stock_movements BEGIN SELECT RAISE(ABORT,'Movimiento inmutable'); END;
CREATE TRIGGER immutable_movement_delete BEFORE DELETE ON stock_movements BEGIN SELECT RAISE(ABORT,'Movimiento inmutable'); END;
CREATE TRIGGER preserve_product BEFORE DELETE ON products WHEN EXISTS(SELECT 1 FROM stock_movements WHERE product_id=OLD.id)
 BEGIN SELECT RAISE(ABORT,'El producto tiene movimientos'); END;
CREATE TRIGGER immutable_sale BEFORE UPDATE ON sales BEGIN SELECT RAISE(ABORT,'Venta inmutable'); END;
CREATE TRIGGER preserve_sale BEFORE DELETE ON sales BEGIN SELECT RAISE(ABORT,'Venta inmutable'); END;
CREATE TRIGGER immutable_item BEFORE UPDATE ON sale_items BEGIN SELECT RAISE(ABORT,'Partida inmutable'); END;
CREATE TRIGGER preserve_item BEFORE DELETE ON sale_items BEGIN SELECT RAISE(ABORT,'Partida inmutable'); END;
CREATE TRIGGER immutable_cancel BEFORE UPDATE ON cancellations BEGIN SELECT RAISE(ABORT,'Anulación inmutable'); END;
CREATE TRIGGER preserve_cancel BEFORE DELETE ON cancellations BEGIN SELECT RAISE(ABORT,'Anulación inmutable'); END;
