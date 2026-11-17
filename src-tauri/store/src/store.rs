use std::collections::{HashMap, HashSet};
use std::fmt;
use std::path::Path;
use std::sync::Mutex;

use diesel::prelude::*;
use diesel::sql_types::Text;
use diesel::sqlite::SqliteConnection;
use diesel_migrations::{embed_migrations, EmbeddedMigrations, MigrationHarness};
use serde_json::Value;

use crate::legacy::{read_chat_item, read_template};

use crate::model::{
    enum_from_text, enum_text, BlobInfo, ChatEntry, ChatItem, ChatMessage, Exercise, HeartRate, PersonalRecord, SavedProgram, Session,
    SessionEntry, Snapshot, WorkoutSet,
};
use crate::schema::{
    blobs, exercises, mimir_items, mimir_messages, personal_records, programs, session_entries, sessions, settings,
    workout_sets,
};

pub const MIGRATIONS: EmbeddedMigrations = embed_migrations!("migrations");

/// Diesel's version for each migration the app applied while it still ran
/// Drizzle (tracked by file name in `__migrations`). Same SQL, new bookkeeping.
const DRIZZLE_TO_DIESEL: [(&str, &str); 3] = [
    ("0000_init.sql", "20250101000000"),
    ("0001_drop_splits.sql", "20250201000000"),
    ("0002_session_heart_rate.sql", "20250301000000"),
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoreError(pub String);

impl fmt::Display for StoreError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for StoreError {}

impl From<diesel::result::Error> for StoreError {
    fn from(e: diesel::result::Error) -> Self {
        StoreError(format!("database: {e}"))
    }
}

impl From<diesel::ConnectionError> for StoreError {
    fn from(e: diesel::ConnectionError) -> Self {
        StoreError(format!("open: {e}"))
    }
}

impl From<serde_json::Error> for StoreError {
    fn from(e: serde_json::Error) -> Self {
        StoreError(format!("json: {e}"))
    }
}

type Result<T> = std::result::Result<T, StoreError>;

/// The open database. One connection behind a lock: the app is one person
/// on one phone, and a single writer can never meet SQLITE_BUSY.
pub struct Store {
    conn: Mutex<SqliteConnection>,
}

/* ------------------------------- Rows ----------------------------------- */

#[derive(Queryable, Selectable, Insertable, AsChangeset)]
#[diesel(table_name = exercises, check_for_backend(diesel::sqlite::Sqlite))]
struct ExerciseRow {
    id: String,
    name: String,
    category: String,
    metric: String,
    muscles: String,
    built_in: bool,
}

#[derive(Queryable, Selectable, Insertable, AsChangeset)]
#[diesel(table_name = sessions, check_for_backend(diesel::sqlite::Sqlite), treat_none_as_null = true)]
struct SessionRow {
    id: String,
    name: String,
    date: String,
    finished_at: Option<String>,
    template_id: Option<String>,
    note: Option<String>,
    heart_rate: Option<String>,
}

#[derive(Queryable, Selectable, Insertable, AsChangeset)]
#[diesel(table_name = session_entries, check_for_backend(diesel::sqlite::Sqlite), treat_none_as_null = true)]
struct EntryRow {
    id: String,
    session_id: String,
    exercise_id: String,
    position: i32,
    note: Option<String>,
}

#[derive(Queryable, Selectable, Insertable, AsChangeset)]
#[diesel(table_name = workout_sets, check_for_backend(diesel::sqlite::Sqlite), treat_none_as_null = true)]
struct SetRow {
    id: String,
    entry_id: String,
    session_id: String,
    position: i32,
    weight: Option<f64>,
    reps: Option<i32>,
    seconds: Option<f64>,
    meters: Option<f64>,
    rpe: Option<f64>,
    done: bool,
}

#[derive(Queryable, Selectable, Insertable, AsChangeset)]
#[diesel(table_name = personal_records, check_for_backend(diesel::sqlite::Sqlite), treat_none_as_null = true)]
struct PrRow {
    id: String,
    exercise_id: String,
    kind: String,
    value: f64,
    reps: Option<i32>,
    date: String,
    session_id: Option<String>,
    note: Option<String>,
    manual: bool,
}

#[derive(Queryable, Selectable, Insertable, AsChangeset)]
#[diesel(table_name = programs, check_for_backend(diesel::sqlite::Sqlite))]
struct ProgramRow {
    id: String,
    template: String,
    saved_at: String,
}

#[derive(Queryable, Selectable, Insertable, AsChangeset)]
#[diesel(table_name = mimir_items, check_for_backend(diesel::sqlite::Sqlite))]
struct ItemRow {
    id: String,
    seq: i32,
    body: String,
}

#[derive(Queryable, Selectable, Insertable, AsChangeset)]
#[diesel(table_name = mimir_messages, check_for_backend(diesel::sqlite::Sqlite))]
struct MessageRow {
    id: String,
    seq: i32,
    body: String,
}

#[derive(Queryable, Selectable, Insertable, AsChangeset)]
#[diesel(table_name = settings, check_for_backend(diesel::sqlite::Sqlite))]
struct SettingRow {
    key: String,
    value: String,
}

#[derive(Queryable, Selectable, Insertable, AsChangeset)]
#[diesel(table_name = blobs, check_for_backend(diesel::sqlite::Sqlite))]
struct BlobRow {
    store: String,
    key: String,
    title: String,
    mime: String,
    created_at: String,
    bytes: Vec<u8>,
}

#[derive(QueryableByName)]
struct NameRow {
    #[diesel(sql_type = Text)]
    name: String,
}

/* ----------------------------- Conversions ------------------------------- */

/// The JSON text of a stored body, as a value for its typed reader.
fn json_value(text: &str, what: &str) -> std::result::Result<Value, String> {
    serde_json::from_str::<Value>(text).map_err(|e| format!("{what}: {e}"))
}

fn exercise_row(ex: &Exercise) -> Result<ExerciseRow> {
    Ok(ExerciseRow {
        id: ex.id.clone(),
        name: ex.name.clone(),
        category: enum_text(ex.category).map_err(StoreError)?,
        metric: enum_text(ex.metric).map_err(StoreError)?,
        muscles: serde_json::to_string(&ex.muscles)?,
        built_in: ex.built_in,
    })
}

fn exercise_from(row: ExerciseRow) -> std::result::Result<Exercise, String> {
    let at = format!("exercise {}", row.id);
    let muscles: Vec<String> = serde_json::from_str(&row.muscles).map_err(|e| format!("{at} muscles: {e}"))?;
    Ok(Exercise {
        category: enum_from_text(&row.category, &format!("{at} category"))?,
        metric: enum_from_text(&row.metric, &format!("{at} metric"))?,
        id: row.id,
        name: row.name,
        muscles,
        built_in: row.built_in,
    })
}

fn pr_row(p: &PersonalRecord) -> Result<PrRow> {
    Ok(PrRow {
        id: p.id.clone(),
        exercise_id: p.exercise_id.clone(),
        kind: enum_text(p.kind).map_err(StoreError)?,
        value: p.value,
        reps: p.reps,
        date: p.date.clone(),
        session_id: p.session_id.clone(),
        note: p.note.clone(),
        manual: p.manual,
    })
}

fn pr_from(row: PrRow) -> std::result::Result<PersonalRecord, String> {
    Ok(PersonalRecord {
        kind: enum_from_text(&row.kind, &format!("record {} kind", row.id))?,
        id: row.id,
        exercise_id: row.exercise_id,
        value: row.value,
        reps: row.reps,
        date: row.date,
        session_id: row.session_id,
        note: row.note,
        manual: row.manual,
    })
}



/* ------------------------------- The store ------------------------------- */

impl Store {
    /// Open (or create) the database at `path` and bring it up to date.
    pub fn open(path: &Path) -> Result<Store> {
        let url = path.to_str().ok_or_else(|| StoreError(format!("path is not UTF-8: {}", path.display())))?;
        Store::open_url(url)
    }

    /// An in-memory database, for tests.
    pub fn open_in_memory() -> Result<Store> {
        Store::open_url(":memory:")
    }

    fn open_url(url: &str) -> Result<Store> {
        let mut conn = SqliteConnection::establish(url)?;
        // Outside any transaction: SQLite ignores foreign_keys inside one.
        // The cascades from session to entries to sets depend on it, as they
        // did under the old driver (sqlx turns it on by default).
        diesel::sql_query("PRAGMA foreign_keys = ON").execute(&mut conn)?;
        diesel::sql_query("PRAGMA busy_timeout = 5000").execute(&mut conn)?;
        adopt_drizzle(&mut conn)?;
        conn.run_pending_migrations(MIGRATIONS)
            .map_err(|e| StoreError(format!("migration failed: {e}")))?;
        Ok(Store { conn: Mutex::new(conn) })
    }

    fn with<T>(&self, f: impl FnOnce(&mut SqliteConnection) -> Result<T>) -> Result<T> {
        let mut conn = self.conn.lock().map_err(|_| StoreError("database lock poisoned".into()))?;
        f(&mut conn)
    }

    /* ------------------------------ Reading ------------------------------ */

    /// Everything the app holds in memory. A row that cannot be read is
    /// skipped and named in `problems`, never silently dropped.
    pub fn load(&self) -> Result<Snapshot> {
        self.with(|c| {
            let mut snap = Snapshot::default();

            for row in exercises::table.select(ExerciseRow::as_select()).load(c)? {
                match exercise_from(row) {
                    Ok(e) => snap.exercises.push(e),
                    Err(p) => snap.problems.push(p),
                }
            }

            let mut sets_by_entry: HashMap<String, Vec<SetRow>> = HashMap::new();
            for s in workout_sets::table.select(SetRow::as_select()).order(workout_sets::position).load(c)? {
                sets_by_entry.entry(s.entry_id.clone()).or_default().push(s);
            }
            let mut entries_by_session: HashMap<String, Vec<EntryRow>> = HashMap::new();
            for e in session_entries::table.select(EntryRow::as_select()).order(session_entries::position).load(c)? {
                entries_by_session.entry(e.session_id.clone()).or_default().push(e);
            }
            for s in sessions::table.select(SessionRow::as_select()).order(sessions::date.desc()).load(c)? {
                let heart_rate = match s.heart_rate.as_deref() {
                    None => None,
                    Some(text) => match serde_json::from_str::<HeartRate>(text) {
                        Ok(hr) => Some(hr),
                        Err(e) => {
                            snap.problems.push(format!("session {} heart rate: {e}", s.id));
                            None
                        }
                    },
                };
                let entries = entries_by_session
                    .remove(&s.id)
                    .unwrap_or_default()
                    .into_iter()
                    .map(|e| SessionEntry {
                        sets: sets_by_entry
                            .remove(&e.id)
                            .unwrap_or_default()
                            .into_iter()
                            .map(|w| WorkoutSet {
                                id: w.id,
                                weight: w.weight,
                                reps: w.reps,
                                seconds: w.seconds,
                                meters: w.meters,
                                rpe: w.rpe,
                                done: w.done,
                            })
                            .collect(),
                        id: e.id,
                        exercise_id: e.exercise_id,
                        note: e.note,
                    })
                    .collect();
                snap.sessions.push(Session {
                    id: s.id,
                    name: s.name,
                    date: s.date,
                    finished_at: s.finished_at,
                    template_id: s.template_id,
                    note: s.note,
                    heart_rate,
                    entries,
                });
            }

            // The old driver stored whatever number it was given; reading a
            // REAL as Integer would truncate it without a word. Name them.
            let odd: Vec<NameRow> = diesel::sql_query(
                "SELECT id || ' (' || reps || ')' AS name FROM workout_sets \
                 WHERE reps IS NOT NULL AND typeof(reps) <> 'integer' \
                 UNION ALL SELECT id || ' (' || reps || ')' AS name FROM personal_records \
                 WHERE reps IS NOT NULL AND typeof(reps) <> 'integer'",
            )
            .load(c)?;
            for row in odd {
                snap.problems.push(format!("reps not a whole number, read as whole: {}", row.name));
            }

            for row in personal_records::table.select(PrRow::as_select()).load(c)? {
                match pr_from(row) {
                    Ok(p) => snap.prs.push(p),
                    Err(p) => snap.problems.push(p),
                }
            }

            // Programs and program cards in the old template shape are
            // converted here and written back in the new one, once.
            for row in programs::table.select(ProgramRow::as_select()).order(programs::saved_at).load(c)? {
                let what = format!("program {}", row.id);
                match json_value(&row.template, &what).and_then(|v| read_template(v).map_err(|e| format!("{what}: {e}"))) {
                    Ok((template, converted)) => {
                        if converted {
                            let text = serde_json::to_string(&template)?;
                            diesel::update(programs::table.find(&row.id)).set(programs::template.eq(text)).execute(c)?;
                        }
                        snap.programs.push(SavedProgram { id: row.id, template, saved_at: row.saved_at });
                    }
                    Err(p) => snap.problems.push(p),
                }
            }

            for row in mimir_items::table.select(ItemRow::as_select()).order(mimir_items::seq).load(c)? {
                let what = format!("chat item {}", row.id);
                match json_value(&row.body, &what).and_then(|v| read_chat_item(v).map_err(|e| format!("{what}: {e}"))) {
                    Ok((body, converted)) => {
                        if converted {
                            let text = serde_json::to_string(&body)?;
                            diesel::update(mimir_items::table.find(&row.id)).set(mimir_items::body.eq(text)).execute(c)?;
                        }
                        snap.mimir_items.push(ChatEntry { id: row.id, seq: row.seq, body });
                    }
                    Err(p) => snap.problems.push(p),
                }
            }
            for row in mimir_messages::table.select(MessageRow::as_select()).order(mimir_messages::seq).load(c)? {
                match serde_json::from_str::<ChatMessage>(&row.body) {
                    Ok(body) => snap.mimir_messages.push(ChatEntry { id: row.id, seq: row.seq, body }),
                    Err(e) => snap.problems.push(format!("chat message {}: {e}", row.id)),
                }
            }
            Ok(snap)
        })
    }

    /* --------------------------- Training data --------------------------- */

    pub fn save_exercise(&self, ex: &Exercise) -> Result<()> {
        let row = exercise_row(ex)?;
        self.with(|c| {
            diesel::insert_into(exercises::table)
                .values(&row)
                .on_conflict(exercises::id)
                .do_update()
                .set(&row)
                .execute(c)?;
            Ok(())
        })
    }

    pub fn delete_exercise(&self, id: &str) -> Result<()> {
        self.with(|c| {
            diesel::delete(exercises::table.find(id)).execute(c)?;
            Ok(())
        })
    }

    /// The session and everything under it, in one transaction: upsert what
    /// is there, delete only what disappeared. Under the old driver every
    /// statement was its own autocommit; here a failure leaves the previous
    /// rows exactly as they were.
    pub fn save_session(&self, s: &Session) -> Result<()> {
        let heart_rate = match &s.heart_rate {
            Some(hr) => Some(serde_json::to_string(hr)?),
            None => None,
        };
        let row = SessionRow {
            id: s.id.clone(),
            name: s.name.clone(),
            date: s.date.clone(),
            finished_at: s.finished_at.clone(),
            template_id: s.template_id.clone(),
            note: s.note.clone(),
            heart_rate,
        };
        let entries: Vec<EntryRow> = s
            .entries
            .iter()
            .zip(0..)
            .map(|(e, i)| EntryRow {
                id: e.id.clone(),
                session_id: s.id.clone(),
                exercise_id: e.exercise_id.clone(),
                position: i,
                note: e.note.clone(),
            })
            .collect();
        let sets: Vec<SetRow> = s
            .entries
            .iter()
            .flat_map(|e| {
                e.sets.iter().zip(0..).map(move |(w, i)| SetRow {
                    id: w.id.clone(),
                    entry_id: e.id.clone(),
                    session_id: s.id.clone(),
                    position: i,
                    weight: w.weight,
                    reps: w.reps,
                    seconds: w.seconds,
                    meters: w.meters,
                    rpe: w.rpe,
                    done: w.done,
                })
            })
            .collect();
        self.with(|c| {
            c.transaction::<_, StoreError, _>(|c| {
                diesel::insert_into(sessions::table)
                    .values(&row)
                    .on_conflict(sessions::id)
                    .do_update()
                    .set(&row)
                    .execute(c)?;
                // Entries before sets: workout_sets.entry_id is a foreign key.
                for e in &entries {
                    diesel::insert_into(session_entries::table)
                        .values(e)
                        .on_conflict(session_entries::id)
                        .do_update()
                        .set(e)
                        .execute(c)?;
                }
                for w in &sets {
                    diesel::insert_into(workout_sets::table)
                        .values(w)
                        .on_conflict(workout_sets::id)
                        .do_update()
                        .set(w)
                        .execute(c)?;
                }
                let kept_sets: Vec<&str> = sets.iter().map(|w| w.id.as_str()).collect();
                diesel::delete(
                    workout_sets::table
                        .filter(workout_sets::session_id.eq(&s.id))
                        .filter(workout_sets::id.ne_all(&kept_sets)),
                )
                .execute(c)?;
                let kept_entries: Vec<&str> = entries.iter().map(|e| e.id.as_str()).collect();
                diesel::delete(
                    session_entries::table
                        .filter(session_entries::session_id.eq(&s.id))
                        .filter(session_entries::id.ne_all(&kept_entries)),
                )
                .execute(c)?;
                Ok(())
            })
        })
    }

    pub fn delete_session(&self, id: &str) -> Result<()> {
        self.with(|c| {
            c.transaction::<_, StoreError, _>(|c| {
                diesel::delete(workout_sets::table.filter(workout_sets::session_id.eq(id))).execute(c)?;
                diesel::delete(session_entries::table.filter(session_entries::session_id.eq(id))).execute(c)?;
                diesel::delete(sessions::table.find(id)).execute(c)?;
                Ok(())
            })
        })
    }

    /// Upsert then prune, in one transaction. Manual records exist nowhere
    /// else in the app.
    pub fn replace_prs(&self, prs: &[PersonalRecord]) -> Result<()> {
        let rows: Vec<PrRow> = prs.iter().map(pr_row).collect::<Result<_>>()?;
        self.with(|c| {
            c.transaction::<_, StoreError, _>(|c| {
                for r in &rows {
                    diesel::insert_into(personal_records::table)
                        .values(r)
                        .on_conflict(personal_records::id)
                        .do_update()
                        .set(r)
                        .execute(c)?;
                }
                let kept: Vec<&str> = rows.iter().map(|r| r.id.as_str()).collect();
                diesel::delete(personal_records::table.filter(personal_records::id.ne_all(&kept))).execute(c)?;
                Ok(())
            })
        })
    }

    /* ------------------------------- Mímir ------------------------------- */

    pub fn save_program(&self, p: &SavedProgram) -> Result<()> {
        let row = ProgramRow {
            id: p.id.clone(),
            template: serde_json::to_string(&p.template)?,
            saved_at: p.saved_at.clone(),
        };
        self.with(|c| {
            diesel::insert_into(programs::table)
                .values(&row)
                .on_conflict(programs::id)
                .do_update()
                .set(&row)
                .execute(c)?;
            Ok(())
        })
    }

    pub fn delete_program(&self, id: &str) -> Result<()> {
        self.with(|c| {
            diesel::delete(programs::table.find(id)).execute(c)?;
            Ok(())
        })
    }

    pub fn save_chat_item(&self, r: &ChatEntry<ChatItem>) -> Result<()> {
        let row = ItemRow { id: r.id.clone(), seq: r.seq, body: serde_json::to_string(&r.body)? };
        self.with(|c| {
            diesel::insert_into(mimir_items::table)
                .values(&row)
                .on_conflict(mimir_items::id)
                .do_update()
                .set(&row)
                .execute(c)?;
            Ok(())
        })
    }

    pub fn delete_chat_item(&self, id: &str) -> Result<()> {
        self.with(|c| {
            diesel::delete(mimir_items::table.find(id)).execute(c)?;
            Ok(())
        })
    }

    pub fn save_chat_message(&self, r: &ChatEntry<ChatMessage>) -> Result<()> {
        let row = MessageRow { id: r.id.clone(), seq: r.seq, body: serde_json::to_string(&r.body)? };
        self.with(|c| {
            diesel::insert_into(mimir_messages::table)
                .values(&row)
                .on_conflict(mimir_messages::id)
                .do_update()
                .set(&row)
                .execute(c)?;
            Ok(())
        })
    }

    pub fn delete_chat_message(&self, id: &str) -> Result<()> {
        self.with(|c| {
            diesel::delete(mimir_messages::table.find(id)).execute(c)?;
            Ok(())
        })
    }

    /* ----------------------------- Settings ------------------------------ */

    /// Every setting, as the app wrote it.
    pub fn kv_all(&self) -> Result<Vec<(String, String)>> {
        self.with(|c| {
            Ok(settings::table
                .select(SettingRow::as_select())
                .load(c)?
                .into_iter()
                .map(|r| (r.key, r.value))
                .collect())
        })
    }

    pub fn kv_set(&self, key: &str, value: &str) -> Result<()> {
        let row = SettingRow { key: key.to_owned(), value: value.to_owned() };
        self.with(|c| {
            diesel::insert_into(settings::table)
                .values(&row)
                .on_conflict(settings::key)
                .do_update()
                .set(&row)
                .execute(c)?;
            Ok(())
        })
    }

    pub fn kv_remove(&self, key: &str) -> Result<()> {
        self.with(|c| {
            diesel::delete(settings::table.find(key)).execute(c)?;
            Ok(())
        })
    }

    /* ------------------------------- Audio ------------------------------- */

    pub fn blob_put(&self, store: &str, info: &BlobInfo, bytes: Vec<u8>) -> Result<()> {
        let row = BlobRow {
            store: store.to_owned(),
            key: info.key.clone(),
            title: info.title.clone(),
            mime: info.mime.clone(),
            created_at: info.created_at.clone(),
            bytes,
        };
        self.with(|c| {
            diesel::insert_into(blobs::table)
                .values(&row)
                .on_conflict((blobs::store, blobs::key))
                .do_update()
                .set(&row)
                .execute(c)?;
            Ok(())
        })
    }

    pub fn blob_get(&self, store: &str, key: &str) -> Result<Option<(BlobInfo, Vec<u8>)>> {
        self.with(|c| {
            let row = blobs::table
                .find((store, key))
                .select(BlobRow::as_select())
                .first(c)
                .optional()?;
            Ok(row.map(|r| (BlobInfo { key: r.key, title: r.title, mime: r.mime, created_at: r.created_at }, r.bytes)))
        })
    }

    /// The files in one cache, without their bytes.
    pub fn blob_list(&self, store: &str) -> Result<Vec<BlobInfo>> {
        self.with(|c| {
            let rows: Vec<(String, String, String, String)> = blobs::table
                .filter(blobs::store.eq(store))
                .select((blobs::key, blobs::title, blobs::mime, blobs::created_at))
                .load(c)?;
            Ok(rows.into_iter().map(|(key, title, mime, created_at)| BlobInfo { key, title, mime, created_at }).collect())
        })
    }

    pub fn blob_delete(&self, store: &str, key: &str) -> Result<()> {
        self.with(|c| {
            diesel::delete(blobs::table.find((store, key))).execute(c)?;
            Ok(())
        })
    }
}

/* ------------------------ From Drizzle to Diesel ------------------------- */

fn table_exists(c: &mut SqliteConnection, name: &str) -> Result<bool> {
    let rows: Vec<NameRow> = diesel::sql_query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
        .bind::<Text, _>(name)
        .load(c)?;
    Ok(!rows.is_empty())
}

/// A phone that ran the app under Drizzle has the same tables, applied by
/// the same SQL, recorded by file name in `__migrations`. Record them in
/// Diesel's table too, so Diesel runs only what is genuinely new and never
/// re-creates a table that holds the owner's history.
///
/// Also repairs the case the old migrator repaired: the first migration's
/// tables exist (a run killed part-way) but nothing recorded them.
fn adopt_drizzle(c: &mut SqliteConnection) -> Result<()> {
    diesel::sql_query(
        "CREATE TABLE IF NOT EXISTS __diesel_schema_migrations (\
         version VARCHAR(50) PRIMARY KEY NOT NULL, \
         run_on TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)",
    )
    .execute(c)?;
    let mut adopt: HashSet<&str> = HashSet::new();
    if table_exists(c, "__migrations")? {
        let applied: Vec<NameRow> = diesel::sql_query("SELECT name FROM __migrations").load(c)?;
        for row in applied {
            if let Some((_, version)) = DRIZZLE_TO_DIESEL.iter().find(|(file, _)| *file == row.name) {
                adopt.insert(version);
            }
        }
    }
    if table_exists(c, "exercises")? {
        adopt.insert(DRIZZLE_TO_DIESEL[0].1);
    }
    for version in adopt {
        diesel::sql_query("INSERT OR IGNORE INTO __diesel_schema_migrations (version) VALUES (?)")
            .bind::<Text, _>(version)
            .execute(c)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests;
