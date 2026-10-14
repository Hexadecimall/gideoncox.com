//! Browser command runtime. The host sends length-prefixed UTF-8 strings;
//! all path resolution and file mutations stay inside this module.
mod commands;
mod fs;

use fs::{name, FileSystem, HOME};
use std::cell::RefCell;

thread_local! {
    static FILES: RefCell<FileSystem> = RefCell::new(FileSystem::new());
    static INPUT: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
    static OUTPUT: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
}

#[no_mangle]
pub extern "C" fn runtime_input(length: usize) -> *mut u8 {
    assert!(length <= 8 * 1024 * 1024);
    INPUT.with(|cell| {
        let mut bytes = cell.borrow_mut();
        bytes.resize(length, 0);
        bytes.as_mut_ptr()
    })
}
#[no_mangle]
pub extern "C" fn runtime_output() -> *const u8 {
    OUTPUT.with(|b| b.borrow().as_ptr())
}
#[no_mangle]
pub extern "C" fn runtime_output_len() -> usize {
    OUTPUT.with(|b| b.borrow().len())
}

fn decode(bytes: &[u8]) -> Result<Vec<String>, String> {
    let mut offset = 0;
    let mut number = || -> Result<usize, String> {
        let chunk = bytes.get(offset..offset + 4).ok_or("invalid message")?;
        offset += 4;
        Ok(u32::from_le_bytes(chunk.try_into().unwrap()) as usize)
    };
    let count = number()?;
    if count > 10000 {
        return Err("message is too large".into());
    }
    let mut values = Vec::new();
    for _ in 0..count {
        let chunk = bytes.get(offset..offset + 4).ok_or("invalid message")?;
        offset += 4;
        let length = u32::from_le_bytes(chunk.try_into().unwrap()) as usize;
        let value = bytes
            .get(offset..offset + length)
            .ok_or("invalid message")?;
        values.push(String::from_utf8(value.to_vec()).map_err(|_| "invalid UTF-8")?);
        offset += length;
    }
    if offset != bytes.len() {
        return Err("unexpected message data".into());
    }
    Ok(values)
}
fn input() -> Result<Vec<String>, String> {
    INPUT.with(|b| decode(&b.borrow()))
}
fn output(values: Vec<String>) {
    OUTPUT.with(|cell| {
        let mut bytes = cell.borrow_mut();
        bytes.clear();
        bytes.extend_from_slice(&(values.len() as u32).to_le_bytes());
        for value in values {
            bytes.extend_from_slice(&(value.len() as u32).to_le_bytes());
            bytes.extend_from_slice(value.as_bytes());
        }
    });
}

#[no_mangle]
pub extern "C" fn runtime_command() {
    let values = match input() {
        Ok(v) if !v.is_empty() => v,
        _ => {
            output(vec![
                "".into(),
                "invalid command message\n".into(),
                "1".into(),
                HOME.into(),
                "".into(),
            ]);
            return;
        }
    };
    FILES.with(|cell| {
        let mut files = cell.borrow_mut();
        let reply = commands::run(&mut files, &values[1..], &values[0]);
        output(vec![
            reply.out,
            reply.err,
            reply.code.to_string(),
            files.cwd.clone(),
            reply.action,
        ]);
    });
}

