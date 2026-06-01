use ignore::overrides::OverrideBuilder;
use ignore::WalkBuilder;
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

#[tauri::command]
pub async fn local_diff(left: String, right: String) -> Result<String, String> {
    let left_path = PathBuf::from(&left);
    let right_path = PathBuf::from(&right);

    if !left_path.is_dir() {
        return Err(format!("Left path is not a directory: {left}"));
    }
    if !right_path.is_dir() {
        return Err(format!("Right path is not a directory: {right}"));
    }

    tokio::task::spawn_blocking(move || generate_diff(&left_path, &right_path))
        .await
        .map_err(|e| format!("Task failed: {e}"))?
}

fn generate_diff(left: &Path, right: &Path) -> Result<String, String> {
    let left_files = collect_files(left)?;
    let right_files = collect_files(right)?;

    let all_files: BTreeSet<&PathBuf> = left_files.iter().chain(right_files.iter()).collect();

    let mut output = String::new();

    for rel_path in all_files {
        let left_full = left.join(rel_path);
        let right_full = right.join(rel_path);

        let left_content = read_text(&left_full);
        let right_content = read_text(&right_full);

        if left_content == right_content {
            continue;
        }

        let rel_str = rel_path.to_string_lossy();
        let left_label = format!("a/{rel_str}");
        let right_label = format!("b/{rel_str}");

        output.push_str(&format!("diff --git {left_label} {right_label}\n"));

        if left_content.is_none() {
            output.push_str("new file mode 100644\n");
        } else if right_content.is_none() {
            output.push_str("deleted file mode 100644\n");
        }

        output.push_str(&format!("--- {}\n", if left_content.is_some() { &left_label } else { "/dev/null" }));
        output.push_str(&format!("+++ {}\n", if right_content.is_some() { &right_label } else { "/dev/null" }));

        let left_lines: Vec<&str> = left_content.as_deref().map(|c| c.lines().collect()).unwrap_or_default();
        let right_lines: Vec<&str> = right_content.as_deref().map(|c| c.lines().collect()).unwrap_or_default();

        let hunks = compute_hunks(&left_lines, &right_lines);
        for hunk in hunks {
            output.push_str(&hunk);
        }
    }

    Ok(output)
}

fn collect_files(root: &Path) -> Result<BTreeSet<PathBuf>, String> {
    let mut files = BTreeSet::new();

    let mut overrides = OverrideBuilder::new(root);
    overrides.add("!.claude/").map_err(|e| format!("Override error: {e}"))?;
    overrides.add("!.claude_output/").map_err(|e| format!("Override error: {e}"))?;
    overrides.add("!*.jsonl").map_err(|e| format!("Override error: {e}"))?;
    overrides.add("!.dex/").map_err(|e| format!("Override error: {e}"))?;
    let overrides = overrides.build().map_err(|e| format!("Override build error: {e}"))?;

    let walker = WalkBuilder::new(root)
        .hidden(false)
        .git_ignore(true)
        .git_global(true)
        .git_exclude(true)
        .overrides(overrides)
        .build();

    for entry in walker {
        let entry = entry.map_err(|e| format!("Walk error: {e}"))?;
        if !entry.file_type().map_or(false, |ft| ft.is_file()) {
            continue;
        }
        let rel = entry.path().strip_prefix(root).unwrap_or(entry.path());
        let rel_str = rel.to_string_lossy();
        // Skip .git internals and common heavy dirs that might not be in .gitignore
        if rel_str.starts_with(".git/") || rel_str.starts_with(".git\\") || rel_str == ".git" {
            continue;
        }
        files.insert(rel.to_path_buf());
    }
    Ok(files)
}

fn read_text(path: &Path) -> Option<String> {
    if !path.exists() {
        return None;
    }
    let bytes = std::fs::read(path).ok()?;
    // Skip binary files
    if bytes.iter().take(8192).any(|&b| b == 0) {
        return None;
    }
    String::from_utf8(bytes).ok()
}

fn compute_hunks(left: &[&str], right: &[&str]) -> Vec<String> {
    let diff = diff::slice(left, right);

    let mut hunks = Vec::new();
    let mut current_hunk = String::new();
    let mut left_pos: usize = 0;
    let mut right_pos: usize = 0;
    let mut hunk_left_start: usize = 0;
    let mut hunk_right_start: usize = 0;
    let mut hunk_left_count: usize = 0;
    let mut hunk_right_count: usize = 0;
    let mut in_hunk = false;
    let mut context_after: usize = 0;

    let context_lines = 3;

    for result in &diff {
        match result {
            diff::Result::Both(line, _) => {
                left_pos += 1;
                right_pos += 1;
                if in_hunk {
                    context_after += 1;
                    current_hunk.push_str(&format!(" {line}\n"));
                    hunk_left_count += 1;
                    hunk_right_count += 1;
                    if context_after >= context_lines {
                        hunks.push(format!(
                            "@@ -{},{} +{},{} @@\n{}",
                            hunk_left_start, hunk_left_count, hunk_right_start, hunk_right_count, current_hunk
                        ));
                        current_hunk.clear();
                        in_hunk = false;
                        context_after = 0;
                    }
                }
            }
            diff::Result::Left(line) => {
                if !in_hunk {
                    in_hunk = true;
                    hunk_left_start = left_pos.saturating_sub(context_lines) + 1;
                    hunk_right_start = right_pos.saturating_sub(context_lines) + 1;
                    hunk_left_count = 0;
                    hunk_right_count = 0;
                    // Add leading context
                    let start = left_pos.saturating_sub(context_lines);
                    for i in start..left_pos {
                        current_hunk.push_str(&format!(" {}\n", left[i]));
                        hunk_left_count += 1;
                        hunk_right_count += 1;
                    }
                }
                context_after = 0;
                current_hunk.push_str(&format!("-{line}\n"));
                hunk_left_count += 1;
                left_pos += 1;
            }
            diff::Result::Right(line) => {
                if !in_hunk {
                    in_hunk = true;
                    hunk_left_start = left_pos.saturating_sub(context_lines) + 1;
                    hunk_right_start = right_pos.saturating_sub(context_lines) + 1;
                    hunk_left_count = 0;
                    hunk_right_count = 0;
                    let start = left_pos.saturating_sub(context_lines);
                    for i in start..left_pos {
                        current_hunk.push_str(&format!(" {}\n", left[i]));
                        hunk_left_count += 1;
                        hunk_right_count += 1;
                    }
                }
                context_after = 0;
                current_hunk.push_str(&format!("+{line}\n"));
                hunk_right_count += 1;
                right_pos += 1;
            }
        }
    }

    if in_hunk && !current_hunk.is_empty() {
        hunks.push(format!(
            "@@ -{},{} +{},{} @@\n{}",
            hunk_left_start, hunk_left_count, hunk_right_start, hunk_right_count, current_hunk
        ));
    }

    hunks
}
