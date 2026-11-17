use super::*;
use crate::model::{Category, ChatItem, ChatMessage, GearId, Intensity, Level, Metric, MusicProfile, PerSide, Plan, PrKind, SetId, Side, Template};
use std::path::PathBuf;

fn temp_db(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("varg-store-test-{}-{name}", std::process::id()));
    std::fs::create_dir_all(&dir).expect("temp dir");
    let path = dir.join("varg.db");
    let _ = std::fs::remove_file(&path);
    path
}

fn migration_sql(dir: &str) -> String {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("migrations").join(dir).join("up.sql");
    std::fs::read_to_string(path).expect("migration sql")
}

fn exercise(id: &str) -> Exercise {
    Exercise {
        id: id.into(),
        name: "Push-up".into(),
        category: Category::Bodyweight,
        metric: Metric::Reps,
        muscles: vec!["chest".into()],
        built_in: true,
    }
}

fn set(id: &str, reps: i32) -> WorkoutSet {
    WorkoutSet { id: id.into(), weight: None, reps: Some(reps), seconds: None, meters: None, rpe: None, done: true }
}

fn session() -> Session {
    Session {
        id: "s1".into(),
        name: "Varg 18".into(),
        date: "2026-11-17T08:00:00.000Z".into(),
        finished_at: Some("2026-11-17T08:18:00.000Z".into()),
        template_id: Some("tpl-varg-18".into()),
        note: None,
        heart_rate: Some(HeartRate { avg: 142.0, max: 171.0, every: 5.0, trace: vec![120.0, 150.0] }),
        entries: vec![SessionEntry {
            id: "e1".into(),
            exercise_id: "ex-push-up".into(),
            note: Some("good".into()),
            sets: vec![set("w1", 20), set("w2", 18)],
        }],
    }
}

#[test]
fn fresh_database_records_the_versions_drizzle_files_map_to() {
    let store = Store::open_in_memory().expect("open");
    let versions: Vec<String> = store
        .with(|c| {
            let rows: Vec<NameRow> =
                diesel::sql_query("SELECT version AS name FROM __diesel_schema_migrations ORDER BY version").load(c)?;
            Ok(rows.into_iter().map(|r| r.name).collect())
        })
        .expect("versions");
    for (_, v) in DRIZZLE_TO_DIESEL {
        assert!(versions.iter().any(|x| x == v), "migration {v} not recorded: {versions:?}");
    }
    assert_eq!(versions.len(), 4);
}

#[test]
fn schema_matches_migrations() {
    let store = Store::open_in_memory().expect("open");
    let expect: [(&str, &[&str]); 10] = [
        ("exercises", &["id", "name", "category", "metric", "muscles", "built_in"]),
        ("personal_records", &["id", "exercise_id", "kind", "value", "reps", "date", "session_id", "note", "manual"]),
        ("session_entries", &["id", "session_id", "exercise_id", "position", "note"]),
        ("sessions", &["id", "name", "date", "finished_at", "template_id", "note", "heart_rate"]),
        ("settings", &["key", "value"]),
        ("workout_sets", &["id", "entry_id", "session_id", "position", "weight", "reps", "seconds", "meters", "rpe", "done"]),
        ("programs", &["id", "template", "saved_at"]),
        ("mimir_items", &["id", "seq", "body"]),
        ("mimir_messages", &["id", "seq", "body"]),
        ("blobs", &["store", "key", "title", "mime", "created_at", "bytes"]),
    ];
    store
        .with(|c| {
            for (table, cols) in expect {
                let rows: Vec<NameRow> =
                    diesel::sql_query(format!("SELECT name FROM pragma_table_info('{table}')")).load(c)?;
                let mut got: Vec<String> = rows.into_iter().map(|r| r.name).collect();
                let mut want: Vec<String> = cols.iter().map(|s| (*s).to_owned()).collect();
                got.sort();
                want.sort();
                assert_eq!(got, want, "table {table}");
            }
            // And every Diesel row type selects cleanly against it.
            exercises::table.select(ExerciseRow::as_select()).load(c)?;
            personal_records::table.select(PrRow::as_select()).load(c)?;
            session_entries::table.select(EntryRow::as_select()).load(c)?;
            sessions::table.select(SessionRow::as_select()).load(c)?;
            settings::table.select(SettingRow::as_select()).load(c)?;
            workout_sets::table.select(SetRow::as_select()).load(c)?;
            programs::table.select(ProgramRow::as_select()).load(c)?;
            mimir_items::table.select(ItemRow::as_select()).load(c)?;
            mimir_messages::table.select(MessageRow::as_select()).load(c)?;
            blobs::table.select(BlobRow::as_select()).load(c)?;
            Ok(())
        })
        .expect("schema");
}