fn file_request(files: &mut FileSystem, values: &[String]) -> Result<Vec<String>, String> {
    let action = values.first().map(String::as_str).unwrap_or("");
    let arg = |i| {
        values
            .get(i)
            .map(String::as_str)
            .ok_or_else(|| "missing argument".to_string())
    };
    match action {
        "read" => Ok(vec![files.read(arg(1)?)?]),
        "write" | "append" => {
            files.write(arg(1)?, arg(2)?, action == "append")?;
            Ok(vec![])
        }
        "mkdir" => {
            files.mkdir(arg(1)?, false)?;
            Ok(vec![])
        }
        "remove" => {
            files.remove(arg(1)?, true, false)?;
            Ok(vec![])
        }
        "rename" => {
            let dest = files.path(arg(2)?)?;
            if files.entries.contains_key(&dest) {
                return Err("destination already exists".into());
            }
            files.copy(arg(1)?, &dest, true, true)?;
            Ok(vec![])
        }
        "list" => Ok(files
            .list(arg(1)?, true)?
            .into_iter()
            .flat_map(|(p, d)| vec![name(&p).into(), p, if d { "1" } else { "0" }.into()])
            .collect()),
        "paths" => Ok(files.entries.keys().cloned().collect()),
        "cwd" => Ok(vec![files.cwd.clone()]),
        "resolve" => Ok(vec![files.path(arg(1)?)?]),
        "chdir" => {
            let path = files.path(arg(1)?)?;
            if !files.directory(&path) {
                return Err("not a directory".into());
            }
            files.cwd = path;
            Ok(vec![])
        }
        _ => Err("unknown file operation".into()),
    }
}
#[no_mangle]
pub extern "C" fn runtime_files() {
    let result =
        input().and_then(|values| FILES.with(|cell| file_request(&mut cell.borrow_mut(), &values)));
    match result {
        Ok(mut values) => {
            values.insert(0, "0".into());
            output(values);
        }
        Err(error) => output(vec!["1".into(), error]),
    }
}
#[no_mangle]
pub extern "C" fn runtime_snapshot() {
    FILES.with(|cell| {
        let files = cell.borrow();
        let mut values = vec![files.cwd.clone()];
        for (path, data) in &files.entries {
            values.extend([
                path.clone(),
                if data.is_none() { "d" } else { "f" }.into(),
                data.clone().unwrap_or_default(),
            ]);
        }
        output(values);
    });
}
fn restore(values: Vec<String>) -> Result<FileSystem, String> {
    if values.is_empty() || (values.len() - 1) % 3 != 0 {
        return Err("invalid saved workspace".into());
    }
    let mut files = FileSystem::new();
    files.entries.retain(|_, v| v.is_none());
    for entry in values[1..].chunks_exact(3) {
        let path = &entry[0];
        if !path.starts_with('/') || files.path(path)? != *path {
            return Err("invalid saved path".into());
        }
        match entry[1].as_str() {
            "d" => files.mkdir(path, true)?,
            "f" => files.write(path, &entry[2], false)?,
            _ => return Err("invalid saved file type".into()),
        }
    }
    if !files.directory(&values[0]) {
        return Err("invalid saved directory".into());
    }
    files.cwd = values[0].clone();
    Ok(files)
}
#[no_mangle]
pub extern "C" fn runtime_restore() {
    match input().and_then(restore) {
        Ok(files) => {
            FILES.with(|cell| *cell.borrow_mut() = files);
            output(vec!["0".into()]);
        }
        Err(error) => output(vec!["1".into(), error]),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn files_are_atomic_and_confined() {
        let mut fs = FileSystem::new();
        fs.mkdir("notes", false).unwrap();
        fs.write("notes/a", "hello", false).unwrap();
        assert_eq!(fs.path("../../../../tmp").unwrap(), "/tmp");
        assert!(fs.copy("notes", "notes/child", true, true).is_err());
        assert_eq!(fs.read("notes/a").unwrap(), "hello");
        fs.copy("notes", "other", true, true).unwrap();
        assert_eq!(fs.read("other/a").unwrap(), "hello");
        assert!(fs.remove(HOME, true, false).is_err());
    }
    #[test]
    fn commands_consume_real_input() {
        let mut fs = FileSystem::new();
        let args = vec!["grep".into(), "hello".into()];
        assert_eq!(
            commands::run(&mut fs, &args, "hello\nworld\n").out,
            "hello\n"
        );
        assert_eq!(
            commands::run(
                &mut fs,
                &["test".into(), "4".into(), "-gt".into(), "3".into()],
                ""
            )
            .code,
            0
        );
    }
    #[test]
    fn malformed_restore_cannot_replace_files() {
        assert!(restore(vec![
            HOME.into(),
            "/home/web/../../invalid".into(),
            "f".into(),
            "".into()
        ])
        .is_err());
    }
}
