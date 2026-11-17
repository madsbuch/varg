//! Varg's on-device storage: one SQLite file, through Diesel.
//!
//! Everything the app keeps lives here: the training database (exercises,
//! sessions, records), Mímir's programs and chat, the app's settings (a
//! key/value table) and the generated audio it paid for (blobs). The app
//! reaches it through the Tauri commands in `src-tauri/src/storage.rs`.
//!
//! Pure Rust with no Tauri in it, so all of it runs under `cargo test`.

#![forbid(unsafe_code)]

pub mod model;
pub mod schema;
mod store;

pub use store::{Store, StoreError};
