// The database as the migrations in ../migrations leave it. Checked against
// the migrations by `schema_matches_migrations` in store.rs: a column added
// to a migration and not here (or the reverse) fails `cargo test`.

diesel::table! {
    exercises (id) {
        id -> Text,
        name -> Text,
        category -> Text,
        metric -> Text,
        muscles -> Text,
        built_in -> Bool,
    }
}

diesel::table! {
    personal_records (id) {
        id -> Text,
        exercise_id -> Text,
        kind -> Text,
        value -> Double,
        reps -> Nullable<Integer>,
        date -> Text,
        session_id -> Nullable<Text>,
        note -> Nullable<Text>,
        manual -> Bool,
    }
}

diesel::table! {
    session_entries (id) {
        id -> Text,
        session_id -> Text,
        exercise_id -> Text,
        position -> Integer,
        note -> Nullable<Text>,
    }
}

diesel::table! {
    sessions (id) {
        id -> Text,
        name -> Text,
        date -> Text,
        finished_at -> Nullable<Text>,
        template_id -> Nullable<Text>,
        note -> Nullable<Text>,
        heart_rate -> Nullable<Text>,
    }
}

diesel::table! {
    settings (key) {
        key -> Text,
        value -> Text,
    }
}

diesel::table! {
    workout_sets (id) {
        id -> Text,
        entry_id -> Text,
        session_id -> Text,
        position -> Integer,
        weight -> Nullable<Double>,
        reps -> Nullable<Integer>,
        seconds -> Nullable<Double>,
        meters -> Nullable<Double>,
        rpe -> Nullable<Double>,
        done -> Bool,
    }
}

diesel::table! {
    programs (id) {
        id -> Text,
        template -> Text,
        saved_at -> Text,
    }
}

diesel::table! {
    mimir_items (id) {
        id -> Text,
        seq -> Integer,
        body -> Text,
    }
}

diesel::table! {
    mimir_messages (id) {
        id -> Text,
        seq -> Integer,
        body -> Text,
    }
}

diesel::table! {
    blobs (store, key) {
        store -> Text,
        key -> Text,
        title -> Text,
        mime -> Text,
        created_at -> Text,
        bytes -> Binary,
    }
}

diesel::joinable!(session_entries -> sessions (session_id));
diesel::joinable!(workout_sets -> session_entries (entry_id));

diesel::allow_tables_to_appear_in_same_query!(
    exercises,
    personal_records,
    session_entries,
    sessions,
    settings,
    workout_sets,
    programs,
    mimir_items,
    mimir_messages,
    blobs,
);
