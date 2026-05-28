use keyring::Entry;

const SERVICE: &str = "reviews-plus";
const USER: &str = "github-pat";

fn get_entry() -> Result<Entry, String> {
    Entry::new(SERVICE, USER).map_err(|e| format!("Failed to create keyring entry: {e}"))
}

#[tauri::command]
pub fn store_token(token: String) -> Result<(), String> {
    let entry = get_entry()?;
    entry
        .set_password(&token)
        .map_err(|e| format!("Failed to store token: {e}"))
}

#[tauri::command]
pub fn get_token() -> Result<Option<String>, String> {
    let entry = get_entry()?;
    match entry.get_password() {
        Ok(password) => Ok(Some(password)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("Failed to retrieve token: {e}")),
    }
}

#[tauri::command]
pub fn delete_token() -> Result<(), String> {
    let entry = get_entry()?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("Failed to delete token: {e}")),
    }
}
