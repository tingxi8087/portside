mod tested_config {
// Include the actual implementation so tests exercise private validation/atomic I/O
// without creating a Tauri window or touching the user's real configuration.
include!("../src/config.rs");

#[cfg(test)]
mod persistence_boundary_tests {
    use super::*;
    fn directory(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!("portside-config-boundary-{}-{name}", std::process::id()))
    }
    #[test]
    fn rejected_secret_does_not_replace_valid_file() {
        let dir = directory("reject"); let path = dir.join("workspace.json");
        let original = r#"{"state":{"servers":[],"shortcuts":[],"settings":{}}}"#;
        save(path.clone(),original).unwrap();
        for field in ["password","secret","passphrase","privateKey","credential"] {
            let mut server = serde_json::json!({"id":"test"}); server[field] = "test-only-secret".into();
            let value = serde_json::json!({"state":{"servers":[server]}}).to_string();
            assert!(save(path.clone(),&value).is_err(),"accepted {field}");
            assert_eq!(fs::read_to_string(&path).unwrap(),original);
        }
        assert!(!path.with_extension("json.tmp").exists()); fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn oversized_and_malformed_writes_preserve_previous_bytes() {
        let dir = directory("invalid"); let path = dir.join("workspace.json");
        let original = r#"{"state":{"servers":[],"shortcuts":[],"settings":{}}}"#;
        save(path.clone(),original).unwrap();
        assert!(save(path.clone(),"{broken").is_err());
        assert!(save(path.clone(),&"x".repeat(8*1024*1024+1)).is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(),original);
        fs::remove_dir_all(dir).unwrap();
    }
    #[cfg(unix)]
    #[test]
    fn saved_configuration_is_private() {
        use std::os::unix::fs::PermissionsExt;
        let dir = directory("mode"); let path = dir.join("workspace.json");
        save(path.clone(),r#"{"state":{}}"#).unwrap();
        assert_eq!(fs::metadata(&path).unwrap().permissions().mode() & 0o777,0o600);
        fs::remove_dir_all(dir).unwrap();
    }
}

}