/// A phone that ran 0000 under Drizzle, with splits and a session pointing
/// at one: Diesel must adopt it, drop the splits and keep the session.
#[test]
fn adopts_a_drizzle_database_at_its_first_migration() {
    let path = temp_db("drizzle-0000");
    {
        let mut c = SqliteConnection::establish(path.to_str().expect("utf8")).expect("raw open");
        diesel::sql_query("PRAGMA foreign_keys = ON").execute(&mut c).expect("fk");
        for stmt in migration_sql("2025-01-01-000000_init").split(';').filter(|s| !s.trim().is_empty()) {
            diesel::sql_query(stmt).execute(&mut c).expect("init");
        }
        diesel::sql_query("CREATE TABLE __migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)")
            .execute(&mut c)
            .expect("bookkeeping");
        diesel::sql_query("INSERT INTO __migrations VALUES ('0000_init.sql', '2026-01-01')").execute(&mut c).expect("row");
        diesel::sql_query("INSERT INTO splits (id, name) VALUES ('sp', 'PPL')").execute(&mut c).expect("split");
        diesel::sql_query(
            "INSERT INTO sessions (id, name, date, split_id, template_id) VALUES ('old', 'Murph', '2026-01-02', 'sp', 'tpl-murph')",
        )
        .execute(&mut c)
        .expect("session");
    }
    let store = Store::open(&path).expect("open adopts");
    let snap = store.load().expect("load");
    assert_eq!(snap.sessions.len(), 1);
    assert_eq!(snap.sessions[0].name, "Murph");
    assert_eq!(snap.sessions[0].template_id.as_deref(), Some("tpl-murph"));
    assert!(snap.problems.is_empty(), "{:?}", snap.problems);
    drop(store);
    // A second launch is a no-op.
    Store::open(&path).expect("relaunch");
}

/// A phone fully up to date under Drizzle: nothing old re-runs (it would die
/// on "table already exists"), the new tables appear, history stays.
#[test]
fn adopts_a_current_drizzle_database() {
    let path = temp_db("drizzle-0002");
    {
        let mut c = SqliteConnection::establish(path.to_str().expect("utf8")).expect("raw open");
        for dir in ["2025-01-01-000000_init", "2025-02-01-000000_drop_splits", "2025-03-01-000000_session_heart_rate"] {
            for stmt in migration_sql(dir).split(';').filter(|s| !s.trim().is_empty()) {
                diesel::sql_query(stmt).execute(&mut c).expect(dir);
            }
        }
        diesel::sql_query("CREATE TABLE __migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)")
            .execute(&mut c)
            .expect("bookkeeping");
        for (file, _) in DRIZZLE_TO_DIESEL {
            diesel::sql_query(format!("INSERT INTO __migrations VALUES ('{file}', '2026-01-01')")).execute(&mut c).expect("row");
        }
        diesel::sql_query("INSERT INTO settings VALUES ('varg.ftp.v1', '250')").execute(&mut c).expect("setting");
        diesel::sql_query("INSERT INTO sessions (id, name, date, heart_rate) VALUES ('a', 'Helen', '2026-03-01', NULL)")
            .execute(&mut c)
            .expect("session");
    }
    let store = Store::open(&path).expect("open");
    assert_eq!(store.load().expect("load").sessions.len(), 1);
    assert_eq!(store.kv_all().expect("kv"), vec![("varg.ftp.v1".to_owned(), "250".to_owned())]);
    store.save_program(&SavedProgram { id: "mimir-x".into(), template: template("mimir-x"), saved_at: "now".into() }).expect("new table");
}

