use reqwest::Client;
use tauri_plugin_store::StoreExt;

#[tauri::command]
pub async fn github_fetch(
    app: tauri::AppHandle,
    endpoint: String,
    method: Option<String>,
    body: Option<String>,
    accept: Option<String>,
) -> Result<String, String> {
    let store = app
        .store("settings.json")
        .map_err(|e| format!("Failed to open store: {e}"))?;

    let token = store
        .get("github-pat")
        .and_then(|v| v.as_str().map(|s| s.to_string()))
        .ok_or_else(|| "No GitHub token found. Please store a token first.".to_string())?;

    let url = format!("https://api.github.com{endpoint}");
    let method = method.unwrap_or_else(|| "GET".to_string());
    let accept = accept.unwrap_or_else(|| "application/vnd.github+json".to_string());

    let client = Client::new();

    let mut request = match method.to_uppercase().as_str() {
        "GET" => client.get(&url),
        "POST" => client.post(&url),
        "PUT" => client.put(&url),
        "PATCH" => client.patch(&url),
        "DELETE" => client.delete(&url),
        other => return Err(format!("Unsupported HTTP method: {other}")),
    };

    request = request
        .header("Authorization", format!("Bearer {token}"))
        .header("Accept", &accept)
        .header("User-Agent", "reviews-plus")
        .header("X-GitHub-Api-Version", "2022-11-28");

    if let Some(body_str) = body {
        request = request
            .header("Content-Type", "application/json")
            .body(body_str);
    }

    let response = request.send().await.map_err(|e| format!("Request failed: {e}"))?;

    let status = response.status();
    let response_body = response
        .text()
        .await
        .map_err(|e| format!("Failed to read response body: {e}"))?;

    match status.as_u16() {
        200..=299 => Ok(response_body),
        401 => Err("Token invalid or expired".to_string()),
        403 => Err("Rate limited".to_string()),
        404 => Err("Not found".to_string()),
        _ => Err(format!("GitHub API error ({status}): {response_body}")),
    }
}
