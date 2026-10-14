use crate::fs::{name, FileSystem, HOME};

pub struct Reply {
    pub out: String,
    pub err: String,
    pub code: i32,
    pub action: String,
}
impl Reply {
    pub fn ok(out: String) -> Self {
        Self {
            out,
            err: String::new(),
            code: 0,
            action: String::new(),
        }
    }
    pub fn error(error: String) -> Self {
        Self {
            out: String::new(),
            err: format!("{error}\n"),
            code: 1,
            action: String::new(),
        }
    }
}

pub fn run(fs: &mut FileSystem, args: &[String], input: &str) -> Reply {
    match execute(fs, args, input) {
        Ok(reply) => reply,
        Err(error) => Reply::error(error),
    }
}

fn execute(fs: &mut FileSystem, args: &[String], input: &str) -> Result<Reply, String> {
    let command = args.first().map(String::as_str).unwrap_or("");
    let a = &args[args.len().min(1)..];
    let mut out = String::new();
    match command {
        "" | "true" | ":" => {}
        "false" => {
            return Ok(Reply {
                code: 1,
                ..Reply::ok(out)
            })
        }
        "pwd" => out = format!("{}\n", fs.cwd),
        "cd" => {
            let path = fs.path(a.first().map(String::as_str).unwrap_or(HOME))?;
            if !fs.directory(&path) {
                return Err("cd: not a directory".into());
            }
            fs.cwd = path;
        }
        "ls" => {
            let all = a.iter().any(|s| s.starts_with('-') && s.contains('a'));
            let long = a.iter().any(|s| s.starts_with('-') && s.contains('l'));
            let paths: Vec<_> = a.iter().filter(|s| !s.starts_with('-')).collect();
            let default = String::from(".");
            for path in if paths.is_empty() {
                vec![&default]
            } else {
                paths
            } {
                for (p, dir) in fs.list(path, all)? {
                    if long {
                        out += &format!(
                            "{} {:>7} ",
                            if dir { "d" } else { "-" },
                            fs.entries[&p].as_ref().map_or(0, String::len)
                        );
                    }
                    out += name(&p);
                    if dir {
                        out.push('/');
                    }
                    out.push('\n');
                }
            }
        }
        "mkdir" => {
            required(a, "mkdir [-p] path")?;
            for p in a.iter().filter(|s| !s.starts_with('-')) {
                fs.mkdir(p, a.iter().any(|s| s == "-p"))?;
            }
        }
        "touch" => {
            required(a, "touch path")?;
            for p in a {
                if !fs.entries.contains_key(&fs.path(p)?) {
                    fs.write(p, "", false)?;
                }
            }
        }
        "cat" => out = contents(fs, a, input)?,
        "echo" => {
            let mut offset = 0;
            let mut newline = true;
            let mut escape = false;
            while offset < a.len() && ["-n", "-e", "-ne", "-en"].contains(&a[offset].as_str()) {
                newline &= !a[offset].contains('n');
                escape |= a[offset].contains('e');
                offset += 1;
            }
            out = a[offset..].join(" ");
            if escape {
                out = escapes(&out);
            }
            if newline {
                out.push('\n');
            }
        }
        "printf" => {
            let format = escapes(a.first().map(String::as_str).unwrap_or(""));
            let mut index = 1;
            loop {
                let before = index;
                let mut chars = format.chars();
                while let Some(c) = chars.next() {
                    if c != '%' {
                        out.push(c);
                        continue;
                    }
                    match chars.next() {
                        Some('%') => out.push('%'),
                        Some(spec @ ('s' | 'd' | 'b')) => {
                            let value = a.get(index).map(String::as_str).unwrap_or("");
                            index += 1;
                            out += &match spec {
                                'd' => value.parse::<i64>().unwrap_or(0).to_string(),
                                'b' => escapes(value),
                                _ => value.into(),
                            };
                        }
                        _ => return Err("printf: supported formats are %s, %d, %b and %%".into()),
                    }
                }
                if index >= a.len() || before == index {
                    break;
                }
            }
        }
        "head" | "tail" => {
            let mut count = 10;
            let mut files = Vec::new();
            let mut i = 0;
            while i < a.len() {
                if a[i] == "-n" {
                    i += 1;
                    count = a
                        .get(i)
                        .ok_or("missing line count")?
                        .parse::<usize>()
                        .map_err(|_| "invalid line count")?;
                } else {
                    files.push(a[i].clone());
                }
                i += 1;
            }
            let data = contents(fs, &files, input)?;
            let lines: Vec<_> = data.split_inclusive('\n').collect();
            let start = if command == "tail" {
                lines.len().saturating_sub(count)
            } else {
                0
            };
            out = lines.into_iter().skip(start).take(count).collect();
        }
        "grep" => {
            let ignore = a.iter().any(|s| s == "-i");
            let invert = a.iter().any(|s| s == "-v");
            let numbers = a.iter().any(|s| s == "-n");
            let values: Vec<_> = a
                .iter()
                .filter(|s| !["-i", "-v", "-n", "-F"].contains(&s.as_str()))
                .cloned()
                .collect();
            let pattern = values
                .first()
                .ok_or("usage: grep [-i] [-v] [-n] text [file]")?;
            let data = contents(fs, &values[1..], input)?;
            for (i, line) in data.lines().enumerate() {
                let found = if ignore {
                    line.to_lowercase().contains(&pattern.to_lowercase())
                } else {
                    line.contains(pattern)
                };
                if found != invert {
                    if numbers {
                        out += &format!("{}:", i + 1);
                    }
                    out += line;
                    out.push('\n');
                }
            }
            let code = if out.is_empty() { 1 } else { 0 };
            return Ok(Reply {
                code,
                ..Reply::ok(out)
            });
        }
        "wc" => {
            let files: Vec<_> = a.iter().filter(|s| !s.starts_with('-')).cloned().collect();
            let data = contents(fs, &files, input)?;
            let counts = [
                data.bytes().filter(|c| *c == b'\n').count(),
                data.split_whitespace().count(),
                data.len(),
            ];
            let flags: String = a.iter().filter(|s| s.starts_with('-')).cloned().collect();
            let selected: Vec<_> = [('l', 0), ('w', 1), ('c', 2)]
                .iter()
                .filter(|(c, _)| flags.is_empty() || flags.contains(*c))
                .map(|(_, i)| counts[*i].to_string())
                .collect();
            out = format!("{}\n", selected.join(" "));
        }
        "sort" | "uniq" => {
            let files: Vec<_> = a.iter().filter(|s| !s.starts_with('-')).cloned().collect();
            let data = contents(fs, &files, input)?;
            let mut lines: Vec<_> = data.lines().collect();
            if command == "sort" {
                if a.iter().any(|s| s == "-n") {
                    lines.sort_by(|x, y| {
                        x.parse::<f64>()
                            .unwrap_or(0.)
                            .total_cmp(&y.parse::<f64>().unwrap_or(0.))
                    });
                } else {
                    lines.sort();
                }
                if a.iter().any(|s| s == "-r") {
                    lines.reverse();
                }
            }
            if command == "uniq" || a.iter().any(|s| s == "-u") {
                lines.dedup();
            }
            if !lines.is_empty() {
                out = lines.join("\n") + "\n";
            }
        }
        "cp" | "mv" => {
            let paths: Vec<_> = a.iter().filter(|s| !s.starts_with('-')).collect();
            if paths.len() != 2 {
                return Err(format!("usage: {command} source destination"));
            }
            fs.copy(
                paths[0],
                paths[1],
                command == "mv" || a.iter().any(|s| s.contains('r') && s.starts_with('-')),
                command == "mv",
            )?;
        }
        "rm" | "rmdir" => {
            required(a, "rm [-r] path")?;
            let recursive = a.iter().any(|s| s.starts_with('-') && s.contains('r'));
            for path in a.iter().filter(|s| !s.starts_with('-')) {
                fs.remove(path, recursive, command == "rmdir")?;
            }
        }
        "seq" => {
            let values: Result<Vec<i64>, _> = a.iter().map(|s| s.parse::<i64>()).collect();
            let values = values.map_err(|_| "seq: invalid number")?;
            let (mut current, step, end) = match values.as_slice() {
                [end] => (1, 1, *end),
                [start, end] => (*start, 1, *end),
                [start, step, end] => (*start, *step, *end),
                _ => return Err("usage: seq [start [step]] end".into()),
            };
            if step == 0 {
                return Err("seq: step cannot be zero".into());
            }
            for _ in 0..10000 {
                if (step > 0 && current > end) || (step < 0 && current < end) {
                    break;
                }
                out += &format!("{current}\n");
                current = current.checked_add(step).ok_or("seq: overflow")?;
            }
        }
        "test" | "[" => {
            let mut values = a.to_vec();
            if command == "[" {
                if values.last().map(String::as_str) != Some("]") {
                    return Err("[: missing ]".into());
                }
                values.pop();
            }
            return Ok(Reply {
                code: if test(fs, &values)? { 0 } else { 1 },
                ..Reply::ok(out)
            });
        }
        "clear" => {
            return Ok(Reply {
                action: "clear".into(),
                ..Reply::ok(out)
            })
        }
        "edit" => {
            required(a, "edit path")?;
            let path = fs.path(&a[0])?;
            if !fs.entries.contains_key(&path) {
                fs.write(&path, "", false)?;
            }
            fs.read(&path)?;
            return Ok(Reply {
                action: format!("edit:{path}"),
                ..Reply::ok(out)
            });
        }
        "whoami" => out = "web\n".into(),
        "uname" => out = "Ark browser runtime / WebAssembly\n".into(),
        "help" => {
            out = concat!(
                "Ark browser shell\n\n",
                "Files: pwd cd ls mkdir touch cat cp mv rm rmdir edit\n",
                "Text: echo printf grep head tail wc sort uniq seq\n",
                "Shell: export unset alias unalias env true false test clear help\n",
                "Syntax: pipes, redirects, variables, arithmetic, command substitution,\n",
                "        if, for, while, functions, && and ||.\n\n",
                "Ark's lexer, parser and expander run as WebAssembly. Rust provides\n",
                "the browser filesystem and commands. Files are saved in this browser.\n",
                "grep matches plain text. Native programs, jobs and networking are not\n",
                "available. Ctrl+C stops a command. Tab completes names and paths.\n"
            )
            .into()
        }
        _ => {
            return Ok(Reply {
                out,
                err: format!("{command}: command not available in the browser\n"),
                code: 127,
                action: String::new(),
            })
        }
    }
    if out.len() > 1024 * 1024 {
        return Err("output limit reached".into());
    }
    Ok(Reply::ok(out))
}

