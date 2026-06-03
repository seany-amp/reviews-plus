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

        let left_text = left_content.as_deref().unwrap_or("");
        let right_text = right_content.as_deref().unwrap_or("");

        let hunks = compute_hunks(left_text, right_text);
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

/// Build the `@@ ... @@` unified-diff hunks for a single file.
///
/// Delegates hunk grouping to the `similar` crate, which correctly merges
/// changes that are closer together than `2 * context_radius` lines instead of
/// emitting overlapping/duplicated context (the bug in the previous
/// hand-rolled generator). Each returned string is one hunk, header included,
/// matching the shape `generate_diff` expects to concatenate.
fn compute_hunks(left: &str, right: &str) -> Vec<String> {
    use similar::TextDiff;

    let diff = TextDiff::from_lines(left, right);
    let mut unified = diff.unified_diff();
    unified.context_radius(3).missing_newline_hint(false);

    unified.iter_hunks().map(|hunk| hunk.to_string()).collect()
}

#[cfg(test)]
mod tests {
    use super::compute_hunks;

    /// Parsed `@@ -ls,lc +rs,rc @@` header.
    struct Header {
        left_start: usize,
        left_count: usize,
        right_start: usize,
        right_count: usize,
    }

    fn parse_header(line: &str) -> Header {
        // Format: "@@ -ls,lc +rs,rc @@"
        let inner = line
            .trim_start_matches("@@ ")
            .split(" @@")
            .next()
            .expect("header body");
        let mut parts = inner.split(' ');
        let left = parts.next().unwrap().trim_start_matches('-');
        let right = parts.next().unwrap().trim_start_matches('+');

        fn pair(spec: &str) -> (usize, usize) {
            match spec.split_once(',') {
                Some((s, c)) => (s.parse().unwrap(), c.parse().unwrap()),
                // A single number means a count of 1 in unified-diff format.
                None => (spec.parse().unwrap(), 1),
            }
        }

        let (left_start, left_count) = pair(left);
        let (right_start, right_count) = pair(right);
        Header {
            left_start,
            left_count,
            right_start,
            right_count,
        }
    }

    /// Every hunk's `@@` header line counts must equal the number of body
    /// lines that touch each side ( ' '/'-' for left, ' '/'+' for right ).
    fn assert_header_counts_reconcile(hunk: &str) {
        let mut lines = hunk.lines();
        let header = parse_header(lines.next().expect("hunk has a header"));

        let mut left = 0usize;
        let mut right = 0usize;
        for line in lines {
            match line.chars().next() {
                Some(' ') => {
                    left += 1;
                    right += 1;
                }
                Some('-') => left += 1,
                Some('+') => right += 1,
                _ => {}
            }
        }

        assert_eq!(
            header.left_count, left,
            "left count mismatch in hunk:\n{hunk}"
        );
        assert_eq!(
            header.right_count, right,
            "right count mismatch in hunk:\n{hunk}"
        );
    }

    /// Hunks must be strictly ordered and non-overlapping on both sides.
    fn assert_no_overlap(hunks: &[String]) {
        let mut prev_left_end = 0usize;
        let mut prev_right_end = 0usize;
        for hunk in hunks {
            let h = parse_header(hunk.lines().next().unwrap());
            assert!(
                h.left_start > prev_left_end,
                "hunk left range overlaps previous (start {} <= prev end {}):\n{hunk}",
                h.left_start,
                prev_left_end
            );
            assert!(
                h.right_start > prev_right_end,
                "hunk right range overlaps previous (start {} <= prev end {}):\n{hunk}",
                h.right_start,
                prev_right_end
            );
            prev_left_end = h.left_start + h.left_count.saturating_sub(1);
            prev_right_end = h.right_start + h.right_count.saturating_sub(1);
        }
    }

    #[test]
    fn closely_spaced_edits_merge_into_one_hunk() {
        // Two edits only one line apart -> their context overlaps, so similar
        // merges them into a single hunk (the old generator duplicated the
        // shared context and emitted two unreconcilable headers).
        let left = "a\nb\nc\nX\nd\nY\ne\nf\ng\n";
        let right = "a\nb\nc\nX2\nd\nY2\ne\nf\ng\n";

        let hunks = compute_hunks(left, right);

        assert_eq!(hunks.len(), 1, "expected a single merged hunk: {hunks:?}");
        assert_header_counts_reconcile(&hunks[0]);
        assert_no_overlap(&hunks);
        // The shared context line "d" must appear exactly once.
        assert_eq!(
            hunks[0].matches("\n d\n").count(),
            1,
            "shared context duplicated:\n{}",
            hunks[0]
        );
    }

    #[test]
    fn far_apart_edits_produce_separate_hunks() {
        let left = "a\nb\nc\nd\ne\nX\nf\ng\nh\ni\nj\nk\nl\nm\nn\nY\no\np\nq\n";
        let right = "a\nb\nc\nd\ne\nX2\nf\ng\nh\ni\nj\nk\nl\nm\nn\nY2\no\np\nq\n";

        let hunks = compute_hunks(left, right);

        assert_eq!(hunks.len(), 2, "expected two distinct hunks: {hunks:?}");
        for hunk in &hunks {
            assert_header_counts_reconcile(hunk);
        }
        assert_no_overlap(&hunks);
    }

    #[test]
    fn identical_content_produces_no_hunks() {
        let text = "a\nb\nc\n";
        assert!(compute_hunks(text, text).is_empty());
    }

    #[test]
    fn new_file_emits_single_add_hunk() {
        let hunks = compute_hunks("", "a\nb\nc\n");
        assert_eq!(hunks.len(), 1);
        let header = hunks[0].lines().next().unwrap();
        assert!(
            header.starts_with("@@ -0,0 "),
            "new file should start at -0,0: {header}"
        );
        assert_header_counts_reconcile(&hunks[0]);
    }

    #[test]
    fn deleted_file_emits_single_remove_hunk() {
        let hunks = compute_hunks("a\nb\nc\n", "");
        assert_eq!(hunks.len(), 1);
        let header = hunks[0].lines().next().unwrap();
        assert!(
            header.contains(" +0,0 @@"),
            "deleted file should target +0,0: {header}"
        );
        assert_header_counts_reconcile(&hunks[0]);
    }
}