#[test]
fn sessions_round_trip_and_prune_in_place() {
    let store = Store::open_in_memory().expect("open");
    store.save_exercise(&exercise("ex-push-up")).expect("exercise");
    let mut s = session();
    store.save_session(&s).expect("save");
    let snap = store.load().expect("load");
    assert_eq!(snap.sessions, vec![s.clone()]);
    assert_eq!(snap.exercises, vec![exercise("ex-push-up")]);

    // A set removed, another reordered, the heart rate gone: exactly that.
    s.entries[0].sets = vec![set("w2", 19)];
    s.heart_rate = None;
    store.save_session(&s).expect("resave");
    assert_eq!(store.load().expect("load").sessions, vec![s.clone()]);

    store.delete_session("s1").expect("delete");
    let snap = store.load().expect("load");
    assert!(snap.sessions.is_empty());
    let left: i64 = store.with(|c| Ok(workout_sets::table.count().get_result(c)?)).expect("count");
    assert_eq!(left, 0);
}

#[test]
fn records_replace_and_prune() {
    let store = Store::open_in_memory().expect("open");
    let pr = |id: &str, v: f64| PersonalRecord {
        id: id.into(),
        exercise_id: "ex-push-up".into(),
        kind: PrKind::OneRm,
        value: v,
        reps: Some(5),
        date: "2026-11-01".into(),
        session_id: None,
        note: None,
        manual: true,
    };
    store.replace_prs(&[pr("a", 100.0), pr("b", 110.0)]).expect("first");
    store.replace_prs(&[pr("b", 115.0)]).expect("second");
    assert_eq!(store.load().expect("load").prs, vec![pr("b", 115.0)]);
    let stored: String = store.with(|c| Ok(personal_records::table.select(personal_records::kind).first(c)?)).expect("kind");
    assert_eq!(stored, "1rm", "kinds keep the text the app always wrote");
}

#[test]
fn unreadable_rows_are_named_not_dropped_quietly() {
    let store = Store::open_in_memory().expect("open");
    store
        .with(|c| {
            diesel::sql_query("INSERT INTO exercises VALUES ('ex-bad', 'Bad', 'yoga', 'reps', '[]', 1)").execute(c)?;
            diesel::sql_query("INSERT INTO programs VALUES ('mimir-bad', '[1,2]', 'now')").execute(c)?;
            diesel::sql_query("INSERT INTO sessions (id, name, date, heart_rate) VALUES ('h', 'H', 'd', '{oops')").execute(c)?;
            diesel::sql_query("INSERT INTO session_entries VALUES ('he', 'h', 'ex-push-up', 0, NULL)").execute(c)?;
            diesel::sql_query("INSERT INTO workout_sets VALUES ('hw', 'he', 'h', 0, NULL, 5.5, NULL, NULL, NULL, 1)").execute(c)?;
            Ok(())
        })
        .expect("seed");
    let snap = store.load().expect("load");
    assert!(snap.exercises.is_empty());
    assert!(snap.programs.is_empty());
    assert_eq!(snap.sessions.len(), 1, "the session loads without its heart rate");
    assert_eq!(snap.problems.len(), 4, "{:?}", snap.problems);
    assert!(snap.problems.iter().any(|p| p.contains("hw (5.5)")), "{:?}", snap.problems);
    assert!(snap.problems[0].contains("unknown value \"yoga\""));
}

