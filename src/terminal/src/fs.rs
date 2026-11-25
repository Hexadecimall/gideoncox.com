use std::collections::BTreeMap;

use crate::project;

pub const HOME: &str = "/home/web";
const MAX_FILE: usize = 512 * 1024;
const MAX_TOTAL: usize = 4 * 1024 * 1024;

#[derive(Clone)]
pub struct FileSystem {
    pub entries: BTreeMap<String, Option<String>>,
    pub cwd: String,
    root: Option<String>,
}

impl FileSystem {
    pub fn new() -> Self {
        let mut entries = BTreeMap::new();
        for path in ["/", "/home", HOME] {
            entries.insert(path.into(), None);
        }
        entries.insert(format!("{HOME}/readme.txt"), Some(
            "Ark browser workspace\n\nFiles are stored in this browser.\nUse help to list commands, or edit readme.txt to open the editor.\n".into()
        ));
        Self {
            entries,
            cwd: HOME.into(),
            root: None,
        }
    }

    #[cfg(target_arch = "wasm32")]
    pub fn mount(&mut self, root: &str, cwd: &str) -> Result<(), String> {
        let mut mounted = Self::new();
        mounted.root = Some(mounted.path(root)?);
        mounted.cwd = mounted.root.clone().unwrap();
        mounted.chdir(cwd)?;
        *self = mounted;
        Ok(())
    }

    pub fn home(&self) -> &str {
        self.root.as_deref().unwrap_or(HOME)
    }

    pub fn path(&self, value: &str) -> Result<String, String> {
        if value.contains('\0') || value.len() > 2048 {
            return Err("invalid path".into());
        }
        let absolute = if value.starts_with('/') {
            value.into()
        } else {
            format!("{}/{value}", self.cwd)
        };
        let mut parts = Vec::new();
        for part in absolute.split('/') {
            match part {
                "" | "." => {}
                ".." => {
                    parts.pop();
                }
                _ => parts.push(part),
            }
        }
        let path = format!("/{}", parts.join("/"));
        if let Some(root) = &self.root {
            if path != *root && !path.strip_prefix(root.as_str()).is_some_and(|suffix| suffix.starts_with('/')) {
                return Err("path is outside the open project".into());
            }
        }
        Ok(path)
    }

    pub fn directory(&self, path: &str) -> bool {
        matches!(self.entries.get(path), Some(None))
    }

    pub fn metadata(&self, value: &str) -> Result<Option<(bool, usize)>, String> {
        let path = self.path(value)?;
        if self.root.is_some() {
            let fields = project::call("metadata", &[&path])?;
            return match fields.as_slice() {
                [] => Ok(None),
                [kind, length] => Ok(Some((kind == "d", length.parse().map_err(|_| "invalid file size")?))),
                _ => Err("invalid project file metadata".into()),
            };
        }
        Ok(self.entries.get(&path).map(|value| (value.is_none(), value.as_ref().map_or(0, String::len))))
    }

    pub fn chdir(&mut self, value: &str) -> Result<(), String> {
        let path = self.path(value)?;
        if !self.metadata(&path)?.is_some_and(|(directory, _)| directory) {
            return Err("not a directory".into());
        }
        self.cwd = path;
        Ok(())
    }

    pub fn paths(&self, pattern: Option<&str>) -> Result<Vec<String>, String> {
        if let Some(root) = &self.root {
            return project::call("paths", &[pattern.unwrap_or(root)]);
        }
        Ok(self.entries.keys().cloned().collect())
    }

    pub fn read(&self, value: &str) -> Result<String, String> {
        let path = self.path(value)?;
        if self.root.is_some() {
            return project::call("read", &[&path])?.into_iter().next().ok_or_else(|| "no file contents".into());
        }
        match self.entries.get(&path) {
            Some(Some(text)) => Ok(text.clone()),
            Some(None) => Err(format!("{value}: is a directory")),
            None => Err(format!("{value}: no such file")),
        }
    }

    pub fn write(&mut self, value: &str, text: &str, append: bool) -> Result<(), String> {
        let path = self.path(value)?;
        if self.root.is_some() {
            return project::call(if append { "append" } else { "write" }, &[&path, text]).map(|_| ());
        }
        if self.directory(&path) {
            return Err(format!("{value}: is a directory"));
        }
        if !self.directory(parent(&path)) {
            return Err(format!("{value}: parent directory does not exist"));
        }
        let old = self
            .entries
            .get(&path)
            .and_then(Option::as_ref)
            .map(String::as_str)
            .unwrap_or("");
        let content = if append {
            format!("{old}{text}")
        } else {
            text.into()
        };
        let total: usize = self
            .entries
            .values()
            .filter_map(Option::as_ref)
            .map(String::len)
            .sum();
        if content.len() > MAX_FILE
            || total - old.len() + content.len() > MAX_TOTAL
            || self.entries.len() >= 2000
        {
            return Err("workspace size limit reached".into());
        }
        self.entries.insert(path, Some(content));
        Ok(())
    }