fn required(a: &[String], usage: &str) -> Result<(), String> {
    if a.is_empty() {
        Err(format!("usage: {usage}"))
    } else {
        Ok(())
    }
}
fn contents(fs: &FileSystem, paths: &[String], input: &str) -> Result<String, String> {
    if paths.is_empty() {
        return Ok(input.into());
    }
    let mut out = String::new();
    for p in paths {
        out += &if p == "-" { input.into() } else { fs.read(p)? };
    }
    Ok(out)
}
fn escapes(text: &str) -> String {
    let mut result = String::new();
    let mut chars = text.chars();
    while let Some(c) = chars.next() {
        if c != '\\' {
            result.push(c);
            continue;
        }
        match chars.next() {
            Some('n') => result.push('\n'),
            Some('t') => result.push('\t'),
            Some('r') => result.push('\r'),
            Some('\\') => result.push('\\'),
            Some(c) => {
                result.push('\\');
                result.push(c);
            }
            None => result.push('\\'),
        }
    }
    result
}
fn test(fs: &FileSystem, a: &[String]) -> Result<bool, String> {
    let v: Vec<_> = a.iter().map(String::as_str).collect();
    match v.as_slice() {
        [] => Ok(false),
        [x] => Ok(!x.is_empty()),
        ["!", rest @ ..] => Ok(!test(
            fs,
            &rest.iter().map(|s| s.to_string()).collect::<Vec<_>>(),
        )?),
        ["-n", x] => Ok(!x.is_empty()),
        ["-z", x] => Ok(x.is_empty()),
        [flag @ ("-e" | "-f" | "-d"), x] => {
            let p = fs.path(x)?;
            Ok(match *flag {
                "-d" => fs.directory(&p),
                "-f" => matches!(fs.entries.get(&p), Some(Some(_))),
                _ => fs.entries.contains_key(&p),
            })
        }
        [x, "=", y] | [x, "==", y] => Ok(x == y),
        [x, "!=", y] => Ok(x != y),
        [x, op, y] => {
            let x = x.parse::<i64>().map_err(|_| "test: integer required")?;
            let y = y.parse::<i64>().map_err(|_| "test: integer required")?;
            Ok(match *op {
                "-eq" => x == y,
                "-ne" => x != y,
                "-lt" => x < y,
                "-le" => x <= y,
                "-gt" => x > y,
                "-ge" => x >= y,
                _ => return Err("test: unsupported operator".into()),
            })
        }
        _ => Err("test: invalid expression".into()),
    }
}
