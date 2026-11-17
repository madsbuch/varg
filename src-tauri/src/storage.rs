//! The app's storage commands: a thin bridge from the WebView to the
//! Diesel store in `store/` (varg-store). Every argument is the store's own
//! strict type, so serde refuses a wrong shape before any of it is written.
//!
//! The database is opened by `store_open`, not at startup: a failure then
//! reaches the app's "Varg could not start" card with its Retry, instead of
//! a crash on the splash.

#![forbid(unsafe_code)]

use std::sync::{Arc, Mutex};

use serde::Deserialize;
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use tauri::{Manager, Runtime, State};
use varg_store::model::{BlobInfo, ChatEntry, ChatItem, ChatMessage, Exercise, PersonalRecord, SavedProgram, Session, Snapshot};
use varg_store::Store;

/// The file the old SQL plugin used (`sqlite:varg.db` under the app config
/// directory), so an update keeps every logged session.
const DB_FILE: &str = "varg.db";

#[derive(Default)]
pub struct Storage {
    store: Mutex<Option<Arc<Store>>>,
}

/// Every storage command, for the app's invoke handler.
pub fn commands<R: Runtime>() -> impl Fn(tauri::ipc::Invoke<R>) -> bool + Send + Sync + 'static {
    tauri::generate_handler![
        store_open,
        store_load,
        store_save_exercise,
        store_delete_exercise,
        store_save_session,
        store_delete_session,
        store_replace_prs,
        store_save_program,
        store_delete_program,
        store_save_chat_item,
        store_delete_chat_item,
        store_save_chat_message,
        store_delete_chat_message,
        kv_all,
        kv_set,
        kv_remove,
        blob_put,
        blob_info,
        blob_bytes,
        blob_list,
        blob_delete,
    ]
}

fn store(state: &State<'_, Storage>) -> Result<Arc<Store>, String> {
    let guard = state.store.lock().map_err(|_| "storage lock poisoned".to_owned())?;
    guard.clone().ok_or_else(|| "storage not open".to_owned())
}

type Res<T> = Result<T, String>;

fn err(e: varg_store::StoreError) -> String {
    e.0
}

