//! What crosses the bridge to the app: the training data as the TypeScript
//! side's types (src/types.ts), camelCase, strict both ways. An input with
//! an unknown field, a wrong type or an unknown enum value is refused, never
//! coerced; the app maps its own objects to these shapes field by field.
//!
//! Every shape is typed here as it is in the app (src/lib/schema.ts, zod):
//! templates and their plans, the chat, the training data. No JSON passes
//! through untyped. Fixtures written by scripts/store.test.ts hold the two
//! definitions together (the app's writes, every enum's values).

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

use serde_json::Value;
use serde_repr::{Deserialize_repr, Serialize_repr};

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

/* ------------------------------- Templates ------------------------------- */
// The same shapes as src/lib/schema.ts (TemplateSchema and its parts).

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Level {
    Beginner,
    Intermediate,
    Advanced,
}

/// Music intensity: 1 low, 2 mid, 3 peak. A number in JSON, never a string.
#[derive(Serialize_repr, Deserialize_repr, Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum Intensity {
    Low = 1,
    Mid = 2,
    Peak = 3,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Side {
    Left,
    Right,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum PerSide {
    Leg,
    Arm,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum SetId {
    Techno,
    JazzHouse,
    Anthems,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "camelCase")]
pub enum GearId {
    SpinBike,
    AirBike,
    Rower,
    ChestStrap,
    Barbell,
    Rack,
    Bench,
    Kettlebell,
    CarryPair,
    Sled,
    WallBall,
    MedBall,
    PullUpBar,
    Rings,
    DipBars,
    Band,
    BandOrPack,
    Box,
    JumpRope,
    Ruck,
    Vest,
    Mat,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MusicProfile {
    pub bpm: i32,
    pub style: String,
    pub theme: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub set: Option<SetId>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub energy: Option<Intensity>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TemplateGear {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub extra: Option<Vec<GearId>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<BTreeMap<GearId, String>>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EmomStation {
    pub exercise_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reps: Option<Vec<i32>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub seconds: Option<Vec<i32>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub per_side: Option<PerSide>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub focus: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EmomWarmup {
    pub exercise_id: String,
    pub seconds: i32,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FlowStep {
    pub exercise_id: String,
    pub seconds: i32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub side: Option<Side>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ForTimeStage {
    pub exercise_id: String,
    pub label: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reps: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub meters: Option<i32>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RideSegment {
    pub label: String,
    pub ftp: (f64, f64),
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub seconds: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kcal: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cadence: Option<(f64, f64)>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hr_zone: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub intensity: Option<Intensity>,
}

/// How a workout runs: exactly one kind (PlanSchema).
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase", deny_unknown_fields)]
pub enum Plan {
    Interval {
        stations: Vec<String>,
        work: i32,
        rest: i32,
        rounds: i32,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        note: Option<String>,
    },
    Emom {
        minute: i32,
        rounds: i32,
        stations: Vec<EmomStation>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        warmup: Option<Vec<EmomWarmup>>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        note: Option<String>,
    },
    Flow {
        steps: Vec<FlowStep>,
        transition: i32,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        note: Option<String>,
    },
    ForTime {
        stages: Vec<ForTimeStage>,
        scheme: String,
        estimate_minutes: i32,
    },
    Ride {
        segments: Vec<RideSegment>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        race: Option<bool>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        free: Option<bool>,
        scheme: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        estimate_minutes: Option<i32>,
    },
    Logged {
        exercises: Vec<String>,
        scheme: String,
        estimate_minutes: i32,
    },
}

/// A workout: a built-in or one Mímir wrote (TemplateSchema).
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Template {
    pub id: String,
    pub name: String,
    pub branch: String,
    pub description: String,
    pub level: Level,
    pub plan: Plan,
    pub music: MusicProfile,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub gear: Option<TemplateGear>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SavedProgram {
    pub id: String,
    pub template: Template,
    pub saved_at: String,
}

/* --------------------------------- Mímir ---------------------------------- */

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ToolType {
    Function,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct ToolFunction {
    pub name: String,
    pub arguments: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct ToolCall {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: ToolType,
    pub function: ToolFunction,
}

/// The model's history, OpenAI style (ChatMessageSchema). Field names are
/// the API's own (`tool_calls`, `tool_call_id`).
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(tag = "role", rename_all = "lowercase", deny_unknown_fields)]
pub enum ChatMessage {
    System {
        content: String,
    },
    User {
        content: String,
    },
    Assistant {
        /// null when the model only called tools: always written, never left out.
        content: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        tool_calls: Option<Vec<ToolCall>>,
    },
    Tool {
        tool_call_id: String,
        content: String,
    },
}

/// What the owner sees in the chat (ChatItemSchema).
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(tag = "kind", rename_all = "lowercase", rename_all_fields = "camelCase", deny_unknown_fields)]
pub enum ChatItem {
    User {
        text: String,
    },
    Mimir {
        text: String,
    },
    Error {
        text: String,
    },
    Pick {
        template_id: String,
        why: String,
    },
    Program {
        /// Boxed: a template is far larger than the other cards.
        template: Box<Template>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        replaces: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        saved: Option<bool>,
    },
}

/// One chat row: its id, its place in the order, what it holds.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChatEntry<T> {
    pub id: String,
    pub seq: i32,
    pub body: T,
}

/// Everything the app holds in memory, read in one go at launch.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Snapshot {
    pub exercises: Vec<Exercise>,
    pub sessions: Vec<Session>,
    pub prs: Vec<PersonalRecord>,
    pub programs: Vec<SavedProgram>,
    pub mimir_items: Vec<ChatEntry<ChatItem>>,
    pub mimir_messages: Vec<ChatEntry<ChatMessage>>,
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
