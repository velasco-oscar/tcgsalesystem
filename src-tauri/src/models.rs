use serde::{Deserialize, Serialize};

// Formato anterior de cartas TCG; solo se lee para migrar productos y mostrar ventas antiguas.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CardDetails {
    pub game: String,
    pub expansion: String,
    pub number: String,
    pub language: String,
    pub condition: String,
    pub finish: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProductInput {
    pub id: Option<i64>,
    pub sku: String,
    pub name: String,
    pub category_id: Option<i64>,
    pub variant: String,
    pub attributes: Vec<AttributeValueInput>,
    pub tags: Vec<String>,
    pub price: String,
    pub cost: String,
    pub initial_stock: i64,
    pub active: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Product {
    pub id: i64,
    pub sku: String,
    pub name: String,
    pub category_id: Option<i64>,
    pub category: Option<String>,
    pub variant: String,
    pub attributes: Vec<AttributeValue>,
    pub tags: Vec<String>,
    pub price: i64,
    pub cost: i64,
    pub stock: i64,
    pub active: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AttributeValueInput {
    pub attribute_id: i64,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AttributeValue {
    // 0 en ventas anteriores a los atributos.
    #[serde(default)]
    pub attribute_id: i64,
    pub name: String,
    pub kind: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Attribute {
    pub id: i64,
    pub name: String,
    pub kind: String,
    pub options: Vec<String>,
    pub required: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Category {
    pub id: i64,
    pub name: String,
    pub parent_id: Option<i64>,
    pub attributes: Vec<Attribute>,
    pub product_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AttributeInput {
    pub id: Option<i64>,
    pub name: String,
    pub kind: String,
    pub options: Vec<String>,
    pub required: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CategoryInput {
    pub id: Option<i64>,
    pub name: String,
    pub parent_id: Option<i64>,
    pub attributes: Vec<AttributeInput>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Movement {
    pub id: i64,
    pub created_at: String,
    pub quantity: i64,
    pub kind: String,
    pub reason: String,
    pub sale_id: Option<i64>,
    pub cancellation_id: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CartLine {
    pub product_id: i64,
    pub quantity: i64,
    pub price: i64,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Checkout {
    pub request_id: String,
    pub currency_code: String,
    pub lines: Vec<CartLine>,
    pub method: String,
    pub received: String,
    pub payment_confirmed: bool,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaleItem {
    pub product_id: i64,
    pub sku: String,
    pub name: String,
    pub variant: String,
    pub attributes: Vec<AttributeValue>,
    pub quantity: i64,
    pub price: i64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Cancellation {
    pub id: i64,
    pub created_at: String,
    pub reason: String,
    pub refund: i64,
    pub method: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Sale {
    pub id: i64,
    pub folio: String,
    pub created_at: String,
    pub currency_code: String,
    pub store_name: String,
    pub method: String,
    pub total: i64,
    pub received: Option<i64>,
    pub change: Option<i64>,
    pub items: Vec<SaleItem>,
    pub cancellation: Option<Cancellation>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Period {
    pub from: String,
    pub to: String,
    pub folio: String,
    pub status: String,
    pub offset: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaleSummary {
    pub id: i64,
    pub folio: String,
    pub created_at: String,
    pub total: i64,
    pub currency_code: String,
    pub method: String,
    pub cancelled_at: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub sales_count: i64,
    pub sales_total: i64,
    pub cancellations_count: i64,
    pub cancellations_total: i64,
    pub net: i64,
    pub time_zone: String,
}
