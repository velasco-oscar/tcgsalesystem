ALTER TABLE app_settings ADD COLUMN business_sector TEXT NOT NULL DEFAULT ''
    CHECK (length(business_sector) <= 80);
ALTER TABLE app_settings ADD COLUMN currency_code TEXT NOT NULL DEFAULT ''
    CHECK (currency_code = '' OR (length(currency_code) = 3 AND currency_code NOT GLOB '*[^A-Z]*'));