#[test]
fn mimir_rows_keep_their_order() {
    let store = Store::open_in_memory().expect("open");
    let row = |id: &str, seq: i32, text: &str| ChatEntry { id: id.into(), seq, body: ChatItem::User { text: text.into() } };
    store.save_chat_item(&row("b", 2, "second")).expect("b");
    store.save_chat_item(&row("a", 1, "first")).expect("a");
    store
        .save_chat_message(&ChatEntry { id: "m".into(), seq: 1, body: ChatMessage::Assistant { content: None, tool_calls: None } })
        .expect("m");
    let snap = store.load().expect("load");
    assert_eq!(snap.mimir_items, vec![row("a", 1, "first"), row("b", 2, "second")]);
    assert_eq!(snap.mimir_messages.len(), 1);
    store.delete_chat_item("a").expect("delete");
    assert_eq!(store.load().expect("load").mimir_items.len(), 1);
}

#[test]
fn settings_and_audio() {
    let store = Store::open_in_memory().expect("open");
    store.kv_set("k", "1").expect("set");
    store.kv_set("k", "2").expect("overwrite");
    assert_eq!(store.kv_all().expect("all"), vec![("k".to_owned(), "2".to_owned())]);
    store.kv_remove("k").expect("remove");
    assert!(store.kv_all().expect("all").is_empty());

    let info = BlobInfo { key: "tpl-murph".into(), title: "Murph".into(), mime: "audio/mpeg".into(), created_at: "now".into() };
    store.blob_put("tracks", &info, vec![1, 2, 3]).expect("put");
    assert_eq!(store.blob_get("tracks", "tpl-murph").expect("get"), Some((info.clone(), vec![1, 2, 3])));
    assert_eq!(store.blob_get("clips", "tpl-murph").expect("other store"), None);
    assert_eq!(store.blob_list("tracks").expect("list"), vec![info]);
    store.blob_delete("tracks", "tpl-murph").expect("delete");
    assert!(store.blob_list("tracks").expect("list").is_empty());
}

