mod github;
mod local_diff;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            github::github_fetch,
            github::github_graphql,
            local_diff::local_diff,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
