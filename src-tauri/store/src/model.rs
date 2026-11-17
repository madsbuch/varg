//! What crosses the bridge to the app: the training data as the TypeScript
//! side's types (src/types.ts), camelCase, strict both ways. An input with
//! an unknown field, a wrong type or an unknown enum value is refused, never
//! coerced; the app maps its own objects to these shapes field by field.
//!
//! Program templates and chat rows are JSON objects here: their shape is the
//! app's (a Template is the player's whole prescription), and the app decodes
//! them strictly on every load. Rust guarantees they are JSON objects.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Category {
    Strength,
    Bodyweight,
    Cardio,
    Ruck,
    Core,
    Conditioning,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Metric {
    WeightReps,
    Reps,
    Time,
    DistanceTime,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum PrKind {
    #[serde(rename = "1rm")]
    OneRm,
    #[serde(rename = "weight")]
    Weight,
    #[serde(rename = "reps")]
    Reps,
    #[serde(rename = "time")]
    Time,
    #[serde(rename = "distance")]
    Distance,
}

/// The text a value is stored as: its serde name, so the column holds what
/// the app has always written ("weight_reps", "1rm").
pub fn enum_text<T: Serialize>(v: T) -> Result<String, String> {
    match serde_json::to_value(v) {
        Ok(Value::String(s)) => Ok(s),
        Ok(other) => Err(format!("enum stored as {other}")),
        Err(e) => Err(e.to_string()),
    }
}

/// The value a stored text names, or an error naming the column.
pub fn enum_from_text<T: for<'de> Deserialize<'de>>(s: &str, column: &str) -> Result<T, String> {
    serde_json::from_value(Value::String(s.to_owned())).map_err(|_| format!("{column}: unknown value \"{s}\""))
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Exercise {
    pub id: String,
    pub name: String,
    pub category: Category,
    pub metric: Metric,
    pub muscles: Vec<String>,
    pub built_in: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HeartRate {
    pub avg: f64,
    pub max: f64,
    pub every: f64,
    pub trace: Vec<f64>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkoutSet {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub weight: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reps: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub seconds: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub meters: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rpe: Option<f64>,
    pub done: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SessionEntry {
    pub id: String,
    pub exercise_id: String,
    pub sets: Vec<WorkoutSet>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Session {
    pub id: String,
    pub name: String,
    pub date: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub finished_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub template_id: Option<String>,
    pub entries: Vec<SessionEntry>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub heart_rate: Option<HeartRate>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PersonalRecord {
    pub id: String,
    pub exercise_id: String,
    pub kind: PrKind,
    pub value: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reps: Option<i32>,
    pub date: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    pub manual: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SavedProgram {
    pub id: String,
    pub template: Map<String, Value>,
    pub saved_at: String,
}

/// One chat row: an item the owner sees, or a message the model sees.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChatRow {
    pub id: String,
    pub seq: i32,
    pub body: Map<String, Value>,
}

/// Everything the app holds in memory, read in one go at launch.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Snapshot {
    pub exercises: Vec<Exercise>,
    pub sessions: Vec<Session>,
    pub prs: Vec<PersonalRecord>,
    pub programs: Vec<SavedProgram>,
    pub mimir_items: Vec<ChatRow>,
    pub mimir_messages: Vec<ChatRow>,
    /// Rows the store could not read, each with why. The rest still loads;
    /// the app shows these in red rather than dropping them quietly.
    pub problems: Vec<String>,
}

/// One cached file's description (its bytes travel separately).
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BlobInfo {
    pub key: String,
    pub title: String,
    /// The file's media type ("audio/mpeg"), so it plays back as it was fetched.
    pub mime: String,
    pub created_at: String,
}