#[test]
fn the_bridge_refuses_what_it_does_not_know() {
    // Unknown field: the app must map its objects explicitly.
    let e = serde_json::from_str::<Exercise>(
        r#"{"id":"x","name":"X","category":"core","metric":"reps","muscles":[],"builtIn":true,"deprecated":true}"#,
    );
    assert!(e.is_err());
    // Unknown enum value.
    let e = serde_json::from_str::<Exercise>(r#"{"id":"x","name":"X","category":"yoga","metric":"reps","muscles":[],"builtIn":true}"#);
    assert!(e.is_err());
    // No coercion: a number as a string is an error.
    let s = serde_json::from_str::<WorkoutSet>(r#"{"id":"w","reps":"5","done":true}"#);
    assert!(s.is_err());
    let s = serde_json::from_str::<WorkoutSet>(r#"{"id":"w","reps":5.5,"done":true}"#);
    assert!(s.is_err());
}

/// The app's own writes, pinned by scripts/store.test.ts: every one decodes
/// into the strict types, survives the database, and comes back unchanged.
#[test]
fn wire_fixture_decodes_and_round_trips() {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/wire.json");
    let text = std::fs::read_to_string(path).expect("fixture");
    let sent: Snapshot = serde_json::from_str(&text).expect("the app's writes decode strictly");
    let store = Store::open_in_memory().expect("open");
    for e in &sent.exercises {
        store.save_exercise(e).expect("exercise");
    }
    for s in &sent.sessions {
        store.save_session(s).expect("session");
    }
    store.replace_prs(&sent.prs).expect("prs");
    for p in &sent.programs {
        store.save_program(p).expect("program");
    }
    for r in &sent.mimir_items {
        store.save_chat_item(r).expect("item");
    }
    for r in &sent.mimir_messages {
        store.save_chat_message(r).expect("message");
    }
    let mut back = store.load().expect("load");
    back.exercises.sort_by(|a, b| a.id.cmp(&b.id));
    let mut want = sent.clone();
    want.exercises.sort_by(|a, b| a.id.cmp(&b.id));
    assert_eq!(back, want);
    // And what goes back to the app is the same JSON it sent.
    let mut sent_json: Value = serde_json::from_str(&text).expect("json");
    let mut back_json = serde_json::to_value(&back).expect("json");
    for v in [&mut sent_json, &mut back_json] {
        if let Some(Value::Array(xs)) = v.get_mut("exercises") {
            xs.sort_by(|a, b| a["id"].as_str().cmp(&b["id"].as_str()));
        }
        as_f64(v);
    }
    assert_eq!(back_json, sent_json);
}

/// JSON has one number type; serde_json keeps 142 and 142.0 apart. Compare
/// as JavaScript will read them.
fn as_f64(v: &mut Value) {
    match v {
        Value::Number(n) => {
            if let Some(f) = n.as_f64().and_then(serde_json::Number::from_f64) {
                *n = f;
            }
        }
        Value::Array(xs) => xs.iter_mut().for_each(as_f64),
        Value::Object(m) => m.values_mut().for_each(as_f64),
        _ => {}
    }
}

fn template(id: &str) -> Template {
    Template {
        id: id.into(),
        name: "Wolf Circuit".into(),
        branch: "Mímir".into(),
        description: "x".into(),
        level: Level::Beginner,
        plan: Plan::Interval { stations: vec!["ex-push-up".into()], work: 20, rest: 10, rounds: 3, note: None },
        music: MusicProfile { bpm: 140, style: "s".into(), theme: "t".into(), set: None, energy: Some(Intensity::Peak) },
        gear: None,
    }
}

/// A program Mímir saved before plans: read, converted, written back once.
#[test]
fn old_shape_programs_and_cards_are_converted_once() {
    let store = Store::open_in_memory().expect("open");
    let old = r#"{"id":"mimir-old","name":"Old Circuit","branch":"Mímir","description":"x","scheme":"3 rounds · 1 stations · 20 s work / 10 s rest","level":"beginner","exerciseIds":["ex-push-up"],"music":{"bpm":140,"style":"s","theme":"t","energy":3},"interval":{"work":20,"rest":10,"rounds":3}}"#;
    let logged = r#"{"id":"mimir-heavy","name":"Heavy","branch":"Mímir","description":"x","scheme":"5 × 5","level":"advanced","estimateMinutes":45,"exerciseIds":["ex-back-squat"],"music":{"bpm":140,"style":"s","theme":"t"}}"#;
    let card = format!(r#"{{"kind":"program","template":{old},"saved":true}}"#);
    store
        .with(|c| {
            diesel::sql_query(format!("INSERT INTO programs VALUES ('mimir-old', '{old}', 'a')")).execute(c)?;
            diesel::sql_query(format!("INSERT INTO programs VALUES ('mimir-heavy', '{logged}', 'b')")).execute(c)?;
            diesel::sql_query(format!("INSERT INTO mimir_items VALUES ('i', 1, '{card}')")).execute(c)?;
            Ok(())
        })
        .expect("seed");
    let snap = store.load().expect("load");
    assert!(snap.problems.is_empty(), "{:?}", snap.problems);
    assert_eq!(snap.programs[0].template, Template { name: "Old Circuit".into(), ..template("mimir-old") });
    assert_eq!(
        snap.programs[1].template.plan,
        Plan::Logged { exercises: vec!["ex-back-squat".into()], scheme: "5 × 5".into(), estimate_minutes: 45 }
    );
    match &snap.mimir_items[0].body {
        ChatItem::Program { template: t, saved, .. } => {
            assert_eq!(t.plan, template("x").plan);
            assert_eq!(*saved, Some(true));
        }
        other => panic!("not a program card: {other:?}"),
    }
    // Written back in the new shape: it now reads without converting.
    let stored: String = store.with(|c| Ok(programs::table.find("mimir-old").select(programs::template).first(c)?)).expect("row");
    assert!(stored.contains(r#""plan":{"kind":"interval""#), "{stored}");
    assert_eq!(store.load().expect("again").programs, snap.programs);
}

/// Strict like the app: an unknown field in a plan, a string for a number,
/// a second plan kind, an unknown enum value are all refused.
#[test]
fn templates_are_strict() {
    let good = serde_json::to_value(template("t")).expect("json");
    assert!(serde_json::from_value::<Template>(good.clone()).is_ok());
    let mut extra = good.clone();
    extra["plan"]["scheme"] = Value::String("made up".into());
    assert!(serde_json::from_value::<Template>(extra).is_err(), "unknown plan field");
    let mut text = good.clone();
    text["plan"]["work"] = Value::String("20".into());
    assert!(serde_json::from_value::<Template>(text).is_err(), "a string is not a number");
    let mut half = good.clone();
    half["plan"]["work"] = serde_json::json!(20.5);
    assert!(serde_json::from_value::<Template>(half).is_err(), "not a whole number");
    let mut kind = good.clone();
    kind["plan"]["kind"] = Value::String("amrap".into());
    assert!(serde_json::from_value::<Template>(kind).is_err(), "unknown kind");
    let mut energy = good;
    energy["music"]["energy"] = serde_json::json!(4);
    assert!(serde_json::from_value::<Template>(energy).is_err(), "intensity is 1-3");
}

/// Every enum's values, as the app's schemas list them (scripts/store.test.ts
/// writes the fixture): each decodes here, and the counts match, so neither
/// side has a value the other lacks.
#[test]
fn enums_match_the_app() {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/enums.json");
    let text = std::fs::read_to_string(path).expect("enums fixture");
    let all: std::collections::BTreeMap<String, Vec<Value>> = serde_json::from_str(&text).expect("json");
    fn check<T: serde::de::DeserializeOwned>(name: &str, values: &[Value], rust_count: usize) {
        for v in values {
            assert!(serde_json::from_value::<T>(v.clone()).is_ok(), "{name}: the app has {v}, Rust refuses it");
        }
        assert_eq!(values.len(), rust_count, "{name}: the app lists {} values, Rust has {rust_count}", values.len());
    }
    let get = |k: &str| all.get(k).unwrap_or_else(|| panic!("fixture lacks {k}")).clone();
    check::<Metric>("metric", &get("metric"), 4);
    check::<Category>("category", &get("category"), 6);
    check::<PrKind>("prKind", &get("prKind"), 5);
    check::<Level>("level", &get("level"), 3);
    check::<Intensity>("intensity", &get("intensity"), 3);
    check::<Side>("side", &get("side"), 2);
    check::<PerSide>("perSide", &get("perSide"), 2);
    check::<SetId>("setId", &get("setId"), 3);
    check::<GearId>("gearId", &get("gearId"), 22);
    let kinds: Vec<String> = get("planKind").into_iter().filter_map(|v| v.as_str().map(str::to_owned)).collect();
    let rust_kinds: Vec<String> = [
        Plan::Interval { stations: vec![], work: 0, rest: 0, rounds: 0, note: None },
        Plan::Emom { minute: 0, rounds: 0, stations: vec![], warmup: None, note: None },
        Plan::Flow { steps: vec![], transition: 0, note: None },
        Plan::ForTime { stages: vec![], scheme: String::new(), estimate_minutes: 0 },
        Plan::Ride { segments: vec![], race: None, free: None, scheme: String::new(), estimate_minutes: None },
        Plan::Logged { exercises: vec![], scheme: String::new(), estimate_minutes: 0 },
    ]
    .iter()
    .map(|p| serde_json::to_value(p).expect("json")["kind"].as_str().unwrap_or_default().to_owned())
    .collect();
    assert_eq!(kinds, rust_kinds, "plan kinds");
}