#[tauri::command]
pub fn store_open<R: Runtime>(app: tauri::AppHandle<R>, state: State<'_, Storage>) -> Res<()> {
    let mut guard = state.store.lock().map_err(|_| "storage lock poisoned".to_owned())?;
    if guard.is_some() {
        return Ok(());
    }
    let dir = app.path().app_config_dir().map_err(|e| format!("no app config directory: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
    let opened = Store::open(&dir.join(DB_FILE)).map_err(err)?;
    *guard = Some(Arc::new(opened));
    Ok(())
}

#[tauri::command]
pub fn store_load(state: State<'_, Storage>) -> Res<Snapshot> {
    store(&state)?.load().map_err(err)
}

#[tauri::command]
pub fn store_save_exercise(state: State<'_, Storage>, exercise: Exercise) -> Res<()> {
    store(&state)?.save_exercise(&exercise).map_err(err)
}

#[tauri::command]
pub fn store_delete_exercise(state: State<'_, Storage>, id: String) -> Res<()> {
    store(&state)?.delete_exercise(&id).map_err(err)
}

#[tauri::command]
pub fn store_save_session(state: State<'_, Storage>, session: Session) -> Res<()> {
    store(&state)?.save_session(&session).map_err(err)
}

#[tauri::command]
pub fn store_delete_session(state: State<'_, Storage>, id: String) -> Res<()> {
    store(&state)?.delete_session(&id).map_err(err)
}

#[tauri::command]
pub fn store_replace_prs(state: State<'_, Storage>, prs: Vec<PersonalRecord>) -> Res<()> {
    store(&state)?.replace_prs(&prs).map_err(err)
}

#[tauri::command]
pub fn store_save_program(state: State<'_, Storage>, program: SavedProgram) -> Res<()> {
    store(&state)?.save_program(&program).map_err(err)
}

#[tauri::command]
pub fn store_delete_program(state: State<'_, Storage>, id: String) -> Res<()> {
    store(&state)?.delete_program(&id).map_err(err)
}

#[tauri::command]
pub fn store_save_chat_item(state: State<'_, Storage>, row: ChatEntry<ChatItem>) -> Res<()> {
    store(&state)?.save_chat_item(&row).map_err(err)
}

#[tauri::command]
pub fn store_delete_chat_item(state: State<'_, Storage>, id: String) -> Res<()> {
    store(&state)?.delete_chat_item(&id).map_err(err)
}

#[tauri::command]
pub fn store_save_chat_message(state: State<'_, Storage>, row: ChatEntry<ChatMessage>) -> Res<()> {
    store(&state)?.save_chat_message(&row).map_err(err)
}

#[tauri::command]
pub fn store_delete_chat_message(state: State<'_, Storage>, id: String) -> Res<()> {
    store(&state)?.delete_chat_message(&id).map_err(err)
}

/* ------------------------------ Settings ---------------------------------- */

#[tauri::command]
pub fn kv_all(state: State<'_, Storage>) -> Res<Vec<(String, String)>> {
    store(&state)?.kv_all().map_err(err)
}

#[tauri::command]
pub fn kv_set(state: State<'_, Storage>, key: String, value: String) -> Res<()> {
    store(&state)?.kv_set(&key, &value).map_err(err)
}

#[tauri::command]
pub fn kv_remove(state: State<'_, Storage>, key: String) -> Res<()> {
    store(&state)?.kv_remove(&key).map_err(err)
}

/* -------------------------------- Audio ----------------------------------- */
// Audio crosses the bridge as base64 in plain JSON. Raw IPC bodies would be
// smaller, but Android does not support them (tauri::ipc::InvokeBody: "On
// Android, InvokeBody::Raw is not supported"): the first build that sent raw
// bytes stopped every phone at boot. base64 is what Tauri recommends there,
// and it is a third larger, not a JSON number array's four times.

/// One file to store: what it is, and its bytes as standard base64.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BlobPut {
    store: String,
    key: String,
    title: String,
    mime: String,
    created_at: String,
    base64: String,
}

#[tauri::command]
pub fn blob_put(state: State<'_, Storage>, file: BlobPut) -> Res<()> {
    let bytes = STANDARD
        .decode(file.base64.as_bytes())
        .map_err(|e| format!("blob_put {}/{}: not base64 ({e})", file.store, file.key))?;
    let info = BlobInfo { key: file.key, title: file.title, mime: file.mime, created_at: file.created_at };
    store(&state)?.blob_put(&file.store, &info, bytes).map_err(err)
}

#[tauri::command]
pub fn blob_info(state: State<'_, Storage>, store_name: String, key: String) -> Res<Option<BlobInfo>> {
    Ok(store(&state)?.blob_get(&store_name, &key).map_err(err)?.map(|(info, _)| info))
}

/// The bytes of one file, as standard base64; an error when it is not there.
#[tauri::command]
pub fn blob_bytes(state: State<'_, Storage>, store_name: String, key: String) -> Res<String> {
    match store(&state)?.blob_get(&store_name, &key).map_err(err)? {
        Some((_, bytes)) => Ok(STANDARD.encode(bytes)),
        None => Err(format!("no {store_name} file \"{key}\"")),
    }
}

#[tauri::command]
pub fn blob_list(state: State<'_, Storage>, store_name: String) -> Res<Vec<BlobInfo>> {
    store(&state)?.blob_list(&store_name).map_err(err)
}

#[tauri::command]
pub fn blob_delete(state: State<'_, Storage>, store_name: String, key: String) -> Res<()> {
    store(&state)?.blob_delete(&store_name, &key).map_err(err)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};
    use tauri::ipc::{CallbackFn, InvokeBody, InvokeResponseBody};
    use tauri::test::{get_ipc_response, mock_builder, mock_context, noop_assets, MockRuntime, INVOKE_KEY};
    use tauri::webview::InvokeRequest;
    use tauri::WebviewWindow;

    fn app() -> (tauri::App<MockRuntime>, WebviewWindow<MockRuntime>) {
        let storage = Storage::default();
        *storage.store.lock().expect("lock") = Some(Arc::new(Store::open_in_memory().expect("store")));
        let app = mock_builder()
            .manage(storage)
            .invoke_handler(commands())
            .build(mock_context(noop_assets()))
            .expect("app");
        let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default()).build().expect("webview");
        (app, webview)
    }

    /// Invoke as the WebView does: JSON args with camelCase names, or raw bytes.
    fn call(w: &WebviewWindow<MockRuntime>, cmd: &str, body: InvokeBody, headers: &[(&'static str, String)]) -> Result<InvokeResponseBody, Value> {
        let mut map = tauri::http::HeaderMap::new();
        for (k, v) in headers {
            map.insert(*k, v.parse().expect("header"));
        }
        get_ipc_response(
            w,
            InvokeRequest {
                cmd: cmd.into(),
                callback: CallbackFn(0),
                error: CallbackFn(1),
                url: "tauri://localhost".parse().expect("url"),
                body,
                headers: map,
                invoke_key: INVOKE_KEY.to_string(),
            },
        )
    }

    fn json_call(w: &WebviewWindow<MockRuntime>, cmd: &str, args: Value) -> Result<Value, Value> {
        call(w, cmd, InvokeBody::Json(args), &[]).map(|b| b.deserialize::<Value>().expect("json"))
    }

    #[test]
    fn the_commands_take_what_the_app_sends() {
        let (_app, w) = app();
        let session = json!({
            "id": "s1", "name": "Varg 18", "date": "2026-11-17T08:00:00.000Z",
            "entries": [{ "id": "e1", "exerciseId": "ex-push-up", "sets": [{ "id": "w1", "reps": 20, "done": true }] }]
        });
        json_call(&w, "store_save_session", json!({ "session": session })).expect("save");
        let snap = json_call(&w, "store_load", json!({})).expect("load");
        assert_eq!(snap["sessions"][0], session);

        // A field the store does not know is refused, not dropped.
        let mut extra = session.clone();
        extra["entries"][0]["sets"][0]["reps"] = json!("20");
        assert!(json_call(&w, "store_save_session", json!({ "session": extra })).is_err());

        json_call(&w, "kv_set", json!({ "key": "varg.ftp.v1", "value": "250" })).expect("kv");
        assert_eq!(json_call(&w, "kv_all", json!({})).expect("all"), json!([["varg.ftp.v1", "250"]]));
    }

    /// Every call here is JSON, as on Android, where raw bodies do not exist.
    #[test]
    fn audio_crosses_as_base64_json() {
        let (_app, w) = app();
        let file = json!({
            "store": "tracks", "key": "tpl-murph", "title": "Murph · Mímir",
            "mime": "audio/mpeg", "createdAt": "2026-11-17", "base64": STANDARD.encode([0u8, 1, 2, 255]),
        });
        json_call(&w, "blob_put", json!({ "file": file })).expect("put");
        let info = json_call(&w, "blob_info", json!({ "storeName": "tracks", "key": "tpl-murph" })).expect("info");
        assert_eq!(info["title"], "Murph · Mímir");
        assert_eq!(info["mime"], "audio/mpeg");
        let back = json_call(&w, "blob_bytes", json!({ "storeName": "tracks", "key": "tpl-murph" })).expect("bytes");
        assert_eq!(back, json!(STANDARD.encode([0u8, 1, 2, 255])));
        assert_eq!(json_call(&w, "blob_info", json!({ "storeName": "clips", "key": "tpl-murph" })).expect("none"), Value::Null);

        // Not base64, an unknown field, a missing field: refused, nothing written.
        let mut bad = file.clone();
        bad["base64"] = json!("not base64!");
        assert!(json_call(&w, "blob_put", json!({ "file": bad })).is_err());
        let mut extra = file.clone();
        extra["bytes"] = json!([1, 2]);
        assert!(json_call(&w, "blob_put", json!({ "file": extra })).is_err());
        assert!(json_call(&w, "blob_put", json!({ "file": { "store": "tracks", "key": "x" } })).is_err());
    }
}