    pub fn mkdir(&mut self, value: &str, recursive: bool) -> Result<(), String> {
        let path = self.path(value)?;
        if self.root.is_some() {
            return project::call("mkdir", &[&path, if recursive { "1" } else { "0" }]).map(|_| ());
        }
        if self.directory(&path) && recursive {
            return Ok(());
        }
        if self.entries.contains_key(&path) {
            return Err(format!("{value}: already exists"));
        }
        if recursive && !self.directory(parent(&path)) {
            self.mkdir(parent(&path), true)?;
        }
        if !self.directory(parent(&path)) {
            return Err(format!("{value}: parent directory does not exist"));
        }
        if self.entries.len() >= 2000 {
            return Err("too many files".into());
        }
        self.entries.insert(path, None);
        Ok(())
    }

    pub fn list(&self, value: &str, all: bool) -> Result<Vec<(String, bool)>, String> {
        let path = self.path(value)?;
        if self.root.is_some() {
            let fields = project::call("list", &[&path, if all { "1" } else { "0" }])?;
            return Ok(fields.chunks_exact(2).map(|entry| (entry[0].clone(), entry[1] == "d")).collect());
        }
        if !self.directory(&path) {
            return Err(format!("{value}: not a directory"));
        }
        let prefix = if path == "/" {
            "/".into()
        } else {
            format!("{path}/")
        };
        Ok(self
            .entries
            .iter()
            .filter_map(|(p, data)| {
                let name = p.strip_prefix(&prefix)?;
                if name.is_empty() || name.contains('/') || (!all && name.starts_with('.')) {
                    return None;
                }
                Some((p.clone(), data.is_none()))
            })
            .collect())
    }

    pub fn remove(
        &mut self,
        value: &str,
        recursive: bool,
        directory_only: bool,
    ) -> Result<(), String> {
        let path = self.path(value)?;
        if self.root.is_some() {
            if self.cwd == path || self.cwd.starts_with(&format!("{path}/")) || self.root.as_deref() == Some(&path) {
                return Err(format!("{value}: directory is in use"));
            }
            return project::call("remove", &[&path, if recursive { "1" } else { "0" }, if directory_only { "1" } else { "0" }]).map(|_| ());
        }
        if !self.entries.contains_key(&path) {
            return Err(format!("{value}: no such file"));
        }
        if path == "/"
            || path == "/home"
            || path == HOME
            || self.cwd == path
            || self.cwd.starts_with(&format!("{path}/"))
        {
            return Err(format!("{value}: directory is in use"));
        }
        if directory_only && !self.directory(&path) {
            return Err(format!("{value}: not a directory"));
        }
        let prefix = format!("{path}/");
        let children = self.entries.keys().any(|p| p.starts_with(&prefix));
        if self.directory(&path) && !recursive && (!directory_only || children) {
            return Err(format!("{value}: directory is not empty or requires -r"));
        }
        self.entries
            .retain(|p, _| p != &path && !p.starts_with(&prefix));
        Ok(())
    }

    pub fn copy(
        &mut self,
        from: &str,
        to: &str,
        recursive: bool,
        moving: bool,
    ) -> Result<(), String> {
        let source = self.path(from)?;
        let mut dest = self.path(to)?;
        if self.root.is_some() {
            let fields = project::call(if moving { "move" } else { "copy" }, &[&source, &dest, if recursive { "1" } else { "0" }])?;
            if let Some(target) = fields.first().filter(|_| moving) {
                if self.cwd == source || self.cwd.starts_with(&format!("{source}/")) {
                    self.cwd = format!("{target}{}", &self.cwd[source.len()..]);
                }
            }
            return Ok(());
        }
        if !self.entries.contains_key(&source) {
            return Err(format!("{from}: no such file"));
        }
        if self.directory(&dest) {
            dest = format!("{}/{}", dest.trim_end_matches('/'), name(&source));
        }
        if source == dest || dest.starts_with(&format!("{source}/")) {
            return Err("source and destination overlap".into());
        }
        if self.directory(&source) && !recursive {
            return Err("copying a directory requires -r".into());
        }
        if moving && (source == HOME || source == "/home" || source == "/") {
            return Err("cannot move workspace root".into());
        }
        let mut next = self.clone();
        let items: Vec<_> = self
            .entries
            .iter()
            .filter(|(p, _)| *p == &source || p.starts_with(&format!("{source}/")))
            .map(|(p, d)| (p.clone(), d.clone()))
            .collect();
        for (p, data) in &items {
            let target = format!("{dest}{}", &p[source.len()..]);
            if let Some(text) = data {
                next.write(&target, text, false)?;
            } else {
                next.mkdir(&target, false)?;
            }
        }
        if moving {
            for (p, _) in items {
                next.entries.remove(&p);
            }
            if self.cwd == source || self.cwd.starts_with(&format!("{source}/")) {
                next.cwd = format!("{dest}{}", &self.cwd[source.len()..]);
            }
        }
        *self = next;
        Ok(())
    }
}

pub fn parent(path: &str) -> &str {
    path.rsplit_once('/')
        .map(|(p, _)| if p.is_empty() { "/" } else { p })
        .unwrap_or("/")
}
pub fn name(path: &str) -> &str {
    path.rsplit('/').next().unwrap_or(path)
}
